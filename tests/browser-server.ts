import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { loadConfig } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { isolatedDatabase } from "./database.js";
if (existsSync(".cache/integration.env"))
  process.loadEnvFile(".cache/integration.env");
const port = Number(process.env.NODEPASS_BROWSER_PORT ?? 3100),
  host = process.env.NODEPASS_TEST_HOST ?? "127.0.0.1";
if (![3100, 3101].includes(port) || !["127.0.0.1", "0.0.0.0"].includes(host))
  throw new Error("Unsupported test listener");
const isolated = await isolatedDatabase(loadConfig()),
  config = {
    ...isolated.config,
    publicUrl: `http://localhost:${port}`,
    rpId: "localhost",
    port,
    dataDir: `.cache/browser-data-${port}`,
  };
await mkdir(".cache", { recursive: true });
await writeFile(
  port === 3100 ? ".cache/browser.json" : ".cache/zap.json",
  JSON.stringify({
    setupToken: config.setupToken,
    password: `violet meteor cascade ${randomBytes(8).toString("hex")}!`,
  }),
  { mode: 0o600 },
);
const runtime = await createApp(config),
  server = await runtime.app.listen(port, host);
if (!server.listening) await once(server, "listening");
console.log("Isolated browser test server ready");
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await runtime.close();
  await isolated.drop();
}
process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});
