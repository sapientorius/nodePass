import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../packages/server/src/config.js";
import {
  database,
  migrate,
  withLock,
  type Database,
} from "../packages/server/src/db.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { isolatedDatabase } from "./database.js";
import { seedLegacy, legacyReference as reference } from "./legacy.js";
import { encryptDefuse } from "../packages/server/src/compat/defuse.js";
import { serializePhp } from "./serialization.js";
import { readBackup } from "../packages/server/src/migration/backup.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "migration refuses unknown data and resumes the same original backup",
  () => {
    let db: Database,
      vault: Vault,
      migration: Migration,
      config: ReturnType<typeof loadConfig>,
      drop: () => Promise<void>;
    const input = () => ({
      login: "admin",
      password: "a".repeat(72),
      masterPassword: reference.master,
      token: config.setupToken,
      maintenance: true,
    });
    beforeAll(async () => {
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      config = {
        ...isolated.config,
        legacy: { passwordSalt: reference.publicLink.salt },
        dataDir: await mkdtemp(join(tmpdir(), "nodepass-migration-")),
      };
      db = database(config);
      await seedLegacy(db);
      vault = new Vault(db, config.deploymentKey);
      migration = new Migration(db, vault, config);
    });
    afterAll(async () => {
      vault?.destroy();
      await db?.destroy();
      await drop?.();
      if (config?.dataDir)
        await rm(config.dataDir, { recursive: true, force: true });
    });
    it("requires the setup secret, maintenance mode and exact legacy columns while accepting version metadata", async () => {
      expect(await migration.status()).toEqual({
        installed: false,
        legacy: true,
        ready: false,
      });
      expect(() => migration.authorize("wrong")).toThrow();
      await db.schema.alterTable("Account", (table) =>
        table.dropForeign("categoryId", "fk_Account_categoryId"),
      );
      await expect(migration.preflight()).rejects.toThrow("foreign-key");
      await db.schema.alterTable("Account", (table) =>
        table
          .foreign("categoryId", "fk_Account_categoryId")
          .references("id")
          .inTable("Category"),
      );
      await db("CustomFieldDefinition")
        .where({ id: 1 })
        .update({ moduleId: 63 });
      await expect(migration.preflight()).rejects.toThrow(
        "custom-field module",
      );
      await db("CustomFieldDefinition")
        .where({ id: 1 })
        .update({ moduleId: 10 });
      await db("CustomFieldData").where({ id: 1 }).update({ moduleId: 61 });
      await expect(migration.preflight()).rejects.toThrow("module mismatch");
      await db("CustomFieldData")
        .where({ id: 1 })
        .update({ moduleId: 10, itemId: 99999 });
      await expect(migration.preflight()).rejects.toThrow("target is missing");
      await db("CustomFieldData").where({ id: 1 }).update({ itemId: 1 });
      const existingField = await db("CustomFieldData")
        .where({ id: 1 })
        .first();
      await db("CustomFieldData").insert({ ...existingField, id: 99999 });
      await expect(migration.preflight()).rejects.toThrow("Duplicate");
      await db("CustomFieldData").where({ id: 99999 }).delete();
      await db.schema.createTable("UnknownPluginTable", (t) =>
        t.integer("id").primary(),
      );
      await expect(migration.preflight()).rejects.toThrow(
        "Unknown database table",
      );
      await db.schema.dropTable("UnknownPluginTable");
      await db.raw("ALTER TABLE EventLog ENGINE=MyISAM");
      await expect(migration.preflight()).rejects.toThrow("engine");
      await db.raw("ALTER TABLE EventLog ENGINE=InnoDB");
      await db.raw("CREATE VIEW account_data_v AS SELECT id FROM Account");
      await expect(migration.preflight()).resolves.toBeDefined();
      await db.raw("DROP VIEW account_data_v");
      await expect(
        migration.takeover({ ...input(), maintenance: false }),
      ).rejects.toThrow("Stop sysPass");
      await expect(
        migration.fresh({
          login: "a",
          name: "a",
          password: "saffron violin telescope orchard 77!",
          token: config.setupToken,
        }),
      ).rejects.toThrow("not empty");
      await expect(
        migration.preflight({ appVersion: "310.19081801" }),
      ).resolves.toMatchObject({
        warnings: [expect.stringContaining("3.2.11")],
      });
      await expect(
        migration.preflight({
          appVersion: "300.1",
          databaseVersion: "unknown",
        }),
      ).resolves.toBeDefined();
      await db.schema.alterTable("Account", (table) => {
        table.integer("unexpectedColumn");
      });
      await expect(migration.preflight()).rejects.toThrow(
        "Unknown legacy column",
      );
      await db.schema.alterTable("Account", (table) => {
        table.dropColumn("unexpectedColumn");
      });
      await db.schema.alterTable("Account", (table) => {
        table.string("name", 101).alter();
      });
      await expect(
        migration.preflight({
          appVersion: "310.19081801",
          databaseVersion: "unknown",
        }),
      ).rejects.toThrow("schema");
      await db.schema.alterTable("Account", (table) => {
        table.string("name", 100).alter();
      });
      const raw = db.raw.bind(db),
        spy = vi
          .spyOn(db, "raw")
          .mockImplementation(((sql: string, ...args: any[]) =>
            sql === "SELECT VERSION() AS version"
              ? Promise.resolve([[{ version: "5.7.44" }]])
              : raw(sql, ...args)) as any);
      await expect(migration.preflight()).rejects.toThrow("database server");
      spy.mockRestore();
    });
    it("retains the active local application administrator requirement", async () => {
      const original = await db("User").where({ id: 1 }).first();
      try {
        for (const [patch, reason] of [
          [{ isDisabled: 1 }, "disabled"],
          [{ isAdminApp: 0 }, "not_application_admin"],
          [{ isLdap: 1 }, "external_auth"],
        ] as const) {
          await db("User")
            .where({ id: 1 })
            .update({ isDisabled: 0, isAdminApp: 1, isLdap: 0, ...patch });
          await expect(migration.takeover(input())).rejects.toMatchObject({
            code: 403,
            setupCode: "SETUP_ADMIN_REQUIRED",
            data: { reason },
          });
          expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
        }
      } finally {
        await db("User").where({ id: 1 }).update({
          isDisabled: original.isDisabled,
          isAdminApp: original.isAdminApp,
          isLdap: original.isLdap,
        });
      }
    });
    it("distinguishes missing, ambiguous and unverified administrator credentials before changes", async () => {
      for (const [patch, reason] of [
        [{ login: "missing-local-admin" }, "not_found"],
        [{ password: "synthetic-wrong-password" }, "password_rejected"],
      ] as const) {
        await expect(
          migration.takeover({ ...input(), ...patch }),
        ).rejects.toMatchObject({
          code: 403,
          setupCode: "SETUP_ADMIN_REQUIRED",
          data: { reason },
        });
        expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
      }
      const original = await db("User").where({ id: 1 }).first();
      try {
        await db("User").insert({ ...original, id: 999, ssoLogin: null });
        await expect(migration.takeover(input())).rejects.toMatchObject({
          code: 403,
          setupCode: "SETUP_ADMIN_REQUIRED",
          data: { reason: "ambiguous" },
        });
        expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
      } finally {
        await db("User").where({ id: 999 }).delete();
      }
    });
    it("validates every secret, profile and preference before any nodePass table exists", async () => {
      const row = await db("Account").where({ id: 1 }).first();
      await db("Account")
        .where({ id: 1 })
        .update({ key: Buffer.alloc(0) });
      await expect(migration.takeover(input())).rejects.toThrow(
        "Missing encrypted",
      );
      await db("Account").where({ id: 1 }).update({ key: row.key, pass: "00" });
      await expect(migration.takeover(input())).rejects.toThrow(
        "cannot be decrypted",
      );
      await db("Account").where({ id: 1 }).update({ pass: row.pass });
      const field = await db("CustomFieldData").where({ id: 1 }).first();
      await db("CustomFieldData").where({ id: 1 }).update({ key: null });
      await expect(migration.takeover(input())).rejects.toThrow(
        "Missing encrypted",
      );
      await db("CustomFieldData").where({ id: 1 }).update({ key: field.key });
      const profile = await db("UserProfile").where({ id: 1 }).first();
      await db("UserProfile")
        .where({ id: 1 })
        .update({ profile: 'O:4:"Evil":0:{}' });
      await expect(migration.takeover(input())).rejects.toThrow("profile");
      await db("UserProfile")
        .where({ id: 1 })
        .update({ profile: profile.profile });
      await db("User").where({ id: 1 }).update({ preferences: "invalid" });
      await expect(migration.takeover(input())).rejects.toThrow("preferences");
      await db("User").where({ id: 1 }).update({ preferences: null });
      expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
    });
    it("rejects a missing administrator and identifies a corrupt serialized public vault", async () => {
      await expect(
        migration.takeover({ ...input(), login: "missing" }),
      ).rejects.toMatchObject({
        code: 403,
        data: { reason: "not_found" },
      });
      const row = await db("PublicLink").where({ id: 1 }).first();
      await db("PublicLink")
        .where({ id: 1 })
        .update({ data: Buffer.from("invalid PHP data") });
      await expect(migration.takeover(input())).rejects.toThrow(
        "Public-link vault",
      );
      await db("PublicLink").where({ id: 1 }).update({ data: row.data });
      const disabled = await encryptDefuse(
        serializePhp({ userId: 2, twofaEnabled: 0, IV: "" }),
        reference.master,
      );
      await db("PluginData").insert({
        name: "Authenticator",
        itemId: 2,
        data: disabled.pass,
        key: disabled.key,
      });
      await db("CustomFieldDefinition").insert({
        id: 2,
        name: "Plain field",
        moduleId: 10,
        typeId: 1,
        isEncrypted: 0,
      });
      await db("CustomFieldData").insert({
        id: 2,
        definitionId: 2,
        moduleId: 10,
        itemId: 1,
        data: "Plain text",
        key: null,
      });
    });
    it("never disables an unrecognized factor and validates all public vaults before mutation", async () => {
      const factor = await db("PluginData")
          .where({ name: "Authenticator", itemId: 1 })
          .first(),
        bad = await encryptDefuse(
          serializePhp({ userId: 999, twofaEnabled: 1, IV: "invalid" }),
          reference.master,
        );
      await db("PluginData")
        .where({ name: "Authenticator", itemId: 1 })
        .update({ data: bad.pass, key: bad.key });
      await expect(migration.takeover(input())).rejects.toThrow(
        "Authenticator",
      );
      await db("PluginData")
        .where({ name: "Authenticator", itemId: 1 })
        .update({ data: factor.data, key: factor.key });
      await expect(
        new Migration(db, vault, { ...config, legacy: {} }).takeover(input()),
      ).rejects.toThrow("salt");
      const link = await db("PublicLink").where({ id: 1 }).first();
      await db("PublicLink")
        .where({ id: 1 })
        .update({ data: Buffer.from("a:0:{}") });
      await expect(migration.takeover(input())).rejects.toThrow("public-link");
      await db("PublicLink").where({ id: 1 }).update({ data: link.data });
      expect(await db.schema.hasTable("nodepass_migrations")).toBe(false);
    });
    it("keeps its first backup after interruption, preserves thumbnails and prevents competing migrators", async () => {
      await expect(
        withLock(db, () => withLock(db, async () => {})),
      ).rejects.toThrow("Another migration");
      await db("AccountFile")
        .where({ id: 1 })
        .update({ thumb: Buffer.from("synthetic thumbnail") });
      const wrap = vault.wrap.bind(vault),
        fault = vi.spyOn(vault, "wrap").mockImplementation((value, context) => {
          if (context === "public-link/1")
            throw new Error("Simulated power failure");
          return wrap(value, context);
        });
      await expect(migration.takeover(input())).rejects.toThrow(
        "power failure",
      );
      fault.mockRestore();
      expect((await migration.status()).ready).toBe(false);
      expect(
        (await db("AccountFile").where({ id: 1 }).first()).content.length,
      ).toBe(0);
      const before = (await readdir(resolve(config.dataDir, "backups"))).filter(
        (f) => f.endsWith(".npb"),
      );
      expect(before).toHaveLength(1);
      vault.destroy();
      vault = new Vault(db, config.deploymentKey);
      migration = new Migration(db, vault, config);
      const finalFault = vi
        .spyOn(db, "transaction")
        .mockRejectedValueOnce(
          new Error("Interrupted after public-link conversion"),
        );
      await expect(migration.takeover(input())).rejects.toThrow(
        "after public-link",
      );
      finalFault.mockRestore();
      expect(
        Buffer.from((await db("PublicLink").where({ id: 1 }).first()).data)
          .subarray(0, 4)
          .toString(),
      ).toBe("NP1\0");
      const result = await migration.takeover({
        ...input(),
        configuration: `<config><passwordSalt>${reference.publicLink.salt}</passwordSalt><appVersion>310.19081801</appVersion><databaseVersion>unknown</databaseVersion></config>`,
      });
      expect(result.backup).toBe(before[0]);
      const file = await db("nodepass_attachments").where({ id: 1 }).first();
      expect(
        vault.unwrap(Buffer.from(file.thumb), "attachment-thumb/1").toString(),
      ).toBe("synthetic thumbnail");
      expect(
        (
          await readBackup(
            resolve(config.dataDir, "backups", result.backup),
            config.deploymentKey,
            resolve(config.dataDir, "restore"),
          )
        ).records
          .find((r) => r.table === "AccountFile")!
          .row.content.toString(),
      ).toBe("synthetic contents");
      const registry = await db("nodepass_migrations").first();
      await db("nodepass_migrations").update({ checksum: "0".repeat(64) });
      await expect(migrate(db)).rejects.toThrow("checksum");
      await db("nodepass_migrations").update({ checksum: registry.checksum });
      await migrate(db);
    });
    it("refuses a corrupt resume marker without replacing the original backup", async () => {
      const initialized = await db("nodepass_settings")
        .where({ id: "initialized" })
        .first();
      await db("nodepass_settings")
        .where({ id: "initialized" })
        .update({ value: "false" });
      const state = (await readdir(config.dataDir)).find((f) =>
          f.startsWith("migration-"),
        )!,
        path = resolve(config.dataDir, state),
        original = await readFile(path, "utf8");
      await writeFile(path, JSON.stringify({ backup: "../../outside" }));
      await expect(migration.takeover(input())).rejects.toThrow("checkpoint");
      await writeFile(path, original);
      await db("nodepass_settings")
        .where({ id: "initialized" })
        .update({ value: initialized.value });
    });
  },
);
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "restricted full dump imports",
  () => {
    let source: Database,
      config: ReturnType<typeof loadConfig>,
      drop: () => Promise<void>,
      dump = "";
    beforeAll(async () => {
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      config = isolated.config;
      source = database(config);
      await seedLegacy(source);
      const [tables] = await source.raw(
        "SHOW FULL TABLES WHERE Table_type='BASE TABLE'",
      );
      const literal = (value: any): string =>
        value === null
          ? "NULL"
          : Buffer.isBuffer(value)
            ? "0x" + value.toString("hex")
            : typeof value === "number"
              ? String(value)
              : "'" +
                String(
                  value instanceof Date
                    ? value.toISOString().slice(0, 19).replace("T", " ")
                    : value,
                )
                  .replaceAll("\\", "\\\\")
                  .replaceAll("'", "\\'") +
                "'";
      for (const item of tables) {
        const table = String(Object.values(item)[0]);
        for (const row of await source(table).select("*"))
          dump += `INSERT INTO \`${table}\` (${Object.keys(row)
            .map((k) => "`" + k + "`")
            .join(
              ",",
            )}) VALUES (${Object.values(row).map(literal).join(",")});\n`;
      }
    });
    afterAll(async () => {
      await source?.destroy();
      await drop?.();
    });
    async function empty(
      job: (db: Database, migration: Migration) => Promise<void>,
    ) {
      const isolated = await isolatedDatabase(loadConfig()),
        db = database(isolated.config),
        vault = new Vault(db, config.deploymentKey),
        migration = new Migration(db, vault, isolated.config);
      try {
        await job(db, migration);
      } finally {
        vault.destroy();
        await db.destroy();
        await isolated.drop();
      }
    }
    it("imports original binary values with bound inserts and requires an empty separate target", async () => {
      await empty(async (db, migration) => {
        await migration.importDump(dump);
        expect(
          (await db("Account").count({ n: "*" }).first())!.n,
        ).toBeGreaterThan(0);
        expect((await migration.preflight()).tables.User).toBe(2);
        await expect(migration.importDump(dump)).rejects.toThrow("empty");
      });
    });
    it("sanitizes real database insert errors and rolls back the complete import", async () => {
      await empty(async (db, migration) => {
        try {
          await migration.importDump(
            "INSERT INTO UserGroup (id,name) VALUES (1,'private-group-secret'),(1,'private-duplicate-secret');",
          );
          throw new Error("Expected duplicate failure");
        } catch (error) {
          expect(error).toMatchObject({
            setupCode: "SETUP_DUPLICATE_DATA",
            data: { table: "UserGroup", row: 1 },
          });
          expect(JSON.stringify(error)).not.toMatch(
            /private-group-secret|private-duplicate-secret|INSERT|sqlMessage/,
          );
        }
        expect(await db("UserGroup")).toHaveLength(0);
      });
    });
    it("rolls back every inserted row when a relationship is broken", async () => {
      await empty(async (db, migration) => {
        const invalid =
          "INSERT INTO UserGroup (id,name) VALUES (1,'group'); INSERT INTO UserProfile (id,name,profile) VALUES (1,'profile','NPJ1:{}'); INSERT INTO User (id,name,login,userGroupId,userProfileId,hashSalt,pass) VALUES (1,'a','a',999,1,0x3131,0x3131);";
        await expect(migration.importDump(invalid)).rejects.toThrow(
          "relationship",
        );
        expect(await db("User")).toHaveLength(0);
        expect(await db("UserGroup")).toHaveLength(0);
      });
    });
  },
);
