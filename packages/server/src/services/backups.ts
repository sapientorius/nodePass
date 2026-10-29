import { lstat, readdir, unlink } from "node:fs/promises";
import { BadRequest, Conflict } from "@feathersjs/errors";
import type {
  BackupJob,
  BackupOrigin,
  BackupSchedule,
  BackupScheduleInput,
} from "@nodepass/contracts";
import type { Config } from "../config.js";
import { audit, getSetting, putSetting, type Database } from "../db.js";
import { backup, readBackup } from "../migration/backup.js";
import { validateRestored } from "../migration/restore-validation.js";
import { token } from "../security/crypto.js";
import { BackupFiles, atomicJson, readJson } from "./backup-files.js";
import {
  firstBackupAt,
  nextBackupAt,
  scheduleInput,
} from "./backup-schedule.js";

interface StoredJob extends BackupJob {
  name: string;
  origin: BackupOrigin;
  userId: number | null;
  slot?: number;
  attempts: number;
  retryAt: number;
  completedAt?: number;
}
export const defaultBackupSchedule: BackupSchedule = {
  enabled: false,
  days: 1,
  time: "02:00",
  timezone: "UTC",
  keep: 7,
  configured: false,
  nextAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  error: null,
};
export class Backups {
  readonly files: BackupFiles;
  private active?: Promise<void>;
  private paused = false;
  private stopped = false;
  private configuring = false;
  private ticking?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    readonly db: Database,
    readonly config: Config,
    readonly now = Date.now,
  ) {
    this.files = new BackupFiles(config.dataDir);
  }
  async initialize(): Promise<void> {
    await this.files.initialize();
  }
  async schedule(): Promise<BackupSchedule> {
    return getSetting(this.db, "backups/schedule", {
      ...defaultBackupSchedule,
    });
  }
  async configure(value: unknown, userId: number): Promise<BackupSchedule> {
    if (
      this.paused ||
      this.stopped ||
      this.ticking ||
      this.active ||
      this.configuring
    )
      throw new Conflict("A backup operation is active");
    this.configuring = true;
    try {
      const input = scheduleInput(value),
        previous = await this.schedule();
      const schedule = {
        ...previous,
        ...input,
        configured: true,
        nextAt: input.enabled ? firstBackupAt(this.now(), input) : null,
        error: null,
      };
      await putSetting(this.db, "backups/schedule", schedule);
      await audit(this.db, userId, "backup.schedule");
      return schedule;
    } finally {
      this.configuring = false;
    }
  }
  private path(id: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new BadRequest("Invalid backup job");
    return this.files.workPath(`create-${id}.json`);
  }
  async job(id: string): Promise<BackupJob | undefined> {
    const job = await readJson<StoredJob>(this.path(id));
    return job
      ? {
          id: job.id,
          state: job.state,
          step: job.step,
          name: job.state === "complete" ? job.name : undefined,
          error: job.error,
        }
      : undefined;
  }
  private async execute(job: StoredJob): Promise<void> {
    const save = () => atomicJson(this.path(job.id), job);
    this.files.protect(job.name);
    try {
      await save();
      // The reserved filename makes restart after rename but before job completion idempotent.
      const existing = await lstat(this.files.path(job.name)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return undefined;
        },
      );
      if (!existing) {
        await unlink(`${this.files.path(job.name)}.partial`).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          },
        );
        await this.files.metadata(job.name, {
          origin: job.origin,
          slot: job.slot,
          job: job.id,
          complete: false,
        });
        await backup(
          this.db,
          this.files.directory,
          this.config.deploymentKey,
          { legacy: this.config.legacy, publicUrl: this.config.publicUrl },
          job.name,
          (snapshot) => validateRestored(snapshot, this.config.deploymentKey),
        );
      }
      job.step = "checking";
      await save();
      const lease = await this.files.lease(job.name);
      try {
        await readBackup(
          this.files.path(job.name),
          this.config.deploymentKey,
          this.files.work,
          () => {},
        );
      } finally {
        await lease.release();
      }
      await this.files.metadata(job.name, {
        origin: job.origin,
        slot: job.slot,
        job: job.id,
        complete: true,
      });
      job.state = "complete";
      job.step = "complete";
      delete job.error;
      await audit(this.db, job.userId, "backup.create");
      job.completedAt = this.now();
    } catch {
      job.state = "failed";
      job.step = "failed";
      job.error = "unavailable";
      console.error(
        JSON.stringify({ event: "backup.create.failed", job: job.id }),
      );
    } finally {
      this.files.unprotect(job.name);
      await save();
    }
  }
  async create(
    userId: number | null,
    origin: BackupOrigin = "manual",
    slot?: number,
  ): Promise<BackupJob> {
    if (this.active || this.paused || this.stopped || this.configuring)
      throw new Conflict("A backup operation is active");
    const job: StoredJob = {
      id: token(),
      name: this.files.name(),
      state: "running",
      step: "creating",
      origin,
      userId,
      slot,
      attempts: 1,
      retryAt: 0,
    };
    // Claim synchronously, before the first filesystem await.
    const active = this.execute(job);
    this.active = active;
    void active
      .catch(() =>
        console.error(JSON.stringify({ event: "backup.job.persist.failed" })),
      )
      .finally(() => {
        if (this.active === active) this.active = undefined;
      });
    await atomicJson(this.files.workPath("latest-create.json"), { id: job.id });
    return { id: job.id, state: "running", step: "creating" };
  }
  async latest(): Promise<BackupJob | undefined> {
    const latest = await readJson<{ id: string }>(
      this.files.workPath("latest-create.json"),
    );
    return latest ? this.job(latest.id) : undefined;
  }
  async wait(): Promise<void> {
    await this.active;
  }
  private async slotJob(slot: number): Promise<StoredJob | undefined> {
    const saved = await readJson<{ id: string }>(
      this.files.workPath(`slot-${slot}.json`),
    );
    return saved ? readJson<StoredJob>(this.path(saved.id)) : undefined;
  }
  checkDue(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.tick().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  private async tick(): Promise<void> {
    if (this.paused || this.stopped || this.active || this.configuring) return;
    const schedule = await this.schedule();
    if (
      !schedule.enabled ||
      schedule.nextAt === null ||
      schedule.nextAt > this.now()
    )
      return;
    const slot = schedule.nextAt;
    let job = await this.slotJob(slot);
    if (job?.state === "complete") {
      schedule.lastSuccessAt =
        job.completedAt ?? Number(/^nodepass-(\d+)/.exec(job.name)![1]);
      schedule.error = null;
    } else {
      if (
        job?.state === "failed" &&
        (job.attempts >= 3 || job.retryAt > this.now())
      ) {
        if (job.attempts < 3) return;
      } else {
        if (!job) {
          job = {
            id: token(),
            name: this.files.name(),
            state: "running",
            step: "creating",
            origin: "automatic",
            slot,
            attempts: 0,
            retryAt: 0,
            userId: null,
          };
          // Publish the job before its slot reference. A restart can safely find either state.
          await atomicJson(this.path(job.id), job);
          await atomicJson(this.files.workPath(`slot-${slot}.json`), {
            id: job.id,
          });
        }
        job.attempts++;
        job.state = "running";
        schedule.lastAttemptAt = this.now();
        await putSetting(this.db, "backups/schedule", schedule);
        const active = this.execute(job);
        this.active = active;
        try {
          await active;
        } finally {
          this.active = undefined;
        }
        if ((job.state as string) === "complete") {
          schedule.lastSuccessAt = this.now();
          schedule.error = null;
          try {
            await this.files.prune(schedule.keep);
          } catch {
            schedule.error = "unavailable";
            console.error(JSON.stringify({ event: "backup.retention.failed" }));
          }
        } else {
          job.retryAt = this.now() + (job.attempts === 1 ? 15 : 60) * 60000;
          await atomicJson(this.path(job.id), job);
          schedule.error = "unavailable";
          await putSetting(this.db, "backups/schedule", schedule);
          if (job.attempts < 3) return;
        }
      }
    }
    do {
      schedule.nextAt = nextBackupAt(schedule.nextAt!, schedule);
    } while (schedule.nextAt <= this.now());
    await putSetting(this.db, "backups/schedule", schedule);
  }
  async start(): Promise<void> {
    this.paused = false;
    this.stopped = false;
    // Resume owned interrupted manual jobs; automatic jobs are resumed by their persisted slot.
    for (const entry of await readdir(this.files.work)) {
      if (!/^create-[A-Za-z0-9_-]{43}\.json$/.test(entry)) continue;
      const job = await readJson<StoredJob>(this.files.workPath(entry));
      if (job?.state === "running" && job.origin !== "automatic")
        await this.execute(job);
    }
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.checkDue().catch(() =>
          console.error(JSON.stringify({ event: "backup.background.failed" })),
        );
      }, 30000);
      this.timer.unref();
    }
    void this.checkDue().catch(() =>
      console.error(JSON.stringify({ event: "backup.background.failed" })),
    );
  }
  async pause(): Promise<void> {
    this.paused = true;
    await Promise.all([this.active, this.ticking]);
  }
  resume(): void {
    this.paused = false;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pause();
  }
  async disableAfterRestore(): Promise<void> {
    const old = await this.schedule();
    const input: BackupScheduleInput = scheduleInput({
      enabled: false,
      days: old.days,
      time: old.time,
      timezone: old.timezone,
      keep: old.keep,
    });
    await putSetting(this.db, "backups/schedule", {
      ...defaultBackupSchedule,
      ...input,
      configured: old.configured,
    });
  }
}
