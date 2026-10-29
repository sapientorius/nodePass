import { readFile } from "node:fs/promises";
import {
  createBaseline,
  migrate,
  resource,
  validateRelations,
  type Database,
} from "../db.js";
import { readBackup } from "./backup.js";
import { open, seal } from "../security/crypto.js";
const internal = [
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
export async function restore(
  db: Database,
  path: string,
  sourceKey: Buffer,
  targetKey: Buffer,
  directory: string,
  lockAlreadyHeld = false,
): Promise<void> {
  const [tables] = await db.raw("SHOW TABLES");
  if (tables.length)
    throw new Error("Restore requires a separate empty database");
  const legacy = JSON.parse(
    await readFile(resource("schema.json"), "utf8"),
  ) as Record<string, { name: string }[]>;
  const present = new Set<string>();
  await readBackup(path, sourceKey, directory, (record) => {
    if (
      !Object.hasOwn(legacy, record.table) &&
      !internal.includes(record.table)
    )
      throw new Error("Unknown table in backup");
    if (
      legacy[record.table] &&
      Object.keys(record.row).some(
        (k) => !legacy[record.table]!.some((c) => c.name === k),
      )
    )
      throw new Error("Unknown backup column");
    present.add(record.table);
  });
  await createBaseline(db);
  await migrate(db, lockAlreadyHeld);
  const columns = new Map<string, Set<string>>();
  for (const table of [...Object.keys(legacy), ...internal])
    columns.set(table, new Set(Object.keys(await db(table).columnInfo())));
  await db.transaction(async (trx) => {
    await trx.raw("SET FOREIGN_KEY_CHECKS=0");
    try {
      // Migration metadata created by the baseline is replaced by the authenticated snapshot.
      if (present.has("nodepass_migrations"))
        await trx("nodepass_migrations").delete();
      // A second streaming pass bounds memory; every file is authenticated before visiting records.
      await readBackup(path, sourceKey, directory, async ({ table, row }) => {
        if (Object.keys(row).some((k) => !columns.get(table)?.has(k)))
          throw new Error("Unknown backup column");
        if (
          [
            "nodepass_sessions",
            "nodepass_challenges",
            "nodepass_limits",
          ].includes(table)
        )
          return;
        if (table === "nodepass_keyring")
          row.value = seal(
            open(Buffer.from(row.value), sourceKey, `keyring/${row.id}`),
            targetKey,
            `keyring/${row.id}`,
          );
        await trx(table).insert(row);
      });
      await validateRelations(trx);
    } finally {
      await trx.raw("SET FOREIGN_KEY_CHECKS=1");
    }
  });
  await migrate(db, lockAlreadyHeld);
}
