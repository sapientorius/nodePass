import { seedLegacy } from "./legacy.js";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isolatedDatabase } from "./database.js";
import { loadConfig, type Config } from "../packages/server/src/config.js";
import {
  database,
  getSetting,
  type Database,
} from "../packages/server/src/db.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { backup, readBackup } from "../packages/server/src/migration/backup.js";
import { restore } from "../packages/server/src/migration/restore.js";
import { randomBytes } from "node:crypto";
import { Auth } from "../packages/server/src/security/auth.js";
import { Accounts } from "../packages/server/src/services/accounts.js";
import { jsonRpc } from "../packages/server/src/compat/jsonrpc.js";
import type { Context } from "koa";
const enabled = process.env.NODEPASS_INTEGRATION === "1",
  reference = JSON.parse(
    readFileSync(new URL("fixtures/reference.json", import.meta.url), "utf8"),
  );
describe.skipIf(!enabled)(
  "sysPass takeover, restart and authenticated recovery",
  () => {
    let config: Config,
      db: Database,
      vault: Vault,
      migration: Migration,
      drop: () => Promise<void>,
      saved = "";
    beforeAll(async () => {
      if (existsSync(".cache/integration.env"))
        process.loadEnvFile(".cache/integration.env");
      const isolated = await isolatedDatabase(loadConfig());
      config = isolated.config;
      config = {
        ...config,
        legacy: { passwordSalt: reference.publicLink.salt },
      };
      drop = isolated.drop;
      db = database(config);
      await seedLegacy(db);
      vault = new Vault(db, config.deploymentKey);
      migration = new Migration(db, vault, config);
    });
    afterAll(async () => {
      vault?.destroy();
      if (db) await db.destroy();
      if (drop) await drop();
    });
    it("checks the actual schema and rejects wrong credentials before any migration", async () => {
      const preflight = await migration.preflight();
      expect(preflight.tables.Account).toBeGreaterThan(0);
      await expect(
        migration.takeover({
          login: "admin",
          password: "a".repeat(72),
          masterPassword: "wrong",
          token: config.setupToken,
          maintenance: true,
        }),
      ).rejects.toThrow("Invalid master password");
      await expect(
        migration.takeover({
          login: "admin",
          password: "wrong",
          masterPassword: reference.master,
          token: config.setupToken,
          maintenance: true,
        }),
      ).rejects.toThrow();
      expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
    });
    it("takes over original ciphertext, files, links and existing TOTP without losing IDs", async () => {
      saved = (
        await migration.takeover({
          login: "admin",
          password: "a".repeat(72),
          masterPassword: reference.master,
          token: config.setupToken,
          maintenance: true,
        })
      ).backup;
      expect(await getSetting(db, "initialized", false)).toBe(true);
      const account = await db("Account").where({ id: 1 }).first();
      expect(
        (await vault.decrypt(account.pass, account.key, "Account/1/pass"))
          .length,
      ).toBeGreaterThan(0);
      const user = await db("User").where({ id: 1 }).first();
      expect(user.mPass).toBe(null);
      expect(user.mKey).toBe(null);
      const file = await db("AccountFile").where({ id: 1 }).first(),
        attachment = await db("nodepass_attachments").where({ id: 1 }).first();
      expect(Buffer.from(file.content).length).toBe(0);
      expect(
        vault
          .unwrap(Buffer.from(attachment.content), "attachment/1")
          .toString(),
      ).toBe("synthetic contents");
      const link = await db("PublicLink").where({ id: 1 }).first();
      expect(Buffer.from(link.hash).toString()).toBe(reference.publicLink.hash);
      expect(
        JSON.parse(
          vault.unwrap(Buffer.from(link.data), "public-link/1").toString(),
        ).pass,
      ).toBe("synthetic secret");
      const factor = await db("nodepass_factors")
        .where({ userId: 1, kind: "totp" })
        .first();
      expect(
        vault.unwrap(Buffer.from(factor.data, "base64"), "totp/1").toString(),
      ).toBe("JBSWY3DPEHPK3PXP");
      expect(
        await db("PluginData").where({ name: "Authenticator" }),
      ).toHaveLength(0);
    });
    it("keeps old API token passwords and the exact legacy permission relations", async () => {
      const auth = new Auth(db, config, vault),
        accounts = new Accounts(db, vault),
        now = Date.now(),
        params = {
          identity: {
            user: await auth.user(2),
            session: {
              id: "migration-read",
              userId: 2,
              csrf: "test",
              complete: 1,
              createdAt: now,
              lastSeen: now,
              verifiedAt: now,
            },
          },
        };
      expect((await accounts.find(params)).data.map((a) => a.id)).toContain(1);
      await expect(accounts.get(2, params)).rejects.toThrow();
      expect((await accounts.get(1, params)).permissions.edit).toBe(false);
      expect((await accounts.get(1, params)).tags).toEqual(["legacy-ops"]);
      const token = await db("AuthToken").where({ id: 1 }).first();
      expect(token.vault).toBe(null);
      expect(Buffer.from(token.hash).toString()).toBe(reference.hashes[1].hash);
      const ctx = {
        request: {
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "account/viewPass",
            params: {
              id: 1,
              authToken: "synthetic-legacy-auth-token",
              tokenPass: "a".repeat(72),
            },
          },
        },
        ip: "127.0.0.1",
      } as unknown as Context;
      await jsonRpc(ctx, auth, accounts);
      const account = await db("Account").where({ id: 1 }).first();
      expect((ctx.body as any).result.result.password).toBe(
        await vault.decrypt(account.pass, account.key, "Account/1/pass"),
      );
    });
    it("unlocks after restart using only the deployment key and rejects a second takeover", async () => {
      vault.destroy();
      vault = new Vault(db, config.deploymentKey);
      await vault.load();
      expect(vault.unlocked).toBe(true);
      const row = await db("Account").where({ id: 1 }).first();
      expect(
        (await vault.decrypt(row.pass, row.key, "Account/1/pass")).length,
      ).toBeGreaterThan(0);
      await expect(
        migration.takeover({
          login: "admin",
          password: "a".repeat(72),
          masterPassword: reference.master,
          token: config.setupToken,
          maintenance: true,
        }),
      ).rejects.toThrow("already initialized");
    });
    it("authenticates backups before restore and recovers into a separate database", async () => {
      const old = await readBackup(
        resolve(config.dataDir, "backups", saved),
        config.deploymentKey,
        resolve(config.dataDir, "restore-test"),
      );
      expect(
        old.records.some(
          (r) =>
            r.table === "User" &&
            Buffer.from(r.row.mPass).toString() === "obsolete master wrapper",
        ),
      ).toBe(true);
      const legacyTarget = await isolatedDatabase(loadConfig()),
        legacyDb = database(legacyTarget.config);
      try {
        await restore(
          legacyDb,
          resolve(config.dataDir, "backups", saved),
          config.deploymentKey,
          config.deploymentKey,
          resolve(config.dataDir, "restore-legacy"),
        );
        expect(
          (await legacyDb("Account").where({ id: 1 }).first()).pass,
        ).toEqual((await db("Account").where({ id: 1 }).first()).pass);
        expect(
          (await legacyDb("User").where({ id: 1 }).first()).mPass.toString(),
        ).toBe("obsolete master wrapper");
        expect(await getSetting(legacyDb, "initialized", false)).toBe(false);
      } finally {
        await legacyDb.destroy();
        await legacyTarget.drop();
      }
      await db("nodepass_sessions").insert({
        id: "synthetic-session",
        userId: 1,
        csrf: "synthetic-csrf",
        complete: 1,
        verifiedAt: Date.now(),
        createdAt: Date.now(),
        lastSeen: Date.now(),
      });
      const name = await backup(
        db,
        resolve(config.dataDir, "backups"),
        config.deploymentKey,
        { legacy: config.legacy },
      );
      const path = resolve(config.dataDir, "backups", name),
        bytes = await readFile(path);
      bytes[20] = bytes[20]! ^ 1;
      const corrupt = resolve(config.dataDir, "backups", "tampered.npb");
      await writeFile(corrupt, bytes);
      await expect(
        readBackup(
          corrupt,
          config.deploymentKey,
          resolve(config.dataDir, "restore-test"),
        ),
      ).rejects.toThrow();
      const isolated = await isolatedDatabase(loadConfig()),
        target = database(isolated.config),
        newKey = randomBytes(32);
      try {
        await restore(
          target,
          path,
          config.deploymentKey,
          newKey,
          resolve(config.dataDir, "restore-test"),
        );
        const recovered = new Vault(target, newKey);
        await recovered.load();
        const row = await target("Account").where({ id: 1 }).first();
        expect(
          (await recovered.decrypt(row.pass, row.key, "Account/1/pass")).length,
        ).toBeGreaterThan(0);
        expect(await target("nodepass_sessions")).toHaveLength(0);
        recovered.destroy();
      } finally {
        await target.destroy();
        await isolated.drop();
      }
    });
  },
);
