import knexFactory, { type Knex } from "knex";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest } from "./security/crypto.js";
import type { Config } from "./config.js";
import { BadRequest } from "@feathersjs/errors";
export type Database = Knex;
export type Row = Record<string, any>;
export const sidecarTables = [
  "nodepass_migrations",
  "nodepass_keyring",
  "nodepass_settings",
  "nodepass_sessions",
  "nodepass_factors",
  "nodepass_challenges",
  "nodepass_audit",
  "nodepass_attachments",
  "nodepass_versions",
  "nodepass_limits",
  "nodepass_jobs",
];
export const canonicalType = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\b(tinyint|smallint|mediumint|bigint|int)\(\d+\)/g, "$1");
export const resource = (name: string): string =>
  resolve(import.meta.dirname, "../resources", name);
export function database(config: Config): Database {
  return knexFactory({
    client: "mysql2",
    connection: {
      ...config.database,
      timezone: "Z",
      charset: "utf8mb4",
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
    },
    pool: { min: 0, max: 10 },
    acquireConnectionTimeout: 10000,
  });
}
export async function withLock<T>(
  db: Database,
  job: (connection: Database) => Promise<T>,
): Promise<T> {
  const connection = await db.client.acquireConnection();
  // All lock queries and mutations use one reserved physical connection.
  const query = (sql: string, args: unknown[] = []) =>
    db.raw(sql, args as Knex.RawBinding[]).connection(connection);
  try {
    const [rows] = await query(
      "SELECT GET_LOCK(CONCAT('nodepass.', LEFT(SHA2(DATABASE(), 256), 40)), 0) AS acquired",
    );
    if (Number(rows[0]?.acquired) !== 1)
      throw new Error("Another migration is active");
    // The reserved connection holds the advisory lock until the entire job completes.
    return await job(db);
  } finally {
    await query(
      "SELECT RELEASE_LOCK(CONCAT('nodepass.', LEFT(SHA2(DATABASE(), 256), 40)))",
    );
    await db.client.releaseConnection(connection);
  }
}
export async function createBaseline(
  db: Database,
  resume = false,
): Promise<void> {
  const [existing] = await db.raw("SHOW TABLES");
  if (existing.length && !resume)
    throw new Error("Fresh installation requires an empty database");
  const source = await readFile(resource("schema.sql"), "utf8");
  const present = new Set<string>(
    (existing as Row[]).map((row) => String(Object.values(row)[0])),
  );
  if (resume) {
    const schema = JSON.parse(
      await readFile(resource("schema.json"), "utf8"),
    ) as Record<string, { name: string; type: string }[]>;
    const [columns] = await db.raw(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()",
    );
    for (const table of present) {
      if (sidecarTables.includes(table)) continue;
      if (!schema[table])
        throw new Error("Unknown table in interrupted installation");
      const [metadata] = await db.raw(
        "SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
        [table],
      );
      if (metadata[0]?.engine !== "InnoDB")
        throw new Error("Interrupted baseline requires InnoDB");
      const actual = (columns as Row[]).filter((c) => c.tableName === table),
        expected = schema[table]!;
      if (
        actual.length !== expected.length ||
        expected.some(
          (c) =>
            !actual.some(
              (a) =>
                a.columnName === c.name &&
                canonicalType(a.columnType) === canonicalType(c.type),
            ),
        )
      )
        throw new Error("Interrupted baseline schema mismatch");
      if (await db(table).first())
        throw new Error(
          "Interrupted fresh installation contains existing data",
        );
    }
  }
  const connection = await db.client.acquireConnection();
  try {
    await db.raw("SET FOREIGN_KEY_CHECKS=0").connection(connection);
    for (const sql of source
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      if (!present.has(/^CREATE TABLE\s+`?(\w+)/i.exec(sql)![1]!))
        await db.raw(sql).connection(connection);
  } finally {
    await db.raw("SET FOREIGN_KEY_CHECKS=1").connection(connection);
    await db.client.releaseConnection(connection);
  }
}
const migrationId = "001-foundation";
const migrationDefinition =
  "nodepass/v1/keyring-settings-sessions-mfa-challenges-longtext-audit-attachments-thumb-versions-jobs-tokens";
export async function migrate(
  db: Database,
  lockAlreadyHeld = false,
): Promise<void> {
  const apply = async () => {
    if (!(await db.schema.hasTable("nodepass_migrations")))
      await db.schema.createTable("nodepass_migrations", (t) => {
        t.string("id", 80).primary();
        t.string("checksum", 64).notNullable();
        t.timestamp("appliedAt").notNullable();
      });
    const prior = await db("nodepass_migrations")
      .where({ id: migrationId })
      .first();
    if (prior) {
      if (prior.checksum !== digest(migrationDefinition))
        throw new Error("Migration checksum mismatch");
      return;
    }
    // Individual CREATEs are restartable because MySQL DDL implicitly commits.
    const table = async (
      name: string,
      fn: (t: Knex.CreateTableBuilder) => void,
    ) => {
      if (!(await db.schema.hasTable(name)))
        await db.schema.createTable(name, fn);
    };
    await table("nodepass_keyring", (t) => {
      t.string("id", 80).primary();
      t.binary("value").notNullable();
    });
    await table("nodepass_settings", (t) => {
      t.string("id", 80).primary();
      t.text("value", "longtext").notNullable();
    });
    await table("nodepass_sessions", (t) => {
      t.string("id", 64).primary();
      t.integer("userId").unsigned().notNullable().index();
      t.string("csrf", 64).notNullable();
      t.boolean("complete").notNullable();
      t.bigInteger("verifiedAt").notNullable();
      t.bigInteger("createdAt").notNullable();
      t.bigInteger("lastSeen").notNullable().index();
    });
    await table("nodepass_factors", (t) => {
      t.increments("id");
      t.integer("userId").unsigned().notNullable().index();
      t.string("kind", 20).notNullable();
      t.string("credentialId", 1024).nullable();
      t.string("credentialHash", 64).unique().nullable();
      t.text("data", "longtext").notNullable();
      t.string("name", 100).notNullable();
      t.bigInteger("counter").notNullable().defaultTo(0);
      t.boolean("confirmed").notNullable().defaultTo(false);
    });
    await table("nodepass_challenges", (t) => {
      t.string("id", 64).primary();
      t.integer("userId").unsigned().nullable();
      t.string("sessionId", 64).nullable();
      t.string("kind", 30).notNullable();
      t.text("value", "longtext").notNullable();
      t.bigInteger("expiresAt").notNullable().index();
    });
    await table("nodepass_audit", (t) => {
      t.bigIncrements("id");
      t.integer("userId").unsigned().nullable();
      t.string("action", 100).notNullable();
      t.string("target", 100).nullable();
      t.timestamp("date").notNullable();
    });
    await table("nodepass_attachments", (t) => {
      t.integer("id").primary();
      t.specificType("content", "LONGBLOB").notNullable();
      t.specificType("thumb", "LONGBLOB").nullable();
    });
    await table("nodepass_versions", (t) => {
      t.string("entity", 40).notNullable();
      t.integer("entityId").unsigned().notNullable();
      t.integer("version").unsigned().notNullable().defaultTo(1);
      t.primary(["entity", "entityId"]);
    });
    await table("nodepass_limits", (t) => {
      t.string("id", 64).primary();
      t.integer("attempts").notNullable();
      t.bigInteger("resetAt").notNullable().index();
    });
    await table("nodepass_jobs", (t) => {
      t.string("id", 64).primary();
      t.string("kind", 30).notNullable();
      t.string("state", 30).notNullable();
      t.text("data", "longtext").notNullable();
      t.timestamp("updatedAt").notNullable();
    });
    await db("nodepass_migrations").insert({
      id: migrationId,
      checksum: digest(migrationDefinition),
      appliedAt: new Date(),
    });
  };
  if (lockAlreadyHeld) await apply();
  else await withLock(db, apply);
}
export async function audit(
  db: Database,
  userId: number | null,
  action: string,
  target?: number | string,
): Promise<void> {
  await db("nodepass_audit").insert({
    userId,
    action,
    target: target === undefined ? null : String(target),
    date: new Date(),
  });
}
export async function getSetting<T>(
  db: Database,
  id: string,
  fallback: T,
): Promise<T> {
  const row = await db("nodepass_settings").where({ id }).first();
  return row ? (JSON.parse(row.value) as T) : fallback;
}
export async function putSetting(
  db: Database,
  id: string,
  value: unknown,
): Promise<void> {
  await db("nodepass_settings")
    .insert({ id, value: JSON.stringify(value) })
    .onConflict("id")
    .merge();
}

/** MySQL does not validate existing rows when FOREIGN_KEY_CHECKS is re-enabled. */
export async function validateRelations(db: Database): Promise<void> {
  const [keys] =
    await db.raw(`SELECT TABLE_NAME AS sourceTable, COLUMN_NAME AS sourceColumn,
    REFERENCED_TABLE_NAME AS targetTable, REFERENCED_COLUMN_NAME AS targetColumn
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
    AND REFERENCED_TABLE_NAME IS NOT NULL`);
  for (const key of keys as Row[]) {
    const broken = await db({ s: key.sourceTable })
      .leftJoin(
        { t: key.targetTable },
        `s.${key.sourceColumn}`,
        `t.${key.targetColumn}`,
      )
      .whereNotNull(`s.${key.sourceColumn}`)
      .whereNull(`t.${key.targetColumn}`)
      .select(`s.${key.sourceColumn} as id`)
      .first();
    if (broken)
      throw new BadRequest(
        "Broken relationship; use a complete, consistent database backup",
        { table: key.sourceTable, column: key.sourceColumn, id: broken.id },
      );
  }
}
