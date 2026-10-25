import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBackup, backup } from "../packages/server/src/migration/backup.js";
import { restore } from "../packages/server/src/migration/restore.js";
import { loadConfig } from "../packages/server/src/config.js";
import { database, type Database } from "../packages/server/src/db.js";
import { isolatedDatabase } from "./database.js";
const key = randomBytes(32),
  header = { format: "nodepass-backup-1", configuration: { test: true } };
function records(rows: { table: string; row: unknown }[]) {
  const manifest: Record<string, { count: number; sha256: string }> = {};
  for (const table of new Set(rows.map((r) => r.table))) {
    const selected = rows.filter((r) => r.table === table);
    manifest[table] = {
      count: selected.length,
      sha256: createHash("sha256")
        .update(selected.map((r) => JSON.stringify(r) + "\n").join(""))
        .digest("hex"),
    };
  }
  return [header, ...rows, { complete: true, manifest }];
}
describe("authenticated backup format rejects incomplete or ambiguous data", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "nodepass-backup-"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  async function signed(values: unknown[] | Buffer) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from("nodePass/backup/v1"));
    const value = Buffer.isBuffer(values)
        ? values
        : gzipSync(values.map((v) => JSON.stringify(v) + "\n").join("")),
      path = join(directory, randomBytes(8).toString("hex") + ".npb");
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from("NPB1"),
        nonce,
        cipher.update(value),
        cipher.final(),
        cipher.getAuthTag(),
      ]),
    );
    return path;
  }
  it("streams records with bounded memory and verifies binary/date values", async () => {
    const rows = [
        {
          table: "User",
          row: {
            id: 1,
            pass: { $binary: "AQID" },
            createdAt: { $date: "2026-01-01T00:00:00.000Z" },
            nullable: null,
            nested: { plain: true },
          },
        },
      ],
      path = await signed(records(rows));
    const read = await readBackup(path, key, join(directory, "decode"));
    expect(read.records[0]!.row.pass).toEqual(Buffer.from([1, 2, 3]));
    expect(read.records[0]!.row.createdAt).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
    const visited: unknown[] = [];
    expect(
      (
        await readBackup(path, key, join(directory, "decode"), (record) => {
          visited.push(record);
        })
      ).records,
    ).toEqual([]);
    expect(visited).toHaveLength(1);
    expect(await readdir(join(directory, "decode"))).toEqual([]);
  });
  it.each(
    [
      [header],
      [header, header, { complete: true, manifest: {} }],
      [header, { complete: true }],
      [
        header,
        { table: "User", row: { id: 1 } },
        { complete: true, manifest: {} },
      ],
      [
        header,
        { table: "User", row: { id: 1 } },
        { complete: true, manifest: { User: { count: 9, sha256: "wrong" } } },
      ],
      [
        header,
        { complete: true, manifest: {} },
        { table: "User", row: { id: 1 } },
      ],
      [
        { format: "unknown-backup-2", configuration: {} },
        { complete: true, manifest: {} },
      ],
      [
        { table: "User", row: { id: 1 } },
        { complete: true, manifest: {} },
      ],
      [header, { invalid: true }],
      [{ format: "nodepass-backup-1" }, { complete: true, manifest: {} }],
    ].map((values) => ({ values })),
  )("rejects malformed authenticated records", async ({ values }) => {
    await expect(
      readBackup(
        await signed(values as unknown[]),
        key,
        join(directory, "decode"),
      ),
    ).rejects.toThrow();
    expect(await readdir(join(directory, "decode"))).toEqual([]);
  });
  it("rejects short files, wrong headers, failed GCM authentication and invalid gzip", async () => {
    const short = join(directory, "short.npb");
    await writeFile(short, "short");
    await expect(readBackup(short, key, directory)).rejects.toThrow("size");
    const wrong = join(directory, "header.npb");
    await writeFile(wrong, Buffer.alloc(40));
    await expect(readBackup(wrong, key, directory)).rejects.toThrow(
      "Unsupported",
    );
    const valid = await signed(records([]));
    await expect(
      readBackup(valid, randomBytes(32), join(directory, "decode")),
    ).rejects.toThrow();
    await expect(
      readBackup(
        await signed(Buffer.from("not gzip")),
        key,
        join(directory, "decode"),
      ),
    ).rejects.toThrow();
  });
  it("stops decompression before an oversized individual record can be accumulated", async () => {
    const bomb = await signed(gzipSync(Buffer.alloc(64 * 1024 ** 2 + 1, 0x20)));
    await expect(
      readBackup(bomb, key, join(directory, "decode")),
    ).rejects.toThrow("record limit");
  });
});
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "restore rejects schema drift before changing its target",
  () => {
    let directory: string, db: Database, drop: () => Promise<void>;
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "nodepass-restore-"));
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      db = database(isolated.config);
    });
    afterAll(async () => {
      await db?.destroy();
      await drop?.();
      await rm(directory, { recursive: true, force: true });
    });
    async function signed(rows: { table: string; row: unknown }[]) {
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from("nodePass/backup/v1"));
      const content = gzipSync(
          records(rows)
            .map((v) => JSON.stringify(v) + "\n")
            .join(""),
        ),
        path = join(directory, randomBytes(8).toString("hex") + ".npb");
      await writeFile(
        path,
        Buffer.concat([
          Buffer.from("NPB1"),
          nonce,
          cipher.update(content),
          cipher.final(),
          cipher.getAuthTag(),
        ]),
      );
      return path;
    }
    it("refuses unknown tables and columns without creating any baseline table", async () => {
      for (const row of [
        { table: "Unexpected", row: { id: 1 } },
        { table: "User", row: { id: 1, root: true } },
      ]) {
        await expect(
          restore(db, await signed([row]), key, key, directory),
        ).rejects.toThrow();
        const [tables] = await db.raw("SHOW TABLES");
        expect(tables).toHaveLength(0);
      }
    });
    it("never writes over a nonempty database and cleans incomplete backups on failures", async () => {
      await db.schema.createTable("Unexpected", (table) =>
        table.integer("value"),
      );
      await expect(
        restore(db, await signed([]), key, key, directory),
      ).rejects.toThrow("empty");
      const before = await readdir(directory);
      await expect(backup(db, directory, key, {})).rejects.toThrow(
        "unique key",
      );
      expect(await readdir(directory)).toEqual(before);
      await db.schema.dropTable("Unexpected");
    });
  },
);
