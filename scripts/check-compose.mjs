import { spawn } from "node:child_process";
import { resolve } from "node:path";
const env = {
  ...process.env,
  PUBLIC_URL: "https://vault.example.test",
  TRUSTED_PROXIES: "172.30.0.1/32",
  DEPLOYMENT_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  SETUP_TOKEN: "synthetic-compose-validation-token-only",
  SERVICE_REALBASE64_32_NODEPASSKEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  SERVICE_PASSWORD_64_NODEPASSSETUP: "synthetic-coolify-setup-token-only",
  SERVICE_PASSWORD_64_NODEPASSDB: "synthetic-coolify-password-only",
  SERVICE_PASSWORD_64_NODEPASSDBROOT: "synthetic-coolify-root-password-only",
  DB_PASSWORD: "synthetic-compose-password-only",
  DB_ROOT_PASSWORD: "synthetic-compose-root-password-only",
  SYSPASS_CONFIG_FILE: resolve("tests/fixtures/config.xml"),
  NODEPASS_PREVIEW_DB_PASSWORD: "synthetic-preview-password-only",
  NODEPASS_PREVIEW_ROOT_PASSWORD: "synthetic-preview-root-password-only",
  NODEPASS_PREVIEW_DEPLOYMENT_KEY:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  NODEPASS_PREVIEW_SETUP_TOKEN: "synthetic-preview-setup-token-only",
  NODEPASS_IMAGE: "ghcr.io/sapientorius/nodepass@sha256:" + "a".repeat(64),
};
for (const files of [
  ["docker-compose.yml"],
  ["docker-compose.coolify.yml"],
  ["docker-compose.dokploy.yml"],
  ["docker-compose.yml", "docker-compose.existing.yml"],
  ["docker-compose.preview.yml"],
  ["docker-compose.yml", "docker-compose.release.yml"],
  ["docker-compose.coolify.yml", "docker-compose.release.yml"],
  ["docker-compose.dokploy.yml", "docker-compose.release.yml"],
  [
    "docker-compose.yml",
    "docker-compose.release.yml",
    "docker-compose.existing.yml",
  ],
]) {
  const platform = files.some((file) => /\.(coolify|dokploy)\.yml$/.test(file));
  const composeEnv = { ...env };
  if (platform) delete composeEnv.TRUSTED_PROXIES;
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
        { env: composeEnv, stdio: ["ignore", "pipe", "pipe"] },
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
  if (platform) {
    const coolify = files.includes("docker-compose.coolify.yml");
    if (
      app.environment.TRUST_PROXY !== "1" ||
      app.environment.TRUSTED_PROXIES !==
        (coolify ? "coolify-proxy" : "dokploy-traefik") ||
      app.ports?.length ||
      app.environment.DB_PASSWORD !==
        config.services.db.environment.MARIADB_PASSWORD
    )
      throw new Error(
        "Platform proxy trust or shared database credential is invalid",
      );
    if (
      coolify &&
      (app.environment.DEPLOYMENT_KEY !==
        env.SERVICE_REALBASE64_32_NODEPASSKEY ||
        app.environment.SETUP_TOKEN !== env.SERVICE_PASSWORD_64_NODEPASSSETUP ||
        app.environment.DB_PASSWORD !== env.SERVICE_PASSWORD_64_NODEPASSDB ||
        config.services.db.environment.MARIADB_ROOT_PASSWORD !==
          env.SERVICE_PASSWORD_64_NODEPASSDBROOT)
    )
      throw new Error("Coolify must reuse its persistent generated secrets");
  }
  if (
    files.includes("docker-compose.release.yml") &&
    (app.build ||
      app.image !== env.NODEPASS_IMAGE ||
      app.platform !== "linux/amd64")
  )
    throw new Error(
      "Release deployments must use the pinned image without a build",
    );
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
