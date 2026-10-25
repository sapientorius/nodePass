import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".cache", { recursive: true });
await writeFile(
  ".cache/integration.env",
  `DB_HOST=${process.env.DB_HOST ?? "127.0.0.1"}\nDB_PORT=${process.env.DB_PORT ?? "3306"}\nDB_USER=nodepass\nDB_NAME=nodepass_test\nDB_PASSWORD=nodepass_ci_only\nDB_ROOT_PASSWORD=nodepass_ci_root_only\nDEPLOYMENT_KEY=${randomBytes(32).toString("base64")}\nSETUP_TOKEN=${randomBytes(32).toString("base64url")}\nPUBLIC_URL=http://localhost:3000\nDATA_DIR=.cache/test-data\n`,
  { mode: 0o600, flag: "wx" },
);
