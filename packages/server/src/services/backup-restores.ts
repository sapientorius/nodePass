import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, open as openFile, readdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { BadRequest, Conflict, Forbidden, NotFound } from "@feathersjs/errors";
import type { RestoreStatus, RestoreTicket } from "@nodepass/contracts";
import type { Config } from "../config.js";
import type { RequestIdentity } from "../security/auth.js";
import { digest, equal, open, seal, token } from "../security/crypto.js";
import { audit, withLock, type Database } from "../db.js";
import { backup, readBackup } from "../migration/backup.js";
import { restore } from "../migration/restore.js";
import {
  clearTarget,
  inspectTarget,
  prepareSnapshot,
  validateRestored,
} from "../migration/restore-validation.js";
import { atomicJson, readJson, safeOpen } from "./backup-files.js";
import type { Backups } from "./backups.js";

interface StoredRestore extends RestoreStatus {
  owner: number;
  session: string;
  statusHash: string;
  touchedAt: number;
  sourceName?: string;
  uploadComplete: boolean;
  preparedHash?: string;
  authorizationHash?: string;
  authorizationUntil?: number;
  finishedAt?: number;
}
interface Journal {
  id: string;
  database: string;
  safety: string;
  phase: "replacing" | "rollback" | "complete";
  outcome?: "restored" | "rolledBack";
}
export interface RestoreRuntime {
  enter: () => Promise<void>;
  leave: () => Promise<void>;
  block: () => void;
}
export class BackupRestores {
  private current?: StoredRestore;
  private tasks = new Set<Promise<void>>();
  private busy = false;
  private runtime?: RestoreRuntime;
  private journal?: Journal;
  private timer?: ReturnType<typeof setInterval>;
  private expiring?: Promise<void>;
  private saves = new Map<string, Promise<void>>();
  private readonly binding: string;
  constructor(
    readonly db: Database,
    readonly config: Config,
    readonly backups: Backups,
    readonly now = Date.now,
  ) {
    this.binding = digest(
      `${config.database.host}:${config.database.port}/${config.database.database}`,
    );
  }
  attach(runtime: RestoreRuntime): void {
    this.runtime = runtime;
  }
  private path(id: string, suffix = "json"): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new BadRequest("Invalid restore job");
    return this.backups.files.workPath(`restore-${id}.${suffix}`);
  }
  private async save(job: StoredRestore): Promise<void> {
    const value = {
      keyId: digest(this.config.deploymentKey),
      sealed: seal(
        JSON.stringify(job),
        this.config.deploymentKey,
        `restore/${this.binding}/${job.id}`,
      ).toString("base64"),
    };
    const previous = this.saves.get(job.id) ?? Promise.resolve();
    const saved = previous
      .catch(() => {})
      .then(() => atomicJson(this.path(job.id), value));
    this.saves.set(job.id, saved);
    try {
      await saved;
    } finally {
      if (this.saves.get(job.id) === saved) this.saves.delete(job.id);
    }
  }
  private async load(id: string): Promise<StoredRestore | undefined> {
    const value = await readJson<{ sealed: string; keyId?: string }>(
      this.path(id),
    );
    if (!value) return undefined;
    // Key rotation invalidates preparations/status tickets, never a recovery journal.
    if (value.keyId && !equal(value.keyId, digest(this.config.deploymentKey)))
      return undefined;
    const clear = open(
      Buffer.from(value.sealed, "base64"),
      this.config.deploymentKey,
      `restore/${this.binding}/${id}`,
    );
    try {
      const job = JSON.parse(clear.toString()) as StoredRestore;
      if (job.id !== id || job.database !== this.config.database.database)
        throw new Error("Restore target changed");
      return job;
    } finally {
      clear.fill(0);
    }
  }
  private async writeJournal(journal: Journal): Promise<void> {
    this.journal = journal;
    await atomicJson(this.backups.files.workPath("restore-journal.json"), {
      sealed: seal(
        JSON.stringify(journal),
        this.config.deploymentKey,
        `restore-journal/${this.binding}`,
      ).toString("base64"),
    });
  }
  async recoverStartup(): Promise<boolean> {
    try {
      const value = await readJson<{ sealed: string }>(
        this.backups.files.workPath("restore-journal.json"),
      );
      if (value) {
        const clear = open(
          Buffer.from(value.sealed, "base64"),
          this.config.deploymentKey,
          `restore-journal/${this.binding}`,
        );
        try {
          this.journal = JSON.parse(clear.toString());
        } finally {
          clear.fill(0);
        }
        const journal = this.journal!;
        if (
          journal.database !== this.binding ||
          !["replacing", "rollback", "complete"].includes(journal.phase)
        )
          throw new Error("Restore target changed");
        this.path(journal.id);
        this.backups.files.protect(journal.safety);
        if (journal.phase !== "complete") {
          await withLock(this.db, async () => {
            await this.rollback(journal);
          });
          const job = await this.load(journal.id);
          if (job) {
            job.state = "failed";
            job.error = "rolledBack";
            job.step = "rolledBack";
            job.finishedAt = this.now();
            await this.save(job);
            await this.cleanup(job);
          }
        } else {
          const job = await this.load(journal.id);
          if (job?.state === "running") {
            job.state = journal.outcome === "restored" ? "complete" : "failed";
            job.error =
              journal.outcome === "restored" ? undefined : "rolledBack";
            job.step =
              journal.outcome === "restored" ? "complete" : "rolledBack";
            job.finishedAt = this.now();
            await this.save(job);
            await this.cleanup(job);
          }
        }
        this.backups.files.unprotect(journal.safety);
        // A completed, durably recorded operation no longer needs a recovery journal.
        await unlink(this.backups.files.workPath("restore-journal.json"));
        this.journal = undefined;
      }
      for (const name of await readdir(this.backups.files.work)) {
        const match = /^restore-([A-Za-z0-9_-]{43})\.json$/.exec(name);
        if (!match) continue;
        const job = await this.load(match[1]!);
        if (job && !["complete", "failed"].includes(job.state)) {
          if (job.state === "running" || job.state === "checking") {
            job.state = "failed";
            job.step = "failed";
            job.error = "unavailable";
            job.finishedAt = this.now();
            await this.save(job);
            await this.cleanup(job);
          } else {
            if (this.current) throw new Error("Ambiguous restore state");
            this.current = job;
            if (job.sourceName) this.backups.files.protect(job.sourceName);
          }
        }
      }
      await this.expire();
      this.timer = setInterval(() => {
        void this.expire().catch(() =>
          console.error(
            JSON.stringify({ event: "backup.restore.expiry.failed" }),
          ),
        );
      }, 30000);
      this.timer.unref();
      return true;
    } catch {
      console.error(
        JSON.stringify({ event: "backup.restore.recovery.failed" }),
      );
      return false;
    }
  }
  private public(job: StoredRestore): RestoreStatus {
    const finishing =
      this.busy &&
      ["complete", "failed"].includes(job.state) &&
      job.preparedHash;
    return {
      id: job.id,
      state: finishing ? "running" : job.state,
      step: finishing ? "verifying" : job.step,
      offset: job.offset,
      uploadComplete: job.uploadComplete,
      database: job.database,
      confirmation: job.confirmation,
      createdAt: job.createdAt,
      counts: job.counts,
      error: job.error,
    };
  }
  private owns(job: StoredRestore, identity: RequestIdentity): void {
    if (
      job.owner !== identity.user.id ||
      !equal(job.session, digest(identity.session.id))
    )
      throw new Forbidden("Restore job unavailable");
  }
  private async owned(
    id: string,
    identity: RequestIdentity,
  ): Promise<StoredRestore> {
    const job = this.current?.id === id ? this.current : await this.load(id);
    if (!job) throw new NotFound("Restore job unavailable");
    this.owns(job, identity);
    if (
      job.state !== "running" &&
      !["complete", "failed"].includes(job.state) &&
      this.now() - job.touchedAt > 3600000
    ) {
      await this.expire();
      throw new NotFound("Restore job expired");
    }
    return job;
  }
  async latest(identity: RequestIdentity): Promise<RestoreTicket | null> {
    await this.expire();
    if (!this.current) return null;
    if (
      this.current.owner !== identity.user.id ||
      !equal(this.current.session, digest(identity.session.id))
    )
      return null;
    const statusToken = token();
    this.current.statusHash = digest(statusToken);
    await this.save(this.current);
    return { ...this.public(this.current), statusToken };
  }
  async begin(
    identity: RequestIdentity,
    sourceName?: string,
  ): Promise<RestoreTicket> {
    await this.expire();
    if (this.current || this.busy || this.journal?.phase === "rollback")
      throw new Conflict("A restore job is already active");
    this.busy = true;
    const id = token(),
      statusToken = token();
    const job: StoredRestore = {
      id,
      state: "upload",
      step: "upload",
      offset: 0,
      owner: identity.user.id,
      session: digest(identity.session.id),
      statusHash: digest(statusToken),
      touchedAt: this.now(),
      database: this.config.database.database,
      confirmation: `DELETE AND RESTORE ${this.config.database.database}`,
      uploadComplete: false,
      sourceName,
    };
    try {
      this.current = job;
      await this.save(job);
      if (sourceName) {
        this.backups.files.protect(sourceName);
        const lease = await this.backups.files.lease(sourceName);
        try {
          await pipeline(
            lease.file.createReadStream({ autoClose: false }),
            createWriteStream(this.path(id, "source"), {
              flags: "wx",
              mode: 0o600,
            }),
          );
        } finally {
          await lease.release();
        }
        const source = await safeOpen(this.path(id, "source"));
        try {
          job.offset = (await source.stat()).size;
        } finally {
          await source.close();
        }
        if (job.offset > 4 * 1024 ** 3)
          throw new BadRequest("Backup exceeds supported limits");
        job.uploadComplete = true;
      } else {
        const file = await openFile(this.path(id, "source"), "wx", 0o600);
        await file.close();
      }
      await this.save(job);
      return { ...this.public(job), statusToken };
    } catch (error) {
      job.state = "failed";
      job.step = "failed";
      job.error = "invalid";
      job.finishedAt = this.now();
      await this.save(job);
      await this.cleanup(job);
      this.current = undefined;
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async upload(
    id: string,
    identity: RequestIdentity,
    offset: number,
    content: string,
    final: boolean,
  ): Promise<RestoreStatus> {
    const job = await this.owned(id, identity);
    if (
      this.busy ||
      job.state !== "upload" ||
      job.uploadComplete ||
      offset !== job.offset
    )
      throw new Conflict("Restore upload changed");
    if (
      typeof content !== "string" ||
      content.length > Math.ceil((8 * 1024 ** 2) / 3) * 4 ||
      typeof final !== "boolean"
    )
      throw new BadRequest("Invalid backup chunk");
    const chunk = Buffer.from(content, "base64");
    if (
      chunk.length > 8 * 1024 ** 2 ||
      chunk.toString("base64") !== content ||
      job.offset + chunk.length > 4 * 1024 ** 3 ||
      (!final && !chunk.length)
    )
      throw new BadRequest("Invalid backup chunk");
    this.busy = true;
    try {
      const check = await safeOpen(this.path(id, "source"));
      await check.close();
      const file = await openFile(this.path(id, "source"), "a");
      try {
        if ((await file.stat()).size !== offset)
          throw new Conflict("Restore upload changed");
        await file.writeFile(chunk);
        await file.sync();
      } finally {
        await file.close();
      }
      job.offset += chunk.length;
      job.uploadComplete = final;
      job.touchedAt = this.now();
      await this.save(job);
      return this.public(job);
    } finally {
      chunk.fill(0);
      this.busy = false;
    }
  }
  async check(
    id: string,
    identity: RequestIdentity,
    encoded: string,
  ): Promise<RestoreStatus> {
    const job = await this.owned(id, identity);
    if (this.busy || job.state !== "upload" || !job.uploadComplete)
      throw new Conflict("Restore is not ready for checking");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      key.fill(0);
      throw new BadRequest("Invalid deployment key");
    }
    job.state = "checking";
    job.step = "checking";
    this.busy = true;
    try {
      await this.save(job);
    } catch (error) {
      key.fill(0);
      this.busy = false;
      throw error;
    }
    this.track(
      (async () => {
        try {
          const prepared = await prepareSnapshot(
            this.db,
            this.path(id, "source"),
            key,
            this.config.deploymentKey,
            this.path(id, "prepared"),
            this.backups.files.work,
          );
          job.preparedHash = prepared.hash;
          job.createdAt =
            prepared.createdAt ??
            (job.sourceName
              ? (await this.backups.files.summary(job.sourceName)).createdAt
              : undefined);
          job.counts = prepared.counts;
          job.state = "ready";
          job.step = "ready";
          job.touchedAt = this.now();
          delete job.error;
        } catch {
          job.state = "upload";
          job.step = "upload";
          job.error = "verification";
          console.error(
            JSON.stringify({ event: "backup.restore.check.failed", job: id }),
          );
        } finally {
          key.fill(0);
          this.busy = false;
          await this.save(job);
        }
      })(),
    );
    return this.public(job);
  }
  async authorize(id: string, identity: RequestIdentity): Promise<string> {
    const job = await this.owned(id, identity);
    if (job.state !== "ready" || !job.preparedHash)
      throw new Conflict("Restore is not ready");
    const grant = token();
    job.authorizationHash = digest(
      `${grant}/${job.preparedHash}/${this.binding}`,
    );
    job.authorizationUntil = this.now() + 300000;
    job.touchedAt = this.now();
    await this.save(job);
    return grant;
  }
  async commit(
    id: string,
    identity: RequestIdentity,
    confirmation: string,
    grant: string,
  ): Promise<RestoreStatus> {
    const job = await this.owned(id, identity);
    if (!this.runtime || this.busy || job.state !== "ready")
      throw new Conflict("Restore is not ready");
    if (
      confirmation !== job.confirmation ||
      !job.authorizationHash ||
      this.now() >= job.authorizationUntil! ||
      !equal(
        job.authorizationHash,
        digest(`${grant}/${job.preparedHash}/${this.binding}`),
      )
    )
      throw new Forbidden("Restore confirmation required");
    job.authorizationHash = undefined;
    job.state = "running";
    job.step = "maintenance";
    this.busy = true;
    await this.save(job);
    this.track(this.execute(job));
    return this.public(job);
  }
  private track(task: Promise<void>): void {
    this.tasks.add(task);
    void task
      .catch((error: unknown) => {
        this.runtime?.block();
        const code = (error as NodeJS.ErrnoException)?.code;
        console.error(
          JSON.stringify({
            event: "backup.restore.job.failed",
            code: [
              "ENOENT",
              "EPERM",
              "EACCES",
              "EBUSY",
              "ETIMEDOUT",
              "ECONNREFUSED",
            ].includes(code ?? "")
              ? code
              : "internal",
          }),
        );
      })
      .finally(() => this.tasks.delete(task));
  }
  private async verifyPrepared(job: StoredRestore): Promise<void> {
    const file = await safeOpen(this.path(job.id, "prepared"));
    const hash = createHash("sha256");
    try {
      for await (const chunk of file.createReadStream({ autoClose: false }))
        hash.update(chunk);
    } finally {
      await file.close();
    }
    if (!equal(hash.digest("hex"), job.preparedHash!))
      throw new Error("Prepared backup changed");
    await readBackup(
      this.path(job.id, "prepared"),
      this.config.deploymentKey,
      this.backups.files.work,
      () => {},
    );
  }
  private async execute(job: StoredRestore): Promise<void> {
    let destructive = false,
      entered = false;
    try {
      await this.verifyPrepared(job);
      await inspectTarget(this.db);
      await this.runtime!.enter();
      entered = true;
      await withLock(this.db, async () => {
        await inspectTarget(this.db);
        job.step = "safety";
        await this.save(job);
        const safety = this.backups.files.name();
        this.backups.files.protect(safety);
        try {
          await backup(
            this.db,
            this.backups.files.directory,
            this.config.deploymentKey,
            { legacy: this.config.legacy, publicUrl: this.config.publicUrl },
            safety,
          );
          await readBackup(
            this.backups.files.path(safety),
            this.config.deploymentKey,
            this.backups.files.work,
            () => {},
          );
          await this.backups.files.metadata(safety, {
            origin: "safety",
            job: job.id,
          });
          await validateRestored(this.db, this.config.deploymentKey);
          // A failed checkpoint publication is uncertain: retain the verified recovery copy.
          destructive = true;
          await this.writeJournal({
            id: job.id,
            database: this.binding,
            safety,
            phase: "replacing",
          });
        } catch (error) {
          if (this.journal?.id !== job.id) this.backups.files.unprotect(safety);
          throw error;
        }
        destructive = true;
        try {
          job.step = "replacing";
          await this.save(job);
          await clearTarget(this.db);
          await restore(
            this.db,
            this.path(job.id, "prepared"),
            this.config.deploymentKey,
            this.config.deploymentKey,
            this.backups.files.work,
            true,
          );
          job.step = "verifying";
          await this.save(job);
          await validateRestored(this.db, this.config.deploymentKey);
          await this.backups.disableAfterRestore();
          await audit(this.db, null, "backup.restore.complete", job.id);
          await this.writeJournal({
            ...this.journal!,
            phase: "complete",
            outcome: "restored",
          });
          job.state = "complete";
          job.step = "complete";
        } catch (error) {
          await this.rollback(this.journal!);
          job.state = "failed";
          job.error = "rolledBack";
          job.step = "rolledBack";
          console.error(
            JSON.stringify({ event: "backup.restore.rolledBack", job: job.id }),
          );
          void error;
        }
      });
    } catch {
      job.state = "failed";
      job.error = destructive ? "recovery" : "unavailable";
      job.step = job.error;
      if (destructive) this.runtime!.block();
      console.error(
        JSON.stringify({
          event: "backup.restore.failed",
          job: job.id,
          recovery: destructive,
        }),
      );
    } finally {
      job.finishedAt = this.now();
      try {
        if (!destructive || this.journal?.phase === "complete") {
          await this.cleanup(job);
          if (entered) await this.runtime!.leave();
          await this.save(job);
          if (
            this.journal?.id === job.id &&
            this.journal.phase === "complete"
          ) {
            await unlink(this.backups.files.workPath("restore-journal.json"));
            this.backups.files.unprotect(this.journal.safety);
            this.journal = undefined;
          }
          this.current = undefined;
        }
      } catch {
        job.state = "failed";
        job.error = "recovery";
        job.step = "recovery";
        this.runtime!.block();
      } finally {
        this.busy = false;
        await this.save(job);
      }
    }
  }
  private async rollback(journal: Journal): Promise<void> {
    this.backups.files.protect(journal.safety);
    await readBackup(
      this.backups.files.path(journal.safety),
      this.config.deploymentKey,
      this.backups.files.work,
      () => {},
    );
    await this.writeJournal({ ...journal, phase: "rollback" });
    await clearTarget(this.db);
    await restore(
      this.db,
      this.backups.files.path(journal.safety),
      this.config.deploymentKey,
      this.config.deploymentKey,
      this.backups.files.work,
      true,
    );
    await validateRestored(this.db, this.config.deploymentKey);
    await audit(this.db, null, "backup.restore.rolledBack", journal.id);
    await this.writeJournal({
      ...journal,
      phase: "complete",
      outcome: "rolledBack",
    });
  }
  async status(id: string, statusToken: string): Promise<RestoreStatus> {
    const job = this.current?.id === id ? this.current : await this.load(id);
    if (
      !job ||
      !statusToken ||
      !equal(digest(statusToken), job.statusHash) ||
      (job.finishedAt !== undefined && this.now() - job.finishedAt >= 86400000)
    )
      throw new NotFound("Restore job unavailable");
    return this.public(job);
  }
  private async cleanup(job: StoredRestore): Promise<void> {
    if (job.sourceName) this.backups.files.unprotect(job.sourceName);
    await this.cleanupFiles(job.id);
  }
  private async cleanupFiles(id: string): Promise<void> {
    for (const suffix of [
      "source",
      "prepared",
      "prepared.records",
      "prepared.partial",
    ]) {
      await unlink(this.path(id, suffix)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }
  }
  expire(): Promise<void> {
    if (this.expiring) return this.expiring;
    this.expiring = this.expireNow().finally(() => {
      this.expiring = undefined;
    });
    return this.expiring;
  }
  private async expireNow(): Promise<void> {
    if (this.busy) return;
    if (
      this.current &&
      !["running", "checking"].includes(this.current.state) &&
      this.now() - this.current.touchedAt > 3600000
    ) {
      const job = this.current;
      job.state = "failed";
      job.error = "unavailable";
      job.step = "expired";
      job.finishedAt = this.now();
      await this.save(job);
      await this.cleanup(job);
      this.current = undefined;
    }
    for (const name of await readdir(this.backups.files.work)) {
      const match = /^restore-([A-Za-z0-9_-]{43})\.json$/.exec(name);
      if (
        !match ||
        match[1] === this.current?.id ||
        match[1] === this.journal?.id
      )
        continue;
      const path = this.path(match[1]!);
      const envelope = await readJson<{ keyId?: string }>(path);
      if (
        envelope?.keyId &&
        !equal(envelope.keyId, digest(this.config.deploymentKey))
      ) {
        if (this.now() - (await lstat(path)).mtimeMs > 3600000) {
          await this.cleanupFiles(match[1]!);
          await unlink(path);
        }
      } else {
        const job = await this.load(match[1]!);
        if (
          job?.finishedAt !== undefined &&
          this.now() - job.finishedAt >= 86400000
        ) {
          await this.cleanup(job);
          await unlink(path);
        }
      }
    }
  }
  async cancel(id: string, identity: RequestIdentity): Promise<void> {
    const job = await this.owned(id, identity);
    if (this.busy || ["running", "checking"].includes(job.state))
      throw new Conflict("Restore operation is active");
    job.state = "failed";
    job.step = "cancelled";
    job.finishedAt = this.now();
    await this.save(job);
    await this.cleanup(job);
    this.current = undefined;
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.tasks]);
  }
}
