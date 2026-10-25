import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
process.loadEnvFile(".cache/integration.env");
if (process.env.DB_NAME !== "nodepass_test")
  throw new Error("Isolated test credentials required");
const compose = [
  "compose",
  "--env-file",
  ".cache/integration.env",
  "--project-name",
  "nodepass-matrix",
  "-f",
  "tests/matrix.yml",
];
const run = (exe, args, env = process.env) =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { env, stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
let failed = false;
const results = [];
try {
  if (
    (await run("docker", [
      ...compose,
      "up",
      "--detach",
      "--wait",
      "--quiet-pull",
    ])) !== 0
  )
    throw new Error("Matrix databases failed to start");
  for (const [name, port] of [
    ["MariaDB 10.11", 13388],
    ["MariaDB 11.4", 13389],
    ["MySQL 8.4", 13390],
  ]) {
    console.log(`Checking ${name}`);
    const code = await run(process.execPath, ["scripts/run-integration.mjs"], {
      ...process.env,
      DB_HOST: "127.0.0.1",
      DB_PORT: String(port),
    });
    results.push({ name, success: code === 0 });
    if (code !== 0) failed = true;
  }
} catch (error) {
  console.error(error.message);
  failed = true;
} finally {
  await run("docker", [...compose, "down", "--volumes"]);
  await mkdir("output/security", { recursive: true });
  await writeFile(
    "output/security/database-matrix.json",
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
  );
}
if (failed) process.exitCode = 1;
