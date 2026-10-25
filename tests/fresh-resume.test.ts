import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../packages/server/src/config.js";
import { database, type Database } from "../packages/server/src/db.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { isolatedDatabase } from "./database.js";
import { testPassword } from "./harness.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "fresh installation resumes without overwriting existing data",
  () => {
    let db: Database,
      vault: Vault,
      migration: Migration,
      config: ReturnType<typeof loadConfig>,
      drop: () => Promise<void>;
    const input = () => ({
      login: "admin",
      name: "Fresh admin",
      password: testPassword,
      token: config.setupToken,
    });
    beforeEach(async () => {
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      config = {
        ...isolated.config,
        dataDir: await mkdtemp(join(tmpdir(), "nodepass-fresh-")),
      };
      db = database(config);
      vault = new Vault(db, config.deploymentKey);
      migration = new Migration(db, vault, config);
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      vault?.destroy();
      await db?.destroy();
      await drop?.();
      await rm(config.dataDir, { recursive: true, force: true });
    });
    it("rejects invalid identities and a nonempty database before creating a checkpoint", async () => {
      for (const data of [
        { login: "bad login" },
        { name: "" },
        { name: "x".repeat(81) },
      ])
        await expect(migration.fresh({ ...input(), ...data })).rejects.toThrow(
          "administrator",
        );
      await db.schema.createTable("Unexpected", (t) =>
        t.integer("id").primary(),
      );
      await expect(migration.fresh(input())).rejects.toThrow("not empty");
      expect(await readdir(config.dataDir)).toEqual([]);
    });
    it("resumes interrupted DDL with only the original identity, and refuses drift or preexisting rows", async () => {
      const raw = db.raw.bind(db),
        fault = vi.spyOn(db, "raw").mockImplementation(((
          sql: string,
          ...args: any[]
        ) => {
          if (/^CREATE TABLE `User`/.test(sql))
            throw new Error("Simulated DDL failure");
          return raw(sql, ...args);
        }) as any);
      await expect(migration.fresh(input())).rejects.toThrow("DDL failure");
      fault.mockRestore();
      expect(await db.schema.hasTable("Account")).toBe(true);
      expect(await db.schema.hasTable("User")).toBe(false);
      await expect(
        migration.fresh({
          ...input(),
          password: "another saffron telescope orchard 991!",
        }),
      ).rejects.toThrow("Original setup");
      await db.schema.createTable("Unexpected", (t) =>
        t.integer("id").primary(),
      );
      await expect(migration.fresh(input())).rejects.toThrow("Unknown table");
      await db.schema.dropTable("Unexpected");
      await db.schema.alterTable("Account", (t) =>
        t.string("name", 101).alter(),
      );
      await expect(migration.fresh(input())).rejects.toThrow("schema mismatch");
      await db.schema.alterTable("Account", (t) =>
        t.string("name", 100).alter(),
      );
      await db("Category").insert({
        id: 1,
        name: "External data",
        hash: "synthetic-external-row",
      });
      await expect(migration.fresh(input())).rejects.toThrow("existing data");
      expect((await db("Category").where({ id: 1 }).first()).name).toBe(
        "External data",
      );
      await db("Category").where({ id: 1 }).delete();
      await migration.fresh(input());
      expect((await migration.status()).ready).toBe(true);
      expect(await db("User")).toHaveLength(1);
      expect(
        (await readdir(config.dataDir)).filter((f) => f.endsWith(".setup")),
      ).toHaveLength(0);
      await expect(migration.fresh(input())).rejects.toThrow("initialized");
    });
    it("resumes after keyring persistence and an aborted atomic seed transaction", async () => {
      const fault = vi
        .spyOn(db, "transaction")
        .mockRejectedValueOnce(new Error("Simulated seed failure"));
      await expect(migration.fresh(input())).rejects.toThrow("seed failure");
      fault.mockRestore();
      expect(await db("User")).toHaveLength(0);
      expect(await db("nodepass_keyring")).toHaveLength(1);
      vault.destroy();
      vault = new Vault(db, config.deploymentKey);
      migration = new Migration(db, vault, config);
      await migration.fresh(input());
      expect((await migration.status()).ready).toBe(true);
      expect(vault.unlocked).toBe(true);
      expect(await db("User")).toHaveLength(1);
    });
  },
);
