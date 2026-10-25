import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import * as OTPAuth from "otpauth";
import { request as httpRequest } from "node:http";
import { evaluateAlerts } from "./zap-policy.mjs";
// This process creates and destroys its own synthetic database. Never accepts a production target URL.
const image =
    "ghcr.io/zaproxy/zaproxy@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6",
  container = `nodepass-zap-${randomBytes(6).toString("hex")}`,
  key = randomBytes(32).toString("hex"),
  target = "http://host.docker.internal:3101",
  local = "http://localhost:3101",
  zap = "http://127.0.0.1:18081",
  origin = local;
await mkdir("output/security", { recursive: true });
const command = (exe, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let errors = "";
    p.stderr.on("data", (data) => {
      errors += data;
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${exe} exited ${code}: ${errors.slice(-1000)}`)),
    );
  });
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/browser-server.ts"],
  {
    env: {
      ...process.env,
      NODEPASS_BROWSER_PORT: "3101",
      NODEPASS_TEST_HOST: "0.0.0.0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.resume();
server.stderr.resume();
let cookie = "",
  csrf = "",
  refresh;
async function waitFor(fn) {
  let failure = "";
  for (let n = 0; n < 120; n++) {
    try {
      return await fn();
    } catch (error) {
      failure = error instanceof Error ? error.message : "Unknown failure";
      await delay(1000);
    }
  }
  throw new Error(`Security test startup timeout: ${failure}`);
}
async function app(path, data, headers = {}) {
  const response = await fetch(local + "/api/v1/" + path, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
      ...headers,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok)
    throw new Error(
      `Test authentication failed at ${path}: ${response.status}`,
    );
  const value = await response.json();
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  csrf = value.csrf ?? csrf;
  return value;
}
async function api(component, kind, method, params = {}) {
  const url = new URL(`${zap}/JSON/${component}/${kind}/${method}/`);
  url.search = new URLSearchParams({
    apikey: key,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  }).toString();
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 18081,
        path: url.pathname + url.search,
        headers: { Host: "localhost:8080" },
        timeout: 10000,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            const value = JSON.parse(data);
            if (response.statusCode !== 200 || value.code)
              throw new Error(
                `ZAP ${component}/${method} failed: ${response.statusCode} ${value.code ?? ""}`,
              );
            resolve(value);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("ZAP API timeout")));
    request.end();
  });
}
async function header(name, value) {
  await api("replacer", "action", "addRule", {
    description: `nodepass-${name}`,
    enabled: true,
    matchType: "REQ_HEADER",
    matchRegex: false,
    matchString: name,
    replacement: value,
    url: "^http://host\\.docker\\.internal:3101/.*",
  });
}
async function scan(kind, method, params) {
  const value = await api(kind, "action", method, params),
    id = value.scan;
  const start = Date.now();
  while (true) {
    const state = await api(kind, "view", "status", { scanId: id });
    if (Number(state.status) === 100) return;
    if (Date.now() - start > 15 * 60000)
      throw new Error(`ZAP ${kind} did not complete`);
    await delay(2000);
  }
}
try {
  await waitFor(async () => {
    const response = await fetch(local + "/health/live");
    if (!response.ok) throw new Error("not ready");
  });
  console.log("Isolated scan application ready.");
  const secrets = JSON.parse(await readFile(".cache/zap.json", "utf8"));
  await app(
    "setup/fresh",
    {
      login: "scan-admin",
      name: "Synthetic scan admin",
      password: secrets.password,
    },
    { "x-setup-token": secrets.setupToken },
  );
  await app("auth/login", { login: "scan-admin", password: secrets.password });
  const totp = await app("auth/totp/start", {}),
    otp = new OTPAuth.TOTP({ secret: totp.secret });
  await app("auth/totp/enroll", {
    challenge: totp.challenge,
    code: otp.generate(),
  });
  await app("accounts", {
    name: "Synthetic scan account",
    login: "scan",
    password: "synthetic scanned value",
    categoryId: 1,
    clientId: 1,
    userGroupId: 1,
  });
  await command("docker", [
    "run",
    "--detach",
    "--name",
    container,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--publish",
    "127.0.0.1:18081:8080",
    image,
    "zap.sh",
    "-daemon",
    "-silent",
    "-host",
    "0.0.0.0",
    "-port",
    "8080",
    "-config",
    `api.key=${key}`,
    "-config",
    "api.addrs.addr.name=.*",
    "-config",
    "api.addrs.addr.regex=true",
    "-config",
    "connection.timeoutInSecs=10",
  ]);
  await waitFor(() => api("core", "view", "version"));
  console.log("ZAP API ready.");
  await header("Cookie", cookie);
  await header("X-CSRF-Token", csrf);
  await header("Origin", origin);
  const context = await api("context", "action", "newContext", {
    contextName: "nodePass",
  });
  await api("context", "action", "includeInContext", {
    contextName: "nodePass",
    regex: "http://host\\.docker\\.internal:3101/.*",
  });
  await api("context", "action", "excludeFromContext", {
    contextName: "nodePass",
    regex: ".*/api/v1/(?:auth|setup|backups|integrations|import|export).*",
  });
  await api("context", "action", "setContextInScope", {
    contextName: "nodePass",
    booleanInScope: true,
  });
  // Refresh using a real second factor; a scanner never receives a privileged bypass.
  let refreshing = false;
  refresh = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    void (async () => {
      await app("auth/totp/verify", { code: otp.generate() });
      for (const [name, value] of [
        ["Cookie", cookie],
        ["X-CSRF-Token", csrf],
      ]) {
        await api("replacer", "action", "removeRule", {
          description: `nodepass-${name}`,
        });
        await header(name, value);
      }
    })()
      .catch(() => {
        process.exitCode = 1;
      })
      .finally(() => {
        refreshing = false;
      });
  }, 120000);
  for (const path of [
    "/",
    "/api/v1/accounts",
    "/api/v1/accounts/1",
    "/api/v1/accounts?search=scan",
    "/api/v1/categories",
    "/api/v1/clients",
    "/api/v1/accounts/1/history",
    "/api/v1/accounts/1/fields",
  ])
    await api("core", "action", "accessUrl", {
      url: target + path,
      followRedirects: false,
    });
  // Verify that ZAP actually sees an authenticated resource before scanning it.
  const checked = await api("core", "view", "messages", {
    baseurl: target + "/api/v1/accounts",
    start: 0,
    count: 10,
  });
  if (
    !checked.messages.some(
      (m) =>
        m.responseHeader.includes("200") &&
        m.responseBody.includes("Synthetic scan account"),
    )
  )
    throw new Error("ZAP authentication verification failed");
  await scan("spider", "scan", {
    url: target + "/",
    contextName: "nodePass",
    subtreeOnly: true,
  });
  await scan("ascan", "scan", {
    url: target + "/api/v1/",
    recurse: true,
    inScopeOnly: true,
    contextId: context.contextId,
  });
  await waitFor(async () => {
    const state = await api("pscan", "view", "recordsToScan");
    if (Number(state.recordsToScan) !== 0) throw new Error("pending");
    return state;
  });
  const alerts = (
    await api("core", "view", "alerts", {
      baseurl: target,
      start: 0,
      count: 10000,
    })
  ).alerts;
  await writeFile(
    "output/security/zap.json",
    JSON.stringify(
      { target: "isolated synthetic instance", authenticated: true, alerts },
      null,
      2,
    ),
  );
  const exceptions = JSON.parse(
    await readFile("security/zap-exceptions.json", "utf8"),
  );
  const blocking = evaluateAlerts(alerts, exceptions);
  console.log(
    `Authenticated ZAP scan complete: ${alerts.length} alerts, ${blocking.length} unreviewed medium/high findings.`,
  );
  if (blocking.length) {
    console.error(blocking.map((a) => `${a.alertRef}: ${a.name}`).join("\n"));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Security scan failed",
  );
  process.exitCode = 1;
} finally {
  clearInterval(refresh);
  await command("docker", ["rm", "--force", container]).catch(() => {});
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
  });
}
