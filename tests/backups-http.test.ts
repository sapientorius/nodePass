import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  utimes,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RestoreTicket } from "../packages/contracts/src/index.js";
import { defaultPolicy } from "../packages/contracts/src/index.js";
import { loadConfig, type Config } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { database, putSetting, withLock } from "../packages/server/src/db.js";
import { backup } from "../packages/server/src/migration/backup.js";
import { restore } from "../packages/server/src/migration/restore.js";
import { clearTarget } from "../packages/server/src/migration/restore-validation.js";
import { atomicJson } from "../packages/server/src/services/backup-files.js";
import { digest, seal, token } from "../packages/server/src/security/crypto.js";
import { isolatedDatabase } from "./database.js";
import { offlineUpdates } from "./offline-updates.js";
import { Vault } from "../packages/server/src/security/vault.js";
const enabled = process.env.NODEPASS_INTEGRATION === "1";
describe.skipIf(!enabled)(
  "managed backups and authenticated full restore over HTTP",
  () => {
    let config: Config, directory: string, drop: () => Promise<void>;
    let runtime: Awaited<ReturnType<typeof createApp>>;
    let server: Awaited<ReturnType<typeof runtime.app.listen>>;
    let base = "",
      cookie = "",
      csrf = "",
      baseline = "",
      accountId = 0;
    const password = "Synthetic!Backup-Credentials-4829-Only";
    const call = async (
      path: string,
      method = "GET",
      data?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(base + "/api/v1/" + path, {
        method,
        headers: {
          origin: config.publicUrl,
          cookie,
          "x-csrf-token": csrf,
          "content-type": "application/json",
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return {
        response,
        value: response.status === 204 ? undefined : await response.json(),
      };
    };
    const login = async (loginName = "backup-admin") => {
      const result = await call("auth/login", "POST", {
        login: loginName,
        password,
      });
      expect(result.response.status, JSON.stringify(result.value)).toBe(200);
      expect(result.value.phase).toBe("ready");
      cookie = result.response.headers.get("set-cookie")!.split(";")[0]!;
      csrf = result.value.csrf;
    };
    const start = async () => {
      runtime = await createApp(config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await runtime.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test listener");
      base = `http://127.0.0.1:${address.port}`;
    };
    const stop = async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      if (runtime) await runtime.close();
    };
    const waitJob = async (id: string) => {
      for (let attempt = 0; attempt < 500; attempt++) {
        const result = await call("backup-jobs/" + id);
        if (result.value.state !== "running") return result.value;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("Backup job timed out");
    };
    const status = async (ticket: RestoreTicket) => {
      const response = await fetch(
        base + `/api/v1/backup-restores/${ticket.id}/status`,
        { headers: { "x-backup-job-token": ticket.statusToken } },
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    const waitRestore = async (
      ticket: RestoreTicket,
      states = ["ready", "upload", "complete", "failed"],
    ) => {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const result = await status(ticket);
        if (states.includes(result.state)) return result;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("Restore timed out");
    };
    const begin = async (name = baseline): Promise<RestoreTicket> => {
      const result = await call("backup-restores", "POST", { name });
      expect(result.response.status, JSON.stringify(result.value)).toBe(202);
      return result.value;
    };
    const check = async (ticket: RestoreTicket, key = config.deploymentKey) => {
      expect(
        (
          await call(`backup-restores/${ticket.id}/check`, "POST", {
            key: key.toString("base64"),
          })
        ).response.status,
      ).toBe(202);
      return waitRestore(ticket);
    };
    const authorize = async (ticket: RestoreTicket) => {
      const result = await call(
        `backup-restores/${ticket.id}/confirm`,
        "POST",
        { password },
      );
      expect(result.response.status, JSON.stringify(result.value)).toBe(200);
      return result.value.authorization as string;
    };
    const commit = (ticket: RestoreTicket, authorization: string) =>
      call(`backup-restores/${ticket.id}/commit`, "POST", {
        confirmation: ticket.confirmation,
        authorization,
      });
    const cancel = async (ticket: RestoreTicket) => {
      expect(
        (await call(`backup-restores/${ticket.id}`, "DELETE")).response.status,
      ).toBe(204);
    };
    beforeAll(async () => {
      if (existsSync(".cache/integration.env"))
        process.loadEnvFile(".cache/integration.env");
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      directory = await mkdtemp(join(tmpdir(), "nodepass-backups-http-"));
      config = {
        ...isolated.config,
        production: false,
        publicUrl: "http://localhost:3000",
        rpId: "localhost",
        trustProxy: false,
        trustedProxies: [],
        dataDir: directory,
        deploymentKey: randomBytes(32),
        setupToken: token(),
      };
      await start();
      const fresh = await call(
        "setup/fresh",
        "POST",
        { login: "backup-admin", name: "Synthetic backup admin", password },
        { "x-setup-token": config.setupToken },
      );
      expect(fresh.response.status, JSON.stringify(fresh.value)).toBe(200);
      await putSetting(runtime.db, "security", {
        ...defaultPolicy,
        mfa: "optional",
      });
      await login();
      const account = await call("accounts", "POST", {
        name: "Synthetic backup account",
        login: "original",
        password: "synthetic-first-secret",
        categoryId: 1,
        clientId: 1,
        userGroupId: 1,
      });
      expect(account.response.status).toBe(201);
      accountId = account.value.id;
      expect(
        (
          await call(`accounts/${accountId}/password`, "POST", {
            password: "synthetic-original-secret",
            version: account.value.version,
          })
        ).response.status,
      ).toBe(200);
      const attachment = await call(`accounts/${accountId}/files`, "POST", {
        name: "synthetic.txt",
        content: Buffer.from("synthetic attachment").toString("base64"),
      });
      expect(attachment.response.status).toBe(200);
      await runtime
        .db("nodepass_attachments")
        .where({ id: attachment.value.id })
        .update({
          thumb: runtime.vault.wrap(
            "synthetic thumbnail",
            `attachment-thumb/${attachment.value.id}`,
          ),
        });
      expect(
        (
          await call(`accounts/${accountId}/links`, "POST", {
            seconds: 3600,
            views: 3,
          })
        ).response.status,
      ).toBe(200);
      for (const encrypted of [true, false]) {
        const [definition] = await runtime.db("CustomFieldDefinition").insert({
          name: encrypted ? "Synthetic secret" : "Synthetic text",
          moduleId: 1,
          typeId: 1,
          isEncrypted: encrypted,
        });
        const [field] = await runtime.db("CustomFieldData").insert({
          moduleId: 1,
          itemId: accountId,
          definitionId: definition,
          data: "synthetic plain",
        });
        if (encrypted) {
          const secret = runtime.vault.encrypt(
            "synthetic field secret",
            `CustomFieldData/${field}/data`,
          );
          await runtime
            .db("CustomFieldData")
            .where({ id: field })
            .update({ data: secret.pass, key: secret.key });
        }
      }
      const admin = await runtime.db("User").where({ id: 1 }).first();
      const [factorUser] = await runtime.db("User").insert({
        name: "Synthetic MFA user",
        login: "synthetic-mfa-user",
        pass: admin.pass,
        hashSalt: randomBytes(32),
        userGroupId: 1,
        userProfileId: 1,
        isAdminApp: 0,
        isDisabled: 0,
        isLdap: 0,
      });
      await runtime.db("nodepass_factors").insert({
        userId: factorUser,
        kind: "totp",
        data: runtime.vault
          .wrap("JBSWY3DPEHPK3PXP", `totp/${factorUser}`)
          .toString("base64"),
        name: "Synthetic TOTP",
        confirmed: 1,
        counter: 0,
      });
      await runtime.vault.saveConfiguration("synthetic-config", {
        value: "synthetic configuration",
      });
    }, 60000);
    afterAll(async () => {
      vi.restoreAllMocks();
      await stop();
      if (drop) await drop();
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("creates durable jobs and a paginated list, then enforces management permissions", async () => {
      const queued = await call("backup-jobs", "POST", {});
      expect(queued.response.status).toBe(202);
      const done = await waitJob(queued.value.id);
      expect(done.state).toBe("complete");
      baseline = done.name;
      const list = await call("backups?skip=0&limit=1");
      expect(list.value.data[0]).toMatchObject({
        name: baseline,
        origin: "manual",
        inUse: false,
      });
      const binary = await fetch(base + "/api/v1/backups/" + baseline, {
        headers: { cookie },
      });
      expect(binary.status).toBe(200);
      expect(
        Buffer.from(await binary.arrayBuffer())
          .subarray(0, 4)
          .toString(),
      ).toBe("NPB1");
      const profile = await call("profiles", "POST", {
        name: "Synthetic backup reader",
        profile: { configBackup: true },
      });
      const user = await call("users", "POST", {
        name: "Synthetic backup reader",
        login: "backup-reader",
        password,
        userProfileId: profile.value.id,
        userGroupId: 1,
        groups: [],
      });
      expect(user.response.status).toBe(201);
      await login("backup-reader");
      expect((await call("backups")).response.status).toBe(200);
      expect((await call("backup-schedule")).response.status).toBe(403);
      expect(
        (await call("backups/" + baseline, "DELETE")).response.status,
      ).toBe(403);
      expect(
        (await call("backup-restores", "POST", { name: baseline })).response
          .status,
      ).toBe(403);
      expect(
        (await call("backup-schedule", "PATCH", { enabled: true })).response
          .status,
      ).toBe(403);
      await login();
      expect((await call("backups?skip=-1")).response.status).toBe(400);
      expect((await call("backups/unsafe")).response.status).toBe(400);
      expect(
        (await call("backup-jobs", "POST", {}, { "x-csrf-token": "wrong" }))
          .response.status,
      ).toBe(403);
      expect(
        (
          await call(
            "backup-jobs",
            "POST",
            {},
            { origin: "https://foreign.example.test" },
          )
        ).response.status,
      ).toBe(403);
      const second = await call("backups", "POST", {});
      expect(second.response.status).toBe(200);
      expect(
        (await call("backups/" + second.value.name, "DELETE")).response.status,
      ).toBe(204);
      expect(
        (await call("backups/" + second.value.name, "DELETE")).response.status,
      ).toBe(404);
    }, 60000);
    it("persists schedules and rejects malformed settings without weakening authentication", async () => {
      const input = {
        enabled: false,
        days: 3,
        time: "04:15",
        timezone: "Europe/Berlin",
        keep: 2,
      };
      expect(
        (await call("backup-schedule", "PATCH", input)).value,
      ).toMatchObject({ ...input, configured: true, nextAt: null });
      expect((await call("backup-schedule")).value.days).toBe(3);
      expect(
        (await call("backup-schedule", "PATCH", { ...input, keep: 0 })).response
          .status,
      ).toBe(400);
      await runtime
        .db("nodepass_sessions")
        .where({ id: digest(cookie.split("=")[1]!) })
        .update({
          verifiedAt: Date.now() - 600000,
          createdAt: Date.now() - 600000,
        });
      const old = await call("backup-schedule", "PATCH", input);
      expect(old.response.status).toBe(403);
      expect(old.value.code).toBe("REAUTHENTICATION_REQUIRED");
      expect(
        (await call("auth/confirm", "POST", { password })).response.status,
      ).toBe(200);
    });
    it("checks the whole file and key before destructive operations and scopes status access", async () => {
      const ticket = await begin();
      expect(
        (await call("backups/" + baseline, "DELETE")).response.status,
      ).toBe(409);
      expect((await call("backup-restores", "POST", {})).response.status).toBe(
        409,
      );
      expect(
        (
          await call(`backup-restores/${ticket.id}/check`, "POST", {
            key: "bad",
          })
        ).response.status,
      ).toBe(400);
      expect(await check(ticket, randomBytes(32))).toMatchObject({
        state: "upload",
        error: "verification",
      });
      expect(
        (await runtime.db("Account").where({ id: accountId }).first()).login,
      ).toBe("original");
      expect(
        (
          await call(`backup-restores/${ticket.id}/status`, "GET", undefined, {
            "x-backup-job-token": "wrong",
          })
        ).response.status,
      ).toBe(404);
      expect((await check(ticket)).state).toBe("ready");
      const badCommit = await commit(ticket, token());
      expect(badCommit.response.status).toBe(403);
      const grant = await authorize(ticket);
      expect(
        (
          await call(`backup-restores/${ticket.id}/commit`, "POST", {
            confirmation: "wrong",
            authorization: grant,
          })
        ).response.status,
      ).toBe(403);
      await cancel(ticket);
      expect(
        (await readdir(runtime.backups.files.work)).some((name) =>
          name.endsWith(".records"),
        ),
      ).toBe(false);
    }, 60000);
    it("rejects a tampered uploaded file before changing any table", async () => {
      const bytes = await readFile(runtime.backups.files.path(baseline));
      bytes[bytes.length - 1]! ^= 1;
      const created = await call("backup-restores", "POST", {});
      const ticket: RestoreTicket = created.value;
      expect(
        (
          await call(`backup-restores/${ticket.id}/upload`, "PUT", {
            offset: 1,
            content: bytes.toString("base64"),
            final: true,
          })
        ).response.status,
      ).toBe(409);
      expect(
        (
          await call(`backup-restores/${ticket.id}/upload`, "PUT", {
            offset: 0,
            content: bytes.toString("base64"),
            final: true,
          })
        ).response.status,
      ).toBe(200);
      expect((await check(ticket)).error).toBe("verification");
      expect(
        (await runtime.db("Account").where({ id: accountId }).first()).login,
      ).toBe("original");
      await cancel(ticket);
    });
    it("rejects unknown target objects before deleting any data", async () => {
      await runtime.db.schema.createTable("Unexpected", (t) =>
        t.integer("id").primary(),
      );
      const ticket = await begin();
      expect((await check(ticket)).error).toBe("verification");
      expect(await runtime.db.schema.hasTable("Unexpected")).toBe(true);
      expect(
        await runtime.db("Account").where({ id: accountId }).first(),
      ).toBeTruthy();
      await runtime.db.schema.dropTable("Unexpected");
      await cancel(ticket);
    });
    it("restores a foreign-key backup, gates every API during maintenance, and revokes sessions", async () => {
      const foreign = await isolatedDatabase(loadConfig()),
        db = database(foreign.config),
        key = randomBytes(32);
      let bytes: Buffer;
      try {
        await restore(
          db,
          runtime.backups.files.path(baseline),
          config.deploymentKey,
          key,
          directory,
        );
        await putSetting(db, "backups/schedule", {
          enabled: true,
          days: 2,
          time: "02:00",
          timezone: "UTC",
          keep: 2,
          configured: true,
          nextAt: Date.parse("2030-01-01T02:00:00Z"),
          lastAttemptAt: null,
          lastSuccessAt: null,
          error: null,
        });
        const name = await backup(db, join(directory, "foreign"), key, {
          publicUrl: config.publicUrl,
        });
        bytes = await readFile(join(directory, "foreign", name));
      } finally {
        await db.destroy();
        await foreign.drop();
      }
      await runtime
        .db("Account")
        .where({ id: accountId })
        .update({ login: "changed-after-backup" });
      const created = await call("backup-restores", "POST", {}),
        ticket: RestoreTicket = created.value;
      expect(
        (
          await call(`backup-restores/${ticket.id}/upload`, "PUT", {
            offset: 0,
            content: bytes!.toString("base64"),
            final: true,
          })
        ).response.status,
      ).toBe(200);
      expect((await check(ticket, key)).state).toBe("ready");
      key.fill(0);
      let reached = false,
        release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const metadata = runtime.backups.files.metadata.bind(
        runtime.backups.files,
      );
      const spy = vi
        .spyOn(runtime.backups.files, "metadata")
        .mockImplementation(async (name, value) => {
          if (value.origin === "safety") {
            reached = true;
            await gate;
          }
          return metadata(name, value);
        });
      try {
        expect(
          (await commit(ticket, await authorize(ticket))).response.status,
        ).toBe(202);
        for (let i = 0; i < 500 && !reached; i++)
          await new Promise((done) => setTimeout(done, 20));
        expect(reached).toBe(true);
        for (const path of [
          "accounts",
          "auth/session",
          "public/synthetic",
          "backups",
        ])
          expect((await call(path)).response.status).toBe(503);
        expect(
          (
            await call("auth/login", "POST", {
              login: "backup-admin",
              password,
            })
          ).response.status,
        ).toBe(503);
        expect(
          (await fetch(base + "/api.php", { method: "POST" })).status,
        ).toBe(503);
        expect((await fetch(base + "/health/live")).status).toBe(200);
        expect((await fetch(base + "/health/ready")).status).toBe(503);
        expect((await call("status")).value).toMatchObject({
          maintenance: true,
          setupRequired: false,
        });
      } finally {
        release();
        spy.mockRestore();
      }
      const done = await waitRestore(ticket, ["complete", "failed"]);
      expect(done, JSON.stringify(done)).toMatchObject({ state: "complete" });
      expect((await call("auth/session")).response.status).toBe(401);
      await login();
      expect(
        (await runtime.db("Account").where({ id: accountId }).first()).login,
      ).toBe("original");
      expect((await call("backup-schedule")).value.enabled).toBe(false);
      expect(runtime.backups.config.deploymentKey).toEqual(
        config.deploymentKey,
      );
      expect(
        (await call("accounts/" + accountId + "/secret", "POST", {})).value
          .password,
      ).toBe("synthetic-original-secret");
      expect(
        (await call("backups")).value.data.some(
          (item: { origin: string }) => item.origin === "safety",
        ),
      ).toBe(true);
      expect(
        (await commit(ticket, token())).response.status,
      ).toBeGreaterThanOrEqual(400);
    }, 60000);
    it("automatically rolls back a failure after the database has been replaced", async () => {
      await runtime
        .db("Account")
        .where({ id: accountId })
        .update({ login: "preserve-on-failure" });
      const ticket = await begin();
      expect((await check(ticket)).state).toBe("ready");
      const fault = vi
        .spyOn(runtime.backups, "disableAfterRestore")
        .mockRejectedValueOnce(new Error("synthetic restore failure"));
      expect(
        (await commit(ticket, await authorize(ticket))).response.status,
      ).toBe(202);
      const done = await waitRestore(ticket, ["complete", "failed"]);
      fault.mockRestore();
      expect(done, JSON.stringify(done)).toMatchObject({
        state: "failed",
        error: "rolledBack",
      });
      await login();
      expect(
        (await runtime.db("Account").where({ id: accountId }).first()).login,
      ).toBe("preserve-on-failure");
      expect((await fetch(base + "/health/ready")).status).toBe(200);
    }, 60000);
    it("recovers an interrupted rebuild before normal startup and fails closed for a corrupt safety copy", async () => {
      const saved = await call("backups", "POST", {});
      const name = saved.value.name;
      const bytes = await readFile(runtime.backups.files.path(name));
      const binding = digest(
        `${config.database.host}:${config.database.port}/${config.database.database}`,
      );
      const writeJournal = async () =>
        atomicJson(runtime.backups.files.workPath("restore-journal.json"), {
          sealed: seal(
            JSON.stringify({
              id: token(),
              database: binding,
              safety: name,
              phase: "replacing",
            }),
            config.deploymentKey,
            `restore-journal/${binding}`,
          ).toString("base64"),
        });
      await stop();
      await writeJournal();
      const db = database(config);
      await withLock(db, () => clearTarget(db));
      await db.destroy();
      const corrupt = Buffer.from(bytes);
      corrupt[20]! ^= 1;
      await writeFile(join(directory, "backups", name), corrupt);
      await start();
      expect((await call("status")).value.maintenance).toBe(true);
      expect(
        (
          await call(
            "setup/fresh",
            "POST",
            {},
            { "x-setup-token": config.setupToken },
          )
        ).response.status,
      ).toBe(503);
      expect((await fetch(base + "/health/live")).status).toBe(200);
      expect((await fetch(base + "/health/ready")).status).toBe(503);
      await stop();
      await writeFile(join(directory, "backups", name), bytes);
      await start();
      expect((await fetch(base + "/health/ready")).status).toBe(200);
      await login();
      expect(
        (await runtime.db("Account").where({ id: accountId }).first()).login,
      ).toBe("preserve-on-failure");
      expect(
        (await call("backups")).value.data.some(
          (item: { name: string }) => item.name === name,
        ),
      ).toBe(true);
    }, 60000);
    it("invalidates old preparations after offline key rotation without blocking startup", async () => {
      const ticket = await begin();
      expect((await check(ticket)).state).toBe("ready");
      const work = runtime.backups.files.work;
      const metadata = join(work, `restore-${ticket.id}.json`);
      await stop();
      const db = database(config),
        oldKey = config.deploymentKey,
        newKey = randomBytes(32);
      const vault = new Vault(db, oldKey);
      try {
        await vault.load();
        await vault.rewrapDeployment(newKey);
      } finally {
        vault.destroy();
        await db.destroy();
      }
      const expired = new Date(Date.now() - 3600001);
      await utimes(metadata, expired, expired);
      config = { ...config, deploymentKey: newKey };
      await start();
      expect((await fetch(base + "/health/ready")).status).toBe(200);
      await login();
      expect(
        (
          await call(`backup-restores/${ticket.id}/status`, "GET", undefined, {
            "x-backup-job-token": ticket.statusToken,
          })
        ).response.status,
      ).toBe(404);
      expect(
        (await readdir(work)).some((name) =>
          name.startsWith(`restore-${ticket.id}.`),
        ),
      ).toBe(false);
      expect((await call("backups")).value.total).toBeGreaterThan(0);
      expect(
        (await call("accounts/" + accountId + "/secret", "POST", {})).value
          .password,
      ).toBe("synthetic-original-secret");
    }, 60000);
  },
);
