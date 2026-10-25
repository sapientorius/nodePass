import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfig, type LegacyConfig } from "./compat/config.js";
import { proxyMatcher } from "./security/proxy.js";
export interface Config {
  production: boolean;
  port: number;
  host: string;
  publicUrl: string;
  rpId: string;
  deploymentKey: Buffer;
  setupToken: string;
  dataDir: string;
  legacy: LegacyConfig;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    socketPath?: string;
  };
  trustProxy: boolean;
  trustedProxies: string[];
}
function secret(name: string, env: NodeJS.ProcessEnv): string {
  if (env[`${name}_FILE`])
    return readFileSync(env[`${name}_FILE`]!, "utf8").trim();
  return env[name] ?? "";
}
export function loadConfig(env = process.env): Config {
  const legacy = env.SYSPASS_CONFIG
    ? parseConfig(readFileSync(env.SYSPASS_CONFIG, "utf8"))
    : {};
  const get = (name: string, old: string, fallback = ""): string =>
    secret(name, env) || String(legacy[old] ?? fallback);
  const production = env.NODE_ENV === "production";
  const publicUrl = env.PUBLIC_URL ?? "http://localhost:3000";
  const url = new URL(publicUrl);
  if (
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("PUBLIC_URL must be a bare origin");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      !production &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("HTTPS is required");
  const encoded = secret("DEPLOYMENT_KEY", env);
  const deploymentKey = Buffer.from(encoded, "base64");
  if (
    deploymentKey.length !== 32 ||
    deploymentKey.toString("base64") !== encoded
  )
    throw new Error(
      "DEPLOYMENT_KEY must contain 32 random bytes encoded as base64",
    );
  const setupToken = secret("SETUP_TOKEN", env);
  if (setupToken.length < 32)
    throw new Error("SETUP_TOKEN must contain at least 32 random characters");
  const config: Config = {
    production,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    publicUrl: url.origin,
    rpId: url.hostname,
    deploymentKey,
    setupToken,
    dataDir: resolve(env.DATA_DIR ?? "data"),
    legacy,
    database: {
      host: get("DB_HOST", "dbHost", "127.0.0.1"),
      port: Number(get("DB_PORT", "dbPort", "3306")),
      user: get("DB_USER", "dbUser", "nodepass"),
      password: get("DB_PASSWORD", "dbPass"),
      database: get("DB_NAME", "dbName", "nodepass"),
      ...(legacy.dbSocket ? { socketPath: String(legacy.dbSocket) } : {}),
    },
    // Never trust arbitrary X-Forwarded-* headers. Deployments explicitly opt in behind an isolated ingress.
    trustProxy: env.TRUST_PROXY === "1",
    trustedProxies: (env.TRUSTED_PROXIES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    !Number.isInteger(config.database.port)
  )
    throw new Error("Invalid port");
  if (!/^[a-zA-Z0-9_]+$/.test(config.database.database))
    throw new Error("Invalid database name");
  proxyMatcher(config.trustedProxies);
  if (config.trustProxy && !config.trustedProxies.length)
    throw new Error("TRUSTED_PROXIES is required when TRUST_PROXY=1");
  return config;
}
