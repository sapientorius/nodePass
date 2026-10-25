import { spawn } from "node:child_process";
import { resolve } from "node:path";
const env = {
  ...process.env,
  PUBLIC_URL: "https://vault.example.test",
  TRUSTED_PROXIES: "172.30.0.1/32",
  DEPLOYMENT_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  SETUP_TOKEN: "synthetic-compose-validation-token-only",
  DB_PASSWORD: "synthetic-compose-password-only",
  DB_ROOT_PASSWORD: "synthetic-compose-root-password-only",
  SYSPASS_CONFIG_FILE: resolve("tests/fixtures/config.xml"),
  NODEPASS_PREVIEW_DB_PASSWORD: "synthetic-preview-password-only",
  NODEPASS_PREVIEW_ROOT_PASSWORD: "synthetic-preview-root-password-only",
  NODEPASS_PREVIEW_DEPLOYMENT_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODEPASS_PREVIEW_SETUP_TOKEN: "synthetic-preview-setup-token-only",
};
for (const files of [
  ["docker-compose.yml"],
  ["docker-compose.coolify.yml"],
  ["docker-compose.dokploy.yml"],
  ["docker-compose.yml", "docker-compose.existing.yml"],
  ["docker-compose.preview.yml"],
]) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
        "docker",
        [
          "compose",
          ...files.flatMap((file) => ["-f", file]),
          "config",
          "--format",
          "json",
        ],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      ),
      chunks = [],
      errors = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errors.push(c));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks).toString())
        : reject(
            new Error(
              "Compose validation failed: " +
                files.join(",") +
                " " +
                Buffer.concat(errors).toString(),
            ),
          ),
    );
  });
  const config = JSON.parse(output),
    app = config.services.app;
  if (
    !app.read_only ||
    !app.cap_drop.includes("ALL") ||
    !app.security_opt.includes("no-new-privileges:true") ||
    config.services.db?.ports?.length ||
    JSON.stringify(config).includes("/var/run/docker.sock")
  )
    throw new Error("Unsafe deployment configuration");
  if (
    files.includes("docker-compose.preview.yml") &&
    (app.environment.NODE_ENV !== "development" ||
      app.environment.PUBLIC_URL !== "http://localhost:3000" ||
      app.environment.TRUST_PROXY !== "0" ||
      app.ports.length !== 1 ||
      app.ports[0].host_ip !== "127.0.0.1" ||
      app.ports[0].published !== "3000" ||
      !app.volumes.some((volume) => volume.type === "volume") ||
      !config.services.db.volumes.some((volume) => volume.type === "volume"))
  )
    throw new Error("Preview must remain local with persistent data");
  if (
    files.includes("docker-compose.existing.yml") &&
    Object.keys(app.depends_on ?? {}).length
  )
    throw new Error(
      "Existing database deployment must not start a new database",
    );
  console.log("Validated " + files.join(" + "));
}
