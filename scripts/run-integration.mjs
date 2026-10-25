import { spawn } from "node:child_process";
process.loadEnvFile(".cache/integration.env");
const proc = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, NODEPASS_INTEGRATION: "1" } },
);
proc.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
