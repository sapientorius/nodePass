import knex from "knex";
import { randomBytes } from "node:crypto";
import type { Config } from "../packages/server/src/config.js";
/** Creates only isolated, randomly named test databases and grants the test application access. */
export async function isolatedDatabase(
  config: Config,
): Promise<{ config: Config; drop: () => Promise<void> }> {
  if (
    !config.database.database.endsWith("_test") ||
    !process.env.DB_ROOT_PASSWORD
  )
    throw new Error("Explicit test database and root test credential required");
  const name = `nodepass_test_${randomBytes(8).toString("hex")}`;
  const root = knex({
    client: "mysql2",
    connection: {
      host: config.database.host,
      port: config.database.port,
      user: "root",
      password: process.env.DB_ROOT_PASSWORD,
    },
    pool: { min: 0, max: 2 },
  });
  await root.raw(
    "CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    [name],
  );
  await root.raw("GRANT ALL PRIVILEGES ON ??.* TO ?@?", [
    name,
    config.database.user,
    "%",
  ]);
  return {
    config: { ...config, database: { ...config.database, database: name } },
    drop: async () => {
      if (!/^nodepass_test_[a-f0-9]{16}$/.test(name))
        throw new Error("Invalid test database");
      await root.raw("DROP DATABASE ??", [name]);
      await root.destroy();
    },
  };
}
