import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { Resolver } from "node:dns/promises";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";
import { database, type Row } from "../packages/server/src/db.js";
import { isolatedDatabase } from "./database.js";
import { legacyReference, seedLegacy } from "./legacy.js";
import { serializePhp } from "./serialization.js";
import * as OTPAuth from "otpauth";
const legacyManagementProfile = serializePhp({
  accView: true,
  accViewPass: true,
  mgmUsers: true,
});
const enabled = process.env.NODEPASS_INTEGRATION === "1";
describe.skipIf(!enabled)("authenticated asynchronous setup over HTTP", () => {
  let runtime: Awaited<ReturnType<typeof createApp>>,
    server: Awaited<ReturnType<typeof runtime.app.listen>>,
    base: string,
    drop: () => Promise<void>,
    directory: string,
    setupToken: string,
    dump: string,
    config: ReturnType<typeof loadConfig>;
  let staleRuntime: typeof runtime | undefined,
    staleServer: typeof server | undefined,
    staleBase: string;
  const call = async (
    path: string,
    data?: unknown,
    token = setupToken,
    headers: Record<string, string> = {},
    target = base,
  ) => {
    const response = await fetch(target + "/api/v1/" + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        origin: "https://vault.example.test",
        "content-type": "application/json",
        "x-setup-token": token,
        "x-forwarded-proto": "https",
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { response, value: await response.json() };
  };
  const wait = async (id: string) => {
    for (let n = 0; n < 200; n++) {
      const result = await call("setup/jobs/" + id);
      if (result.value.state !== "running") return result.value;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Setup job did not finish");
  };
  beforeAll(async () => {
    vi.spyOn(Resolver.prototype, "resolve4").mockResolvedValue(["127.0.0.1"]);
    vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue([]);
    if (existsSync(".cache/integration.env"))
      process.loadEnvFile(".cache/integration.env");
    const source = await isolatedDatabase(loadConfig()),
      db = database(source.config);
    try {
      await seedLegacy(db);
      await db("UserProfile")
        .where({ id: 1 })
        .update({ profile: legacyManagementProfile });
      const schema = JSON.parse(
        await readFile("packages/server/resources/schema.json", "utf8"),
      );
      const statements: string[] = [];
      for (const table of Object.keys(schema)) {
        for (const row of (await db(table)) as Row[]) {
          const columns = Object.keys(row);
          const literal = (v: unknown): string =>
            v === null
              ? "NULL"
              : typeof v === "number"
                ? String(v)
                : v === "" || (Buffer.isBuffer(v) && !v.length)
                  ? "''"
                  : "0x" +
                    (Buffer.isBuffer(v)
                      ? v
                      : Buffer.from(
                          v instanceof Date
                            ? v.toISOString().slice(0, 19).replace("T", " ")
                            : String(v),
                        )
                    ).toString("hex");
          statements.push(
            `INSERT INTO \`${table}\` (${columns.map((c) => "`" + c + "`").join(",")}) VALUES (${columns.map((c) => literal(row[c])).join(",")});`,
          );
        }
      }
      dump = [
        "CREATE DATABASE IF NOT EXISTS `syspass_source_ignored`; USE `syspass_source_ignored`;",
        "CREATE ALGORITHM=UNDEFINED DEFINER=`old_user`@`%` SQL SECURITY DEFINER VIEW `account_data_v` AS SELECT id FROM Account;",
        "START TRANSACTION;",
        ...statements,
        await readFile("tests/fixtures/phpmyadmin-schema-tail.sql", "utf8"),
        "COMMIT;",
      ].join("\n");
    } finally {
      await db.destroy();
      await source.drop();
    }
    const isolated = await isolatedDatabase(loadConfig());
    drop = isolated.drop;
    directory = await mkdtemp(join(tmpdir(), "nodepass-http-"));
    setupToken = isolated.config.setupToken;
    config = {
      ...isolated.config,
      dataDir: directory,
      production: true,
      publicUrl: "https://vault.example.test",
      rpId: "vault.example.test",
      trustProxy: true,
      trustedProxies: ["coolify-proxy"],
      legacy: { passwordSalt: legacyReference.publicLink.salt },
    };
    runtime = await createApp(config, undefined, {
      updateFetch: offlineUpdates,
    });
    server = await runtime.app.listen(0, "127.0.0.1");
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    if (runtime) await runtime.close();
    if (staleServer?.listening)
      await new Promise<void>((resolve, reject) =>
        staleServer!.close((error) => (error ? reject(error) : resolve())),
      );
    if (staleRuntime) await staleRuntime.close();
    if (drop) await drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("rejects spoofed proxy headers during missing DNS and IP changes, then recovers", async () => {
    const resolve4 = vi.mocked(Resolver.prototype.resolve4);
    try {
      resolve4.mockRejectedValue(new Error("ENOTFOUND"));
      expect((await call("status")).response.status).toBe(403);
      expect((await fetch(base + "/health/live")).status).toBe(200);
      resolve4.mockResolvedValue(["127.0.0.2"]);
      const rejected = await call("status", undefined, setupToken, {
        "x-real-ip": "127.0.0.2",
        "x-forwarded-for": "127.0.0.2",
      });
      expect(rejected.response.status).toBe(403);
      expect(rejected.value.message).toBe("Untrusted proxy headers");
      resolve4.mockResolvedValue(["127.0.0.1"]);
      expect((await call("status")).response.status).toBe(200);
      resolve4.mockRejectedValue(new Error("ETIMEOUT"));
      expect((await call("status")).response.status).toBe(403);
    } finally {
      resolve4.mockResolvedValue(["127.0.0.1"]);
    }
  });
  it("requires HTTPS and the setup token, restricts concurrency and sanitizes unexpected failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const progress = vi.spyOn(console, "info").mockImplementation(() => {});
    const insecure = await fetch(base + "/api/v1/status");
    expect(insecure.status).toBe(403);
    expect((await fetch(base + "/health/live")).status).toBe(200);
    expect(
      (await call("setup/import", { dump }, "wrong")).response.status,
    ).toBe(403);
    expect(
      (await call("setup/jobs/missing", undefined, "wrong")).response.status,
    ).toBe(403);
    expect((await call("setup/jobs/missing")).response.status).toBe(404);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = vi
      .spyOn(runtime.migration, "importDump")
      .mockImplementation(async () => {
        await pending;
        throw new Error("secret database detail");
      });
    const queued = await call("setup/import", { dump: "placeholder" });
    expect(queued.response.status).toBe(202);
    expect((await call("setup/import", { dump })).response.status).toBe(409);
    expect(
      (
        await call("setup/fresh", {
          login: "admin",
          name: "Synthetic",
          password: "telescope saffron synthetic 915!",
        })
      ).response.status,
    ).toBe(409);
    expect((await call("setup/jobs/" + queued.value.job)).value.state).toBe(
      "running",
    );
    runtime.migration.onProgress?.("decode");
    release();
    const failed = await wait(queued.value.job);
    expect(failed.state).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("secret database detail");
    expect(failed.error.code).toBe("SETUP_INTERNAL");
    expect(failed.error.reference).toMatch(/^[a-f0-9-]{36}$/);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(failed.error.reference),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.stringContaining(failed.error.reference),
    );
    const events = progress.mock.calls.map(([entry]) =>
      JSON.parse(String(entry)),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "setup.started",
          kind: "import",
          reference: failed.error.reference,
        }),
        expect.objectContaining({
          event: "setup.progress",
          step: "decode",
          reference: failed.error.reference,
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toMatch(
      new RegExp(
        `${queued.value.job}|${setupToken}|secret database detail|placeholder`,
      ),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "secret database detail",
    );
    mock.mockRestore();
    let first = "";
    for (let n = 0; n < 5; n++) {
      const bad = await call("setup/import", {
        dump: "CREATE TRIGGER malicious",
      });
      if (!n) first = bad.value.job;
      expect((await wait(bad.value.job)).state).toBe("failed");
    }
    expect((await call("setup/jobs/" + queued.value.job)).response.status).toBe(
      404,
    );
    expect((await call("setup/jobs/" + first)).response.status).toBe(200);
    log.mockRestore();
    progress.mockRestore();
  });
  it("explains parser and configuration errors, logs references, and validates config before changing the target", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const queued = await call("setup/import", {
        dump: "-- header\nINSERT INTO User (id,login) VALUES (1,CONCAT('private-secret'));",
      });
      const failed = await wait(queued.value.job);
      expect(failed.error).toMatchObject({
        code: "DUMP_SYNTAX",
        step: "decode",
        details: { line: 2, operation: "INSERT", table: "User", row: 1 },
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(failed.error.reference),
      );
      const invalidConfig = await call("setup/import", {
        dump,
        configuration: "<config><secret>private-secret</secret>",
      });
      const configFailure = await wait(invalidConfig.value.job);
      expect(configFailure.error).toMatchObject({
        code: "CONFIG_XML",
        step: "configuration",
      });
      expect(await runtime.migration.status()).toEqual({
        legacy: false,
        installed: false,
        ready: false,
      });
      const preflight = await call("setup/preflight", {
        configuration: "<wrong/>",
      });
      expect(preflight.response.status).toBe(400);
      expect(preflight.value).toMatchObject({
        code: "CONFIG_ROOT",
        step: "request",
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(preflight.value.reference),
      );
      expect(
        JSON.stringify([
          failed,
          configFailure,
          preflight.value,
          log.mock.calls,
        ]),
      ).not.toContain("private-secret");
      const empty = await call("setup/import", {
        dump: "CREATE DATABASE IF NOT EXISTS `source`;",
      });
      expect((await wait(empty.value.job)).error.code).toBe("DUMP_EMPTY");
      expect((await runtime.migration.status()).legacy).toBe(false);
      const badMetadata = await call("setup/import", {
        dump: "START TRANSACTION;\nINSERT INTO User (id,login) VALUES (1,'private-secret');\nALTER TABLE User ADD KEY idx (login), DROP COLUMN pass;\nCOMMIT;",
      });
      const metadataJob = await wait(badMetadata.value.job);
      expect(metadataJob.error).toMatchObject({
        code: "DUMP_ALTER",
        details: { line: 3, operation: "ALTER", table: "User" },
      });
      expect(JSON.stringify([metadataJob, log.mock.calls])).not.toContain(
        "private-secret",
      );
      expect((await runtime.migration.status()).legacy).toBe(false);
      const unsupported = await call("setup/import", {
        dump: "START TRANSACTION;\nINSERT INTO User (id,login) VALUES (1,'private-secret');\nUPDATE User SET login='private-secret';\nCOMMIT;",
      });
      const unsupportedJob = await wait(unsupported.value.job);
      expect(unsupportedJob.error).toMatchObject({
        code: "DUMP_OPERATION",
        details: { line: 3, operation: "UPDATE" },
      });
      expect(JSON.stringify([unsupportedJob, log.mock.calls])).not.toContain(
        "private-secret",
      );
      expect((await runtime.migration.status()).legacy).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
  it("imports real legacy rows, checks identities and retains final status after closing setup", async () => {
    staleRuntime = await createApp(config, undefined, {
      updateFetch: offlineUpdates,
    });
    staleServer = await staleRuntime.app.listen(0, "127.0.0.1");
    if (!staleServer.listening) await once(staleServer, "listening");
    const staleAddress = staleServer.address();
    if (!staleAddress || typeof staleAddress === "string")
      throw new Error("Missing stale listener");
    staleBase = `http://127.0.0.1:${staleAddress.port}`;
    const configuration = `<config><appVersion>310.19081801</appVersion><databaseVersion>unknown</databaseVersion><passwordSalt>${legacyReference.publicLink.salt}</passwordSalt></config>`;
    const imported = await call("setup/import", { dump, configuration });
    expect(imported.response.status).toBe(202);
    const importedJob = await wait(imported.value.job);
    expect(importedJob.state, JSON.stringify(importedJob)).toBe("complete");
    expect(importedJob.result).toEqual({ imported: true });
    const payload = {
      configuration,
      login: "admin",
      password: "a".repeat(72),
      masterPassword: legacyReference.master,
      maintenance: true,
    };
    const newIdentity = await call("setup/migrate", {
      ...payload,
      login: "new-nodepass-admin",
      password: "synthetic-new-nodepass-password",
    });
    const rejectedIdentity = await wait(newIdentity.value.job);
    expect(rejectedIdentity.error).toMatchObject({
      code: "SETUP_ADMIN_REQUIRED",
      step: "confirm",
      details: { reason: "not_found" },
    });
    expect(rejectedIdentity.error.message).toContain(
      "No user with this login exists",
    );
    expect(JSON.stringify(rejectedIdentity)).not.toMatch(
      /new-nodepass-admin|synthetic-new-nodepass-password/,
    );
    expect(await runtime.migration.status()).toEqual({
      legacy: true,
      installed: false,
      ready: false,
    });
    const invalidPassword = await call("setup/migrate", {
      ...payload,
      password: "synthetic-wrong-existing-password",
    });
    const passwordFailure = await wait(invalidPassword.value.job);
    expect(passwordFailure.error).toMatchObject({
      code: "SETUP_ADMIN_REQUIRED",
      step: "confirm",
      details: { reason: "password_rejected" },
    });
    expect(passwordFailure.error.message).toContain("time of the export");
    expect(JSON.stringify(passwordFailure)).not.toContain(
      "synthetic-wrong-existing-password",
    );
    const wrong = await call("setup/migrate", {
      ...payload,
      masterPassword: "wrong",
    });
    expect((await wait(wrong.value.job)).error.message).toContain(
      "Invalid master password",
    );
    const badData = await runtime.db("Account").where({ id: 1 }).first();
    await runtime.db("Account").where({ id: 1 }).update({ pass: "corrupt" });
    const corrupt = await call("setup/migrate", payload);
    const failure = await wait(corrupt.value.job);
    expect(failure.error.details).toEqual({ table: "Account", id: 1 });
    await runtime.db("Account").where({ id: 1 }).update({ pass: badData.pass });
    const queued = await call("setup/migrate", payload);
    const finished = await wait(queued.value.job);
    expect(finished.state, JSON.stringify(finished)).toBe("complete");
    expect(
      (await runtime.db("UserProfile").where({ id: 1 }).first()).profile,
    ).toEqual(Buffer.from(legacyManagementProfile));
    const importedUser = await runtime.auth.user(2);
    expect(importedUser.profile.mgmUsers).toBe(true);
    expect(importedUser.profile).not.toHaveProperty("mgmUsersResetPassword");
    expect(finished.result.backup).toMatch(/\.npb$/);
    expect((await call("status")).value.setupRequired).toBe(false);
    expect((await call("setup/import", { dump })).response.status).toBe(403);
    const signedIn = await call("auth/login", {
      login: "admin",
      password: payload.password,
    });
    expect(signedIn.response.status).toBe(200);
    expect(signedIn.response.headers.get("set-cookie")).toMatch(/; secure/i);
    expect(signedIn.response.headers.get("set-cookie")).toMatch(/; httponly/i);
    expect(signedIn.value.phase).toBe("verify");
    expect(JSON.stringify(finished)).not.toContain(payload.password);
    const cookie = signedIn.response.headers.get("set-cookie")!.split(";")[0]!,
      factor = await runtime
        .db("nodepass_factors")
        .where({ userId: 1, kind: "totp" })
        .first(),
      otp = new OTPAuth.TOTP({
        secret: runtime.vault
          .unwrap(Buffer.from(factor.data, "base64"), "totp/1")
          .toString(),
      });
    const verified = await call(
      "auth/totp/verify",
      { code: otp.generate() },
      setupToken,
      {
        cookie,
        "x-csrf-token": signedIn.value.csrf,
      },
    );
    expect(verified.value.phase).toBe("ready");
    const readyCookie = verified.response.headers
      .get("set-cookie")!
      .split(";")[0]!;
    const accountsBefore = await call("accounts", undefined, setupToken, {
      cookie: readyCookie,
    });
    expect(
      accountsBefore.response.status,
      JSON.stringify(accountsBefore.value),
    ).toBe(200);
    expect(accountsBefore.value.total).toBeGreaterThan(0);

    // This process started before import and must not offer setup from its old snapshot.
    expect((await staleRuntime.migration.status()).ready).toBe(true);
    const staleStatus = await call(
      "status",
      undefined,
      setupToken,
      {},
      staleBase,
    );
    expect(staleStatus.response.status).toBe(503);
    expect(staleStatus.value).toMatchObject({ code: "SETUP_STATE_CHANGED" });
    expect(staleStatus.value.message).toContain("Restart this app");
    expect(staleStatus.value).not.toHaveProperty("setupRequired", true);
    for (const path of ["setup/import", "setup/fresh", "setup/migrate"])
      expect(
        (await call(path, {}, setupToken, {}, staleBase)).response.status,
      ).toBe(503);
    expect(
      (
        await call(
          "accounts",
          undefined,
          setupToken,
          { cookie: readyCookie },
          staleBase,
        )
      ).response.status,
    ).toBe(503);
    expect((await fetch(staleBase + "/health/live")).status).toBe(200);
    const staleReady = await fetch(staleBase + "/health/ready");
    expect(staleReady.status).toBe(503);
    expect(await staleReady.json()).toEqual({ status: "restart-required" });
    expect((await call("status")).value.setupRequired).toBe(false);
    await new Promise<void>((resolve, reject) =>
      staleServer!.close((error) => (error ? reject(error) : resolve())),
    );
    await staleRuntime.close();
    staleServer = undefined;
    staleRuntime = undefined;

    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await runtime.close();
    runtime = await createApp(config, undefined, {
      updateFetch: offlineUpdates,
    });
    server = await runtime.app.listen(0, "127.0.0.1");
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing listener");
    base = `http://127.0.0.1:${address.port}`;
    expect((await call("status")).value.setupRequired).toBe(false);
    expect(
      (
        await call("auth/session", undefined, setupToken, {
          cookie: readyCookie,
        })
      ).value.phase,
    ).toBe("ready");
    expect(
      (await call("accounts", undefined, setupToken, { cookie: readyCookie }))
        .value.total,
    ).toBeGreaterThan(0);
    expect(
      (
        await call("auth/session", undefined, setupToken, {
          cookie: `nodepass=${"a".repeat(43)}`,
        })
      ).response.status,
    ).toBe(401);
    expect((await call("status")).value.setupRequired).toBe(false);
    expect((await call("setup/import", { dump })).response.status).toBe(403);
  }, 60000);
});
