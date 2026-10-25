import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { database, type Row } from "../packages/server/src/db.js";
import { isolatedDatabase } from "./database.js";
import { legacyReference, seedLegacy } from "./legacy.js";
const enabled = process.env.NODEPASS_INTEGRATION === "1";
describe.skipIf(!enabled)("authenticated asynchronous setup over HTTP", () => {
  let runtime: Awaited<ReturnType<typeof createApp>>,
    server: Awaited<ReturnType<typeof runtime.app.listen>>,
    base: string,
    drop: () => Promise<void>,
    directory: string,
    setupToken: string,
    dump: string;
  const call = async (
    path: string,
    data?: unknown,
    token = setupToken,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + "/api/v1/" + path, {
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
    if (existsSync(".cache/integration.env"))
      process.loadEnvFile(".cache/integration.env");
    const source = await isolatedDatabase(loadConfig()),
      db = database(source.config);
    try {
      await seedLegacy(db);
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
    runtime = await createApp({
      ...isolated.config,
      dataDir: directory,
      production: true,
      publicUrl: "https://vault.example.test",
      rpId: "vault.example.test",
      trustProxy: true,
      trustedProxies: ["127.0.0.1/32"],
      legacy: { passwordSalt: legacyReference.publicLink.salt },
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
    if (drop) await drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("requires HTTPS and the setup token, restricts concurrency and sanitizes unexpected failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect((await call("setup/jobs/" + queued.value.job)).value.state).toBe(
      "running",
    );
    release();
    const failed = await wait(queued.value.job);
    expect(failed.state).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain("secret database detail");
    expect(failed.error.code).toBe("SETUP_INTERNAL");
    expect(failed.error.reference).toMatch(/^[a-f0-9-]{36}$/);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(failed.error.reference),
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
  }, 60000);
});
