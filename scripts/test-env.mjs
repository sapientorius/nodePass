import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".cache", { recursive: true });
await writeFile(
  ".cache/integration.env",
  `DB_HOST=127.0.0.1\nDB_PORT=13387\nDB_USER=nodepass\nDB_NAME=nodepass_test\nDB_PASSWORD=${randomBytes(24).toString("hex")}\nDB_ROOT_PASSWORD=${randomBytes(24).toString("hex")}\nDEPLOYMENT_KEY=${randomBytes(32).toString("base64")}\nSETUP_TOKEN=${randomBytes(32).toString("base64url")}\nDATA_DIR=.cache/test-data\nPUBLIC_URL=http://localhost:3000\n`,
  { mode: 0o600, flag: "wx" },
);
