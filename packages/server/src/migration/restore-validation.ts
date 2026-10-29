import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import {
  resource,
  sidecarTables,
  canonicalType,
  validateRelations,
  type Database,
  type Row,
} from "../db.js";
import { open, seal } from "../security/crypto.js";
import { Vault } from "../security/vault.js";
import { encodeBackupRow, readBackup } from "./backup.js";
import { safeOpen } from "../services/backup-files.js";

export async function knownTables(): Promise<string[]> {
  return [
    ...Object.keys(JSON.parse(await readFile(resource("schema.json"), "utf8"))),
    ...sidecarTables,
  ];
}
const sidecarColumns: Record<string, Record<string, string>> = {
  nodepass_migrations: {
    id: "varchar(80)",
    checksum: "varchar(64)",
    appliedAt: "timestamp",
  },
  nodepass_keyring: { id: "varchar(80)", value: "blob" },
  nodepass_settings: { id: "varchar(80)", value: "longtext" },
  nodepass_sessions: {
    id: "varchar(64)",
    userId: "int unsigned",
    csrf: "varchar(64)",
    complete: "tinyint",
    verifiedAt: "bigint",
    createdAt: "bigint",
    lastSeen: "bigint",
  },
  nodepass_factors: {
    id: "int unsigned",
    userId: "int unsigned",
    kind: "varchar(20)",
    credentialId: "varchar(1024)",
    credentialHash: "varchar(64)",
    data: "longtext",
    name: "varchar(100)",
    counter: "bigint",
    confirmed: "tinyint",
  },
  nodepass_challenges: {
    id: "varchar(64)",
    userId: "int unsigned",
    sessionId: "varchar(64)",
    kind: "varchar(30)",
    value: "longtext",
    expiresAt: "bigint",
  },
  nodepass_audit: {
    id: "bigint unsigned",
    userId: "int unsigned",
    action: "varchar(100)",
    target: "varchar(100)",
    date: "timestamp",
  },
  nodepass_attachments: { id: "int", content: "longblob", thumb: "longblob" },
  nodepass_versions: {
    entity: "varchar(40)",
    entityId: "int unsigned",
    version: "int unsigned",
  },
  nodepass_limits: { id: "varchar(64)", attempts: "int", resetAt: "bigint" },
  nodepass_jobs: {
    id: "varchar(64)",
    kind: "varchar(30)",
    state: "varchar(30)",
    data: "longtext",
    updatedAt: "timestamp",
  },
};
export async function inspectTarget(
  db: Database,
): Promise<{ table: string; kind: string }[]> {
  const known = await knownTables();
  const [rows] = await db.raw(
    "SELECT TABLE_NAME AS `table`, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()",
  );
  for (const row of rows as { table: string; kind: string }[]) {
    if (
      row.kind === "VIEW" &&
      ["account_data_v", "account_search_v"].includes(row.table)
    )
      continue;
    if (row.kind !== "BASE TABLE" || !known.includes(row.table))
      throw new Error("Unknown database object");
  }
  const [other] = await db.raw(
    "SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() UNION ALL SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() UNION ALL SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()",
  );
  if (other.length) throw new Error("Unknown database object");
  const legacy = JSON.parse(
    await readFile(resource("schema.json"), "utf8"),
  ) as Record<string, { name: string; type: string }[]>;
  const [columns] = await db.raw(
    "SELECT TABLE_NAME AS `table`, COLUMN_NAME AS `name`, COLUMN_TYPE AS `type` FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()",
  );
  for (const row of rows as { table: string; kind: string }[]) {
    if (row.kind === "VIEW") continue;
    const expected = legacy[row.table]
      ? Object.fromEntries(legacy[row.table]!.map((c) => [c.name, c.type]))
      : sidecarColumns[row.table]!;
    const actual = (
      columns as { table: string; name: string; type: string }[]
    ).filter((c) => c.table === row.table);
    if (
      actual.length !== Object.keys(expected).length ||
      actual.some(
        (c) =>
          !Object.hasOwn(expected, c.name) ||
          canonicalType(c.type) !== canonicalType(expected[c.name]!),
      )
    )
      throw new Error("Unsupported target schema");
  }
  return rows;
}
export async function clearTarget(db: Database): Promise<void> {
  const objects = await inspectTarget(db);
  const connection = await db.client.acquireConnection();
  try {
    await db.raw("SET FOREIGN_KEY_CHECKS=0").connection(connection);
    for (const row of objects) {
      const sql = row.kind === "VIEW" ? "DROP VIEW ??" : "DROP TABLE ??";
      await db.raw(sql, [row.table]).connection(connection);
    }
  } finally {
    await db.raw("SET FOREIGN_KEY_CHECKS=1").connection(connection);
    await db.client.releaseConnection(connection);
  }
}

