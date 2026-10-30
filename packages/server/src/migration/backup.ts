import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  open as openFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { Database, Row } from "../db.js";
import { token } from "../security/crypto.js";
export interface BackupRecord {
  table: string;
  row: Row;
}
const expandedLimit = 4 * 1024 ** 3,
  recordLimit = 64 * 1024 ** 2;
export function encodeBackupRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      Buffer.isBuffer(v)
        ? { $binary: v.toString("base64") }
        : v instanceof Date
          ? { $date: v.toISOString() }
          : v,
    ]),
  );
}
function decode(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v && typeof v === "object" && "$binary" in v
        ? Buffer.from(v.$binary, "base64")
        : v && typeof v === "object" && "$date" in v
          ? new Date(v.$date)
          : v,
    ]),
  );
}
export async function backup(
  db: Database,
  directory: string,
  key: Buffer,
  configuration: unknown,
  requestedName?: string,
  verifySnapshot?: (snapshot: Database) => Promise<void>,
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (
    requestedName &&
    !/^nodepass-\d+-[A-Za-z0-9_-]{8}\.npb$/.test(requestedName)
  )
    throw new Error("Invalid backup name");
  const name =
      requestedName ?? `nodepass-${Date.now()}-${token().slice(0, 8)}.npb`,
    partial = resolve(directory, `${name}.partial`),
    final = resolve(directory, name);
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("nodePass/backup/v1"));
  const handle = await openFile(partial, "wx", 0o600);
  await handle.writeFile(Buffer.concat([Buffer.from("NPB1"), nonce]));
  await handle.close();
  try {
    const snapshot = await db.transaction({
      isolationLevel: "repeatable read",
    });
    async function* records(): AsyncGenerator<string> {
      let total = 0;
      const record = (value: unknown) => {
        const line = JSON.stringify(value) + "\n",
          size = Buffer.byteLength(line);
        total += size;
        if (size > recordLimit || total > expandedLimit)
          throw new Error("Backup data exceeds supported restore limits");
        return line;
      };
      const manifest: Record<string, { count: number; sha256: string }> = {};
      yield record({
        format: "nodepass-backup-1",
        configuration,
        createdAt: new Date().toISOString(),
      });
      const [tables] = await snapshot.raw(
        "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'",
      );
      for (const item of tables as Row[]) {
        const table = String(Object.values(item)[0]);
        const hash = createHash("sha256");
        const [keys] = await snapshot.raw(
          "SHOW KEYS FROM ?? WHERE Non_unique = 0",
          [table],
        );
        const keyName = (keys as Row[]).some((k) => k.Key_name === "PRIMARY")
          ? "PRIMARY"
          : keys[0]?.Key_name;
        const order = (keys as Row[])
          .filter((k) => k.Key_name === keyName)
          .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
          .map((k) => ({
            column: String(k.Column_name),
            order: "asc" as const,
          }));
        if (!order.length)
          throw new Error(`Backup requires a unique key: ${table}`);
        let offset = 0;
        while (true) {
          const rows = await snapshot(table)
            .select("*")
            .orderBy(order)
            .limit(
              ["AccountFile", "nodepass_attachments"].includes(table) ? 1 : 100,
            )
            .offset(offset);
          if (!rows.length) break;
          for (const row of rows) {
            const line = record({ table, row: encodeBackupRow(row) });
            hash.update(line);
            yield line;
          }
          offset += rows.length;
        }
        manifest[table] = { count: offset, sha256: hash.digest("hex") };
      }
      yield record({ complete: true, manifest });
    }
    // One repeatable-read snapshot includes all table reads, including online admin backups.
    try {
      await pipeline(
        records(),
        createGzip(),
        cipher,
        createWriteStream(partial, { flags: "a", mode: 0o600 }),
      );
      // Verify managed native backups against the same MVCC snapshot before publication/pruning.
      if (verifySnapshot) await verifySnapshot(snapshot);
      await snapshot.commit();
    } catch (error) {
      await snapshot.rollback();
      throw error;
    }
    await appendFile(partial, cipher.getAuthTag());
    const completed = await openFile(partial, "r+");
    try {
      await completed.sync();
    } finally {
      await completed.close();
    }
    await rename(partial, final);
    return name;
  } catch (error) {
    await unlink(partial).catch(() => {});
    throw error;
  }
}
export async function readBackup(
  path: string,
  key: Buffer,
  directory: string,
  visit?: (record: BackupRecord) => Promise<void> | void,
): Promise<{
  configuration: unknown;
  records: BackupRecord[];
  createdAt: number | null;
  counts: Record<string, number>;
}> {
  const size = (await stat(path)).size;
  if (size < 32 || size > 4 * 1024 ** 3) throw new Error("Invalid backup size");
  const fd = await openFile(path, "r");
  const head = Buffer.alloc(16),
    tag = Buffer.alloc(16);
  try {
    await fd.read(head, 0, 16, 0);
    await fd.read(tag, 0, 16, size - 16);
  } finally {
    await fd.close();
  }
  if (head.subarray(0, 4).toString() !== "NPB1")
    throw new Error("Unsupported backup");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `${token()}.restore`);
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(4), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from("nodePass/backup/v1"));
  decipher.setAuthTag(tag);
  try {
    // Verify the authentication tag before exposing decoded records to any database mutation.
    await pipeline(
      createReadStream(path, { start: 16, end: size - 17 }),
      decipher,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    let expanded = 0,
      lineSize = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        expanded += chunk.length;
        let position = 0,
          next = chunk.indexOf(10);
        while (next !== -1) {
          lineSize += next - position;
          if (lineSize > recordLimit) {
            callback(new Error("Backup record limit exceeded"));
            return;
          }
          lineSize = 0;
          position = next + 1;
          next = chunk.indexOf(10, position);
        }
        lineSize += chunk.length - position;
        if (lineSize > recordLimit)
          callback(new Error("Backup record limit exceeded"));
        else if (expanded > expandedLimit)
          callback(new Error("Backup expansion limit exceeded"));
        else callback(null, chunk);
      },
    });
    const unpack = pipeline(createReadStream(temporary), createGunzip(), limit);
    void unpack.catch(() => {});
    const lines = createInterface({
      input: limit,
      crlfDelay: Infinity,
    });
    const records: BackupRecord[] = [];
    let configuration: unknown,
      createdAt: number | null = null,
      manifestCounts: Record<string, number> = {},
      complete = false,
      header = false;
    const counts = new Map<string, number>(),
      hashes = new Map<string, ReturnType<typeof createHash>>();
    try {
      for await (const line of lines) {
        const data = JSON.parse(line);
        if (complete) throw new Error("Trailing backup data");
        if (data.format === "nodepass-backup-1") {
          if (header) throw new Error("Duplicate backup header");
          header = true;
          configuration = data.configuration;
          const timestamp = Date.parse(data.createdAt);
          createdAt = Number.isFinite(timestamp) ? timestamp : null;
        } else if (data.complete === true) {
          if (!data.manifest || typeof data.manifest !== "object")
            throw new Error("Missing backup manifest");
          for (const [table, entry] of Object.entries(data.manifest) as [
            string,
            { count: number; sha256: string },
          ][]) {
            if (
              !entry ||
              !Number.isSafeInteger(entry.count) ||
              entry.count < 0 ||
              typeof entry.sha256 !== "string" ||
              !/^[a-f0-9]{64}$/.test(entry.sha256)
            )
              throw new Error("Invalid backup manifest");
            const hash = hashes.get(table) ?? createHash("sha256");
            if (
              entry.count !== (counts.get(table) ?? 0) ||
              entry.sha256 !== hash.digest("hex")
            )
              throw new Error("Backup manifest mismatch");
            hashes.delete(table);
            manifestCounts = { ...manifestCounts, [table]: entry.count };
          }
          if (hashes.size) throw new Error("Incomplete backup manifest");
          complete = true;
        } else if (typeof data.table === "string" && data.row) {
          if (configuration === undefined)
            throw new Error("Missing backup header");
          const hash = hashes.get(data.table) ?? createHash("sha256");
          hash.update(line + "\n");
          hashes.set(data.table, hash);
          counts.set(data.table, (counts.get(data.table) ?? 0) + 1);
          const record = { table: data.table, row: decode(data.row) };
          if (visit) await visit(record);
          else records.push(record);
        } else throw new Error("Invalid backup record");
      }
      await unpack;
      if (!complete || configuration === undefined)
        throw new Error("Incomplete backup");
      return { configuration, records, createdAt, counts: manifestCounts };
    } finally {
      lines.close();
      limit.destroy();
      await unpack.catch(() => {});
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
