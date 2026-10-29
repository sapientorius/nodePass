import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, readdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../packages/server/src/config.js";
import {
  database,
  type Database,
  type Row,
} from "../packages/server/src/db.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { Vault } from "../packages/server/src/security/vault.js";
import {
  backup,
  encodeBackupRow,
  readBackup,
  type BackupRecord,
} from "../packages/server/src/migration/backup.js";
import {
  inspectTarget,
  prepareSnapshot,
  validateRestored,
} from "../packages/server/src/migration/restore-validation.js";
import { seal, token } from "../packages/server/src/security/crypto.js";
import { isolatedDatabase } from "./database.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "initialized snapshot validation before replacement",
  () => {
    let db: Database,
      directory: string,
      drop: () => Promise<void>,
      rows: BackupRecord[],
      counts: Record<string, number>;
    const sourceKey = randomBytes(32),
      targetKey = randomBytes(32);
    beforeAll(async () => {
      if (existsSync(".cache/integration.env"))
        process.loadEnvFile(".cache/integration.env");
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      directory = await mkdtemp(join(tmpdir(), "nodepass-restore-validation-"));
      const config = {
        ...isolated.config,
        dataDir: directory,
        deploymentKey: sourceKey,
        setupToken: token(),
      };
      db = database(config);
      const vault = new Vault(db, sourceKey);
      await new Migration(db, vault, config).fresh({
        login: "synthetic-restore-admin",
        name: "Synthetic restore validator",
        password: "Synthetic!Restore-Credentials-6284",
        token: config.setupToken,
      });
      const name = await backup(db, directory, sourceKey, {});
      const decoded = await readBackup(
        join(directory, name),
        sourceKey,
        directory,
      );
      rows = decoded.records;
      counts = decoded.counts;
      vault.destroy();
    }, 60000);
    afterAll(async () => {
      if (db) await db.destroy();
      if (drop) await drop();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    const fixture = async (
      change: (
        records: BackupRecord[],
        manifest: Record<string, number>,
      ) => void = () => {},
      createdAt?: string,
    ) => {
      const records = rows.map((r) => ({ table: r.table, row: { ...r.row } })),
        manifestCounts = { ...counts };
      change(records, manifestCounts);
      const encoded = records.map(
        (r) =>
          JSON.stringify({
            table: r.table,
            row: Array.isArray(r.row) ? r.row : encodeBackupRow(r.row),
          }) + "\n",
      );
      const manifest: Record<string, { count: number; sha256: string }> = {};
      for (const table of Object.keys(manifestCounts)) {
        const lines = encoded.filter((_, i) => records[i]!.table === table);
        manifest[table] = {
          count: lines.length,
          sha256: createHash("sha256").update(lines.join("")).digest("hex"),
        };
      }
      const clear = gzipSync(
        JSON.stringify({
          format: "nodepass-backup-1",
          configuration: {},
          createdAt,
        }) +
          "\n" +
          encoded.join("") +
          JSON.stringify({ complete: true, manifest }) +
          "\n",
      );
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", sourceKey, nonce);
      cipher.setAAD(Buffer.from("nodePass/backup/v1"));
      const path = join(directory, `${token()}.npb`);
      await writeFile(
        path,
        Buffer.concat([
          Buffer.from("NPB1"),
          nonce,
          cipher.update(clear),
          cipher.final(),
          cipher.getAuthTag(),
        ]),
      );
      return path;
    };
    const cases: {
      name: string;
      change: (
        records: BackupRecord[],
        manifest: Record<string, number>,
      ) => void;
    }[] = [
      {
        name: "unknown empty manifest table",
        change: (_r, m) => {
          m.Unexpected = 0;
        },
      },
      {
        name: "missing empty manifest table",
        change: (_r, m) => {
          delete m.PublicLink;
        },
      },
      {
        name: "unknown record table",
        change: (r, m) => {
          r.push({ table: "Unexpected", row: { id: 1 } });
          m.Unexpected = 1;
        },
      },
      {
        name: "unknown base column",
        change: (r) => {
          r.find((x) => x.table === "User")!.row.extra = true;
        },
      },
      {
        name: "unknown sidecar column",
        change: (r) => {
          r.find((x) => x.table === "nodepass_keyring")!.row.extra = true;
        },
      },
      {
        name: "array row",
        change: (r) => {
          r.find((x) => x.table === "User")!.row = [] as unknown as Row;
        },
      },
      {
        name: "unfinished installation",
        change: (r) => {
          r.find(
            (x) =>
              x.table === "nodepass_settings" && x.row.id === "initialized",
          )!.row.value = "false";
        },
      },
      {
        name: "no active administrator",
        change: (r) => {
          r.find((x) => x.table === "User")!.row.isDisabled = 1;
        },
      },
      {
        name: "no vault",
        change: (r) => {
          const index = r.findIndex((x) => x.table === "nodepass_keyring");
          r.splice(index, 1);
        },
      },
      {
        name: "corrupt keyring ciphertext",
        change: (r) => {
          r.find((x) => x.table === "nodepass_keyring")!.row.value =
            Buffer.from("invalid");
        },
      },
      {
        name: "invalid vault key",
        change: (r) => {
          r.find((x) => x.table === "nodepass_keyring")!.row.value = seal(
            JSON.stringify({ key: "AQID" }),
            sourceKey,
            "keyring/vault",
          );
        },
      },
      {
        name: "incompatible migration",
        change: (r) => {
          r.find((x) => x.table === "nodepass_migrations")!.row.checksum =
            "invalid";
        },
      },
      {
        name: "missing migration",
        change: (r) => {
          r.splice(
            r.findIndex((x) => x.table === "nodepass_migrations"),
            1,
          );
        },
      },
    ];
    it.each(cases)(
      "rejects $name without changing the target",
      async ({ change }) => {
        const source = await fixture(change),
          output = join(directory, `${token()}.prepared`);
        await expect(
          prepareSnapshot(db, source, sourceKey, targetKey, output, directory),
        ).rejects.toThrow();
        expect((await db("User").first()).login).toBe(
          "synthetic-restore-admin",
        );
        expect(
          (await readdir(directory)).some((name) =>
            /\.(records|partial|restore)$/.test(name),
          ),
        ).toBe(false);
      },
    );
    it("normalizes older timestamp-less files and rewraps the whole keyring", async () => {
      const source = await fixture(),
        output = join(directory, `${token()}.prepared`);
      const summary = await prepareSnapshot(
        db,
        source,
        sourceKey,
        targetKey,
        output,
        directory,
      );
      expect(summary.createdAt).toBeNull();
      expect(summary.hash).toMatch(/^[a-f0-9]{64}$/);
      const normalized = await readBackup(output, targetKey, directory);
      expect(normalized.counts).toEqual(counts);
      const vault = normalized.records.find(
        (r) => r.table === "nodepass_keyring",
      )!;
      expect(vault.row.value).not.toEqual(
        rows.find((r) => r.table === "nodepass_keyring")!.row.value,
      );
      await expect(readBackup(output, sourceKey, directory)).rejects.toThrow();
    });
    it("preserves a valid creation timestamp and refuses to overwrite a foreign spool", async () => {
      const createdAt = "2026-01-02T03:04:05.000Z",
        source = await fixture(undefined, createdAt);
      const output = join(directory, `${token()}.prepared`);
      await writeFile(output + ".records", "preserve this existing spool");
      await expect(
        prepareSnapshot(db, source, sourceKey, targetKey, output, directory),
      ).rejects.toThrow();
      expect(await readFile(output + ".records", "utf8")).toBe(
        "preserve this existing spool",
      );
      await rm(output + ".records");
      expect(
        (
          await prepareSnapshot(
            db,
            source,
            sourceKey,
            targetKey,
            output,
            directory,
          )
        ).createdAt,
      ).toBe(Date.parse(createdAt));
    });
    it("refuses schema drift and unknown views while permitting the two original views", async () => {
      await db.schema.alterTable("nodepass_settings", (t) =>
        t.integer("unexpected"),
      );
      await expect(inspectTarget(db)).rejects.toThrow("schema");
      await db.schema.alterTable("nodepass_settings", (t) =>
        t.dropColumn("unexpected"),
      );
      await db.raw("CREATE VIEW unexpected_view AS SELECT id FROM User");
      await expect(inspectTarget(db)).rejects.toThrow("Unknown");
      await db.raw("DROP VIEW unexpected_view");
      await db.raw("CREATE VIEW account_data_v AS SELECT id FROM User");
      expect((await inspectTarget(db)).some((r) => r.kind === "VIEW")).toBe(
        true,
      );
      await db.raw("DROP VIEW account_data_v");
      await validateRestored(db, sourceKey);
    });
  },
);