export async function prepareSnapshot(
  db: Database,
  source: string,
  sourceKey: Buffer,
  targetKey: Buffer,
  output: string,
  directory: string,
) {
  await inspectTarget(db);
  const columns = new Map<string, Set<string>>();
  const tables = await knownTables();
  const expectedMigrations = new Map(
    (await db("nodepass_migrations").select("id", "checksum")).map((r) => [
      r.id,
      r.checksum,
    ]),
  );
  for (const table of tables)
    columns.set(table, new Set(Object.keys(await db(table).columnInfo())));
  let initialized = false,
    vault = false,
    admin = false;
  const summary = await readBackup(
    source,
    sourceKey,
    directory,
    ({ table, row }) => {
      if (
        !columns.has(table) ||
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).some((k) => !columns.get(table)!.has(k))
      )
        throw new Error("Unsupported backup schema");
      if (table === "nodepass_settings" && row.id === "initialized")
        initialized = row.value === "true";
      if (
        table === "nodepass_migrations" &&
        expectedMigrations.get(row.id) !== row.checksum
      )
        throw new Error("Incompatible backup migration");
      if (
        table === "User" &&
        Number(row.isAdminApp) === 1 &&
        !Number(row.isDisabled) &&
        !Number(row.isLdap)
      )
        admin = true;
      if (table === "nodepass_keyring") {
        const clear = open(
          Buffer.from(row.value),
          sourceKey,
          `keyring/${row.id}`,
        );
        try {
          const data = JSON.parse(clear.toString());
          if (row.id === "vault") {
            const decoded = Buffer.from(data.key, "base64");
            try {
              vault =
                decoded.length === 32 &&
                decoded.toString("base64") === data.key;
            } finally {
              decoded.fill(0);
            }
          }
        } finally {
          clear.fill(0);
        }
      }
    },
  );
  if (
    !initialized ||
    !vault ||
    !admin ||
    summary.counts.nodepass_migrations !== expectedMigrations.size ||
    tables.some((t) => !Object.hasOwn(summary.counts, t)) ||
    Object.keys(summary.counts).some((t) => !tables.includes(t))
  )
    throw new Error("A complete initialized nodePass backup is required");
  const spool = `${output}.records`,
    partial = `${output}.partial`;
  let ownSpool = false,
    ownPartial = false;
  try {
    const file = await openFile(spool, "wx", 0o600);
    ownSpool = true;
    try {
      await file.writeFile(
        JSON.stringify({
          format: "nodepass-backup-1",
          configuration: summary.configuration,
          createdAt:
            summary.createdAt === null
              ? undefined
              : new Date(summary.createdAt).toISOString(),
        }) + "\n",
      );
      const hashes = new Map(tables.map((t) => [t, createHash("sha256")]));
      await readBackup(source, sourceKey, directory, async ({ table, row }) => {
        if (table === "nodepass_keyring") {
          const clear = open(
            Buffer.from(row.value),
            sourceKey,
            `keyring/${row.id}`,
          );
          try {
            row.value = seal(clear, targetKey, `keyring/${row.id}`);
          } finally {
            clear.fill(0);
          }
        }
        const line =
          JSON.stringify({ table, row: encodeBackupRow(row) }) + "\n";
        hashes.get(table)!.update(line);
        await file.writeFile(line);
      });
      await file.writeFile(
        JSON.stringify({
          complete: true,
          manifest: Object.fromEntries(
            tables.map((t) => [
              t,
              {
                count: summary.counts[t],
                sha256: hashes.get(t)!.digest("hex"),
              },
            ]),
          ),
        }) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", targetKey, nonce);
    cipher.setAAD(Buffer.from("nodePass/backup/v1"));
    const outputFile = await openFile(partial, "wx", 0o600);
    ownPartial = true;
    try {
      await outputFile.writeFile(Buffer.concat([Buffer.from("NPB1"), nonce]));
    } finally {
      await outputFile.close();
    }
    await pipeline(
      createReadStream(spool),
      createGzip(),
      cipher,
      createWriteStream(partial, { flags: "a", mode: 0o600 }),
    );
    const completed = await openFile(partial, "a");
    try {
      await completed.writeFile(cipher.getAuthTag());
      await completed.sync();
    } finally {
      await completed.close();
    }
    await readBackup(partial, targetKey, directory, () => {});
    await rename(partial, output);
    const handle = await safeOpen(output);
    const hash = createHash("sha256");
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false }))
        hash.update(chunk);
    } finally {
      await handle.close();
    }
    return {
      createdAt: summary.createdAt,
      counts: summary.counts,
      hash: hash.digest("hex"),
    };
  } finally {
    if (ownSpool) await unlink(spool).catch(() => {});
    if (ownPartial) await unlink(partial).catch(() => {});
  }
}

