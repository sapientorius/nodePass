import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import { dokployImport } from "../scripts/dokploy-template.mjs";
import { loadConfig } from "../packages/server/src/config.js";

describe("platform deployment bootstrap", () => {
  it.each(["coolify", "dokploy"])(
    "can paste the %s platform template without a checkout or Dockerfile",
    async (platform) => {
      const compose = YAML.parse(
        await readFile(`docker-compose.${platform}.yml`, "utf8"),
      );
      expect(compose.services.app.build).toBeUndefined();
      expect(compose.services.app.image).toMatch(
        /^\$\{NODEPASS_IMAGE:-ghcr\.io\/sapientorius\/nodepass@sha256:[a-f0-9]{64}\}$/,
      );
      expect(compose.services.app.platform).toBe("linux/amd64");
      expect(compose.services.app.volumes).toEqual(["nodepass-data:/app/data"]);
    },
  );

  it("uses Coolify's true 32-byte Base64 generator and persistent shared DB credentials", async () => {
    const compose = YAML.parse(
      await readFile("docker-compose.coolify.yml", "utf8"),
    );
    const app = compose.services.app.environment,
      db = compose.services.db.environment;
    const generated: Record<string, string> = {};
    for (const value of Object.values(app) as string[]) {
      const magic = value.match(
        /^\$\{(SERVICE_(REALBASE64_32|PASSWORD_64)_[A-Z]+):\?/,
      );
      if (magic)
        generated[magic[1]!] =
          magic[2] === "REALBASE64_32"
            ? randomBytes(32).toString("base64")
            : randomBytes(48).toString("hex").slice(0, 64);
    }
    const expand = (value: string) =>
      value.replace(
        /\$\{([^:}]+):\?[^}]*\}/g,
        (_, name: string) => generated[name]!,
      );
    const config = loadConfig({
      NODE_ENV: "production",
      PUBLIC_URL: "https://vault.example.test",
      TRUST_PROXY: "1",
      TRUSTED_PROXIES: "coolify-proxy",
      DEPLOYMENT_KEY: expand(app.DEPLOYMENT_KEY),
      SETUP_TOKEN: expand(app.SETUP_TOKEN),
      DB_PASSWORD: expand(app.DB_PASSWORD),
    });
    expect(config.deploymentKey.length).toBe(32);
    expect(config.setupToken.length).toBe(64);
    expect(app.DEPLOYMENT_KEY).toContain("SERVICE_REALBASE64_32_");
    expect(expand(db.MARIADB_PASSWORD)).toBe(config.database.password);
    expect(db.MARIADB_ROOT_PASSWORD).not.toBe(db.MARIADB_PASSWORD);
    expect(app.TRUSTED_PROXIES).toBe("${TRUSTED_PROXIES:-coolify-proxy}");
  });

  it("exports a self-contained Dokploy import pinned to the release image without generating secrets locally", async () => {
    const image = "ghcr.io/sapientorius/nodepass@sha256:" + "a".repeat(64);
    const encoded = await dokployImport(process.cwd(), image);
    expect(await dokployImport(process.cwd(), image)).toBe(encoded);
    const payload = JSON.parse(
      Buffer.from(encoded.trim(), "base64").toString(),
    );
    const compose = YAML.parse(payload.compose),
      app = compose.services.app;
    expect(payload.config).toBe(await readFile("dokploy.toml", "utf8"));
    expect(app.build).toBeUndefined();
    expect(app.image).toBe(image);
    expect(app.platform).toBe("linux/amd64");
    expect(app.read_only).toBe(true);
    expect(app.ports).toBeUndefined();
    expect(compose.services.db.ports).toBeUndefined();
    expect(app.environment.TRUSTED_PROXIES).toBe(
      "${TRUSTED_PROXIES:-dokploy-traefik}",
    );
    expect(app.environment.DB_PASSWORD).toBe(
      "${DB_PASSWORD:?Generate a database password}",
    );
    expect(compose.services.db.environment.MARIADB_PASSWORD).toBe(
      "${DB_PASSWORD:?}",
    );
    expect(payload.config).toContain('deployment_key = "${base64:32}"');
    for (const name of ["setup_token", "db_password", "db_root_password"])
      expect(payload.config).toContain(`${name} = "\${base64:48}"`);
    expect(payload.config).not.toContain("${password:");
    expect(payload.config).toContain('"DB_PASSWORD=${db_password}"');
    expect(payload.config).toContain('"DB_ROOT_PASSWORD=${db_root_password}"');
  });

  it.each([
    undefined,
    "nodepass:latest",
    "ghcr.io/sapientorius/nodepass:0.1.0",
    "nodepass@sha256:bad",
    "nodepass@sha256:" + "a".repeat(64) + "\n",
  ])("rejects an unpinned or malformed Dokploy image %s", async (image) => {
    await expect(dokployImport(process.cwd(), image)).rejects.toThrow("sha256");
  });
});
