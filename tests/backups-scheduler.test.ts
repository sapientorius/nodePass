import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type Config } from "../packages/server/src/config.js";
import {
  database,
  putSetting,
  type Database,
} from "../packages/server/src/db.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { Backups } from "../packages/server/src/services/backups.js";
import {
  atomicJson,
  readJson,
} from "../packages/server/src/services/backup-files.js";
import { backup } from "../packages/server/src/migration/backup.js";
import { token } from "../packages/server/src/security/crypto.js";
import { isolatedDatabase } from "./database.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "persistent automatic backups",
  () => {
    let config: Config,
      db: Database,
      backups: Backups,
      drop: () => Promise<void>,
      directory: string;
    let now = Date.parse("2030-01-01T00:00:00Z");
    const input = {
      enabled: true,
      days: 1,
      time: "02:00",
      timezone: "Europe/Berlin",
      keep: 1,
    };
    beforeEach(async () => {
      if (existsSync(".cache/integration.env"))
        process.loadEnvFile(".cache/integration.env");
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      directory = await mkdtemp(join(tmpdir(), "nodepass-backup-scheduler-"));
      config = {
        ...isolated.config,
        dataDir: directory,
        deploymentKey: randomBytes(32),
        setupToken: token(),
      };
      db = database(config);
      const vault = new Vault(db, config.deploymentKey);
      await new Migration(db, vault, config).fresh({
        login: "synthetic-schedule-admin",
        name: "Synthetic scheduler",
        password: "Synthetic-Schedule!Credentials-4829",
        token: config.setupToken,
      });
      vault.destroy();
      now = Date.parse("2030-01-01T00:00:00Z");
      backups = new Backups(db, config, () => now);
      await backups.initialize();
    }, 60000);
    afterEach(async () => {
      vi.restoreAllMocks();
      if (backups) await backups.stop();
      if (db) await db.destroy();
      if (drop) await drop();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    it("catches up only once, serializes ticks, and retains only automatic versions", async () => {
      await backups.configure(input, 1);
      const manual = await backups.create(1);
      await backups.wait();
      expect((await backups.job(manual.id))?.state).toBe("complete");
      const safety = await backup(
        db,
        backups.files.directory,
        config.deploymentKey,
        {},
      );
      await backups.files.metadata(safety, { origin: "safety" });
      now = (await backups.schedule()).nextAt! + 3 * 86400000;
      await Promise.all([
        backups.checkDue(),
        backups.checkDue(),
        backups.checkDue(),
      ]);
      expect(
        (await backups.files.list()).data.filter(
          (f) => f.origin === "automatic",
        ),
      ).toHaveLength(1);
      expect((await backups.schedule()).nextAt).toBeGreaterThan(now);
      const before = (await backups.files.list()).data.find(
        (f) => f.origin === "automatic",
      )!;
      const lease = await backups.files.lease(before.name);
      now = (await backups.schedule()).nextAt!;
      await backups.checkDue();
      expect(
        (await backups.files.list()).data.filter(
          (f) => f.origin === "automatic",
        ),
      ).toHaveLength(2);
      await lease.release();
      now = (await backups.schedule()).nextAt!;
      await backups.checkDue();
      const list = await backups.files.list();
      expect(list.data.filter((f) => f.origin === "automatic")).toHaveLength(1);
      expect(list.data.filter((f) => f.origin === "manual")).toHaveLength(1);
      expect(list.data.filter((f) => f.origin === "safety")).toHaveLength(1);
      const schedule = await backups.schedule();
      expect(schedule.lastSuccessAt).toBe(now);
      expect(schedule.error).toBeNull();
      await backups.configure({ ...input, enabled: false }, 1);
      now += 3 * 86400000;
      await backups.checkDue();
      expect((await backups.files.list()).total).toBe(3);
    }, 60000);
    it("retries at 15 and 60 minutes, preserves existing copies and advances after three failures", async () => {
      const manual = await backups.create(1);
      await backups.wait();
      await backups.configure(input, 1);
      now = (await backups.schedule()).nextAt!;
      const fault = vi
        .spyOn(backups.files, "metadata")
        .mockRejectedValue(new Error("synthetic unavailable storage"));
      await backups.checkDue();
      const first = await backups.schedule();
      expect(first.error).toBe("unavailable");
      expect(fault).toHaveBeenCalledTimes(1);
      now += 14 * 60000;
      await backups.checkDue();
      expect(fault).toHaveBeenCalledTimes(1);
      now += 60000;
      await backups.checkDue();
      expect(fault).toHaveBeenCalledTimes(2);
      now += 59 * 60000;
      await backups.checkDue();
      expect(fault).toHaveBeenCalledTimes(2);
      now += 60000;
      await backups.checkDue();
      expect(fault).toHaveBeenCalledTimes(3);
      expect((await backups.schedule()).nextAt).toBeGreaterThan(now);
      expect((await backups.job(manual.id))?.state).toBe("complete");
      expect((await backups.files.list()).data.map((f) => f.origin)).toEqual([
        "manual",
      ]);
      fault.mockRestore();
      now = (await backups.schedule()).nextAt!;
      await backups.checkDue();
      expect((await backups.schedule()).error).toBeNull();
    }, 60000);
    it("does not duplicate a finalized file after failure or replay of a persisted slot", async () => {
      await backups.configure(input, 1);
      now = (await backups.schedule()).nextAt!;
      const slot = now,
        original = backups.files.metadata.bind(backups.files);
      let writes = 0;
      const fault = vi
        .spyOn(backups.files, "metadata")
        .mockImplementation(async (...args) => {
          if (++writes === 2)
            throw new Error("synthetic interrupted final metadata");
          return original(...args);
        });
      await backups.checkDue();
      expect((await backups.files.list()).total).toBe(1);
      fault.mockRestore();
      now += 15 * 60000;
      const restarted = new Backups(db, config, () => now);
      await restarted.initialize();
      await restarted.checkDue();
      expect((await restarted.files.list()).total).toBe(1);
      const schedule = await restarted.schedule();
      expect(schedule.error).toBeNull();
      await putSetting(db, "backups/schedule", { ...schedule, nextAt: slot });
      await restarted.checkDue();
      expect((await restarted.files.list()).total).toBe(1);
      expect((await restarted.schedule()).nextAt).toBeGreaterThan(now);
      await restarted.stop();
    }, 60000);
    it("preserves the last good automatic copy when secrets in the new snapshot are corrupt", async () => {
      await backups.configure(input, 1);
      now = (await backups.schedule()).nextAt!;
      await backups.checkDue();
      const original = (await backups.files.list()).data[0]!;
      const keyring = await db("nodepass_keyring")
        .where({ id: "vault" })
        .first();
      await db("nodepass_keyring")
        .where({ id: "vault" })
        .update({ value: Buffer.from("synthetic corrupt keyring") });
      try {
        now = (await backups.schedule()).nextAt!;
        await backups.checkDue();
        expect((await backups.schedule()).error).toBe("unavailable");
        expect((await backups.files.list()).data.map((f) => f.name)).toEqual([
          original.name,
        ]);
        expect(
          (await readdir(backups.files.directory)).some((n) =>
            n.endsWith(".partial"),
          ),
        ).toBe(false);
      } finally {
        await db("nodepass_keyring")
          .where({ id: "vault" })
          .update({ value: keyring.value });
      }
      now += 15 * 60000;
      await backups.checkDue();
      expect((await backups.schedule()).error).toBeNull();
      expect((await backups.files.list()).total).toBe(1);
    }, 60000);
    it("resumes an interrupted manual job without creating another archive", async () => {
      const id = token(),
        name = backups.files.name();
      await backup(db, backups.files.directory, config.deploymentKey, {}, name);
      await atomicJson(backups.files.workPath(`create-${id}.json`), {
        id,
        name,
        state: "running",
        step: "creating",
        origin: "manual",
        userId: 1,
        attempts: 1,
        retryAt: 0,
      });
      await backups.start();
      expect(await backups.job(id)).toMatchObject({ state: "complete", name });
      expect((await backups.files.list()).total).toBe(1);
      await expect(backups.job("invalid")).rejects.toThrow();
      await backups.pause();
      await expect(backups.create(1)).rejects.toThrow("active");
      expect(
        await readJson(backups.files.workPath("absent.json")),
      ).toBeUndefined();
      expect(
        (await readdir(backups.files.work)).some((n) => n.endsWith(".partial")),
      ).toBe(false);
    }, 60000);
  },
);