/** Bounded reads validate every stored secret, including histories and non-vault keyring entries. */
export async function validateRestored(
  db: Database,
  key: Buffer,
): Promise<void> {
  await validateRelations(db);
  const vault = new Vault(db, key);
  try {
    for (const row of await db("nodepass_keyring").select("id", "value")) {
      const clear = open(Buffer.from(row.value), key, `keyring/${row.id}`);
      try {
        JSON.parse(clear.toString());
      } finally {
        clear.fill(0);
      }
    }
    await vault.load();
    if (!vault.unlocked) throw new Error("Restored vault is locked");
    for (const table of [
      "Account",
      "AccountHistory",
      "CustomFieldData",
      "nodepass_attachments",
      "PublicLink",
      "nodepass_factors",
    ]) {
      let last = -1;
      while (true) {
        const rows = await db(table)
          .where("id", ">", last)
          .orderBy("id")
          .limit(table === "nodepass_attachments" ? 1 : 50);
        if (!rows.length) break;
        for (const row of rows as Row[]) {
          last = row.id;
          if (table === "Account" || table === "AccountHistory")
            await vault.decrypt(row.pass, row.key, `${table}/${row.id}/pass`);
          else if (table === "CustomFieldData") {
            const definition = await db("CustomFieldDefinition")
              .where({ id: row.definitionId })
              .first();
            if (definition?.isEncrypted)
              await vault.decrypt(
                row.data,
                row.key,
                `CustomFieldData/${row.id}/data`,
              );
          } else if (table === "nodepass_attachments") {
            vault
              .unwrap(Buffer.from(row.content), `attachment/${row.id}`)
              .fill(0);
            if (row.thumb?.length)
              vault
                .unwrap(Buffer.from(row.thumb), `attachment-thumb/${row.id}`)
                .fill(0);
          } else if (table === "PublicLink")
            vault
              .unwrap(Buffer.from(row.data), `public-link/${row.id}`)
              .fill(0);
          else if (table === "nodepass_factors" && row.kind === "totp")
            vault
              .unwrap(Buffer.from(row.data, "base64"), `totp/${row.userId}`)
              .fill(0);
        }
      }
    }
  } finally {
    vault.destroy();
  }
}
