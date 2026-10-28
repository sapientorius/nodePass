import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Context } from "koa";
import { once } from "node:events";
import * as OTPAuth from "otpauth";
import { testPassword } from "./harness.js";
import { createApp } from "../packages/server/src/app.js";
import { loadConfig } from "../packages/server/src/config.js";
import { isolatedDatabase } from "./database.js";
import { offlineUpdates } from "./offline-updates.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPolicy } from "@nodepass/contracts";
import { putSetting } from "../packages/server/src/db.js";
import { digest } from "../packages/server/src/security/crypto.js";

const verification = vi.hoisted(() => vi.fn());
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyAuthenticationResponse: verification,
}));

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "identity confirmation on the current session",
  () => {
    let runtime: Awaited<ReturnType<typeof createApp>> & {
      config: ReturnType<typeof loadConfig>;
    };
    let drop: (() => Promise<void>) | undefined, directory: string;
    let server: Awaited<ReturnType<typeof runtime.app.listen>>;
    let base: string, raw: string, csrf: string, sessionId: string;
    let otherId: number;
    const issue = async (verified = true) => {
      const ctx = {
        cookies: {
          get: () => undefined,
          set: (_key: string, value: string) => {
            raw = value;
          },
        },
      } as unknown as Context;
      const id = await runtime.auth.issue(
        ctx,
        await runtime.auth.user(1),
        verified,
      );
      csrf = id.session.csrf;
      sessionId = id.session.id;
      return id;
    };
    const request = async (
      path = "auth/confirm",
      method = "GET",
      data?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(`${base}/api/v1/${path}`, {
        method,
        headers: {
          origin: runtime.config.publicUrl,
          cookie: `nodepass=${raw}`,
          "x-csrf-token": csrf,
          "content-type": "application/json",
          ...headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const value = response.status === 204 ? undefined : await response.json();
      return { response, value };
    };
    const confirm = (data: unknown) => request("auth/confirm", "POST", data);
    const factor = async (
      kind: string,
      data: string,
      userId = 1,
      credentialId?: string,
    ) => {
      await runtime.db("nodepass_factors").insert({
        userId,
        kind,
        name: "Synthetic confirmation factor",
        data,
        confirmed: 1,
        counter: 0,
        ...(credentialId
          ? { credentialId, credentialHash: digest(credentialId) }
          : {}),
      });
    };
    const passkey = () =>
      factor(
        "passkey",
        JSON.stringify({ publicKey: Buffer.alloc(32).toString("base64") }),
        1,
        "synthetic-credential",
      );
    const options = () => request("auth/confirm/passkey-options", "POST", {});
    const assertion = (challenge: string, id = "synthetic-credential") =>
      confirm({ challenge, response: { id } });
    beforeAll(async () => {
      const isolated = await isolatedDatabase(loadConfig());
      drop = isolated.drop;
      directory = await mkdtemp(join(tmpdir(), "nodepass-confirmation-test-"));
      const config = { ...isolated.config, dataDir: directory };
      runtime = {
        ...(await createApp(config, undefined, {
          updateFetch: offlineUpdates,
        })),
        config,
      };
      server = await runtime.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing isolated listener");
      base = `http://127.0.0.1:${address.port}`;
      const setup = await request(
        "setup/fresh",
        "POST",
        { login: "admin", name: "Synthetic admin", password: testPassword },
        { "x-setup-token": config.setupToken },
      );
      expect(setup.response.status).toBe(200);
      const row = await runtime.db("User").where({ id: 1 }).first();
      delete row.id;
      [otherId] = await runtime
        .db("User")
        .insert({ ...row, login: "other-confirmation-user", isAdminApp: 0 });
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await runtime?.close();
      await drop?.();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    beforeEach(async () => {
      vi.restoreAllMocks();
      verification.mockReset().mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      await runtime.db("nodepass_factors").delete();
      await runtime.db("nodepass_sessions").delete();
      await runtime.db("nodepass_challenges").delete();
      await runtime.db("nodepass_limits").delete();
      await runtime.db("User").where({ id: 1 }).update({ isLdap: 0 });
      await putSetting(runtime.db, "security", {
        ...defaultPolicy,
        mfa: "optional",
      });
      await issue();
    });
    it("blocks an old confirmation before a policy write and resumes without rotating or extending the session", async () => {
      await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .update({ verifiedAt: Date.now() - 301000 });
      const before = await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .first();
      const policy = { ...defaultPolicy, mfa: "optional", minLength: 12 };
      const denied = await request("security", "PATCH", policy);
      expect(denied.response.status).toBe(403);
      expect(denied.value.code).toBe("REAUTHENTICATION_REQUIRED");
      expect((await runtime.auth.policy()).minLength).toBe(15);
      expect((await request()).value).toEqual({ methods: ["password"] });
      const invalid = await confirm({ password: "synthetic wrong password" });
      expect(invalid.response.status).toBe(403);
      expect(invalid.value.code).toBe("CONFIRMATION_INVALID");
      const accepted = await confirm({ password: testPassword });
      expect(accepted.value).toEqual({ confirmed: true });
      expect(accepted.response.headers.get("set-cookie")).toBeNull();
      const after = await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .first();
      expect(after.verifiedAt).toBeGreaterThan(before.verifiedAt);
      expect(after).toMatchObject({
        id: before.id,
        csrf: before.csrf,
        createdAt: before.createdAt,
        complete: before.complete,
      });
      expect((await request("security", "PATCH", policy)).response.status).toBe(
        200,
      );
    });
    it.each([
      {},
      { password: "" },
      { code: "" },
      { password: testPassword, code: "123456" },
      { response: [] },
      { challenge: "synthetic", response: {} },
      { unknown: true },
    ])("rejects malformed or mixed confirmation inputs: %j", async (data) => {
      expect((await confirm(data)).response.status).toBe(400);
    });
    it("preserves MFA and CSRF gates and distinguishes actual session expiry", async () => {
      expect(
        (
          await request(
            "auth/confirm",
            "POST",
            { password: testPassword },
            { "x-csrf-token": "wrong" },
          )
        ).response.status,
      ).toBe(403);
      await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .update({ complete: 0 });
      expect((await confirm({ password: testPassword })).response.status).toBe(
        403,
      );
      await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .update({ createdAt: 1 });
      expect((await request()).response.status).toBe(401);
    });
    it("verifies directory passwords through the directory and never the local hash", async () => {
      await runtime.db("User").where({ id: 1 }).update({ isLdap: 1 });
      const directory = vi
        .spyOn(runtime.auth, "directory")
        .mockImplementation(
          async (_user, password) =>
            password === undefined ||
            password === "synthetic directory password",
        );
      expect((await confirm({ password: testPassword })).response.status).toBe(
        403,
      );
      expect(
        (await confirm({ password: "synthetic directory password" })).response
          .status,
      ).toBe(200);
      expect(directory).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        "synthetic directory password",
      );
    });
    it("requires an enrolled factor, verifies TOTP once and keeps session-bound import challenges usable", async () => {
      const otp = new OTPAuth.TOTP({
        secret: new OTPAuth.Secret({ size: 20 }),
      });
      await factor(
        "totp",
        runtime.vault.wrap(otp.secret.base32, "totp/1").toString("base64"),
      );
      expect((await request()).value.methods).toEqual(["totp"]);
      expect((await confirm({ password: testPassword })).response.status).toBe(
        403,
      );
      const pending = await runtime.auth.challenge(1, sessionId, "import", {
        entries: [],
      });
      const code = otp.generate();
      expect((await confirm({ code })).response.status).toBe(200);
      expect(
        (await runtime.db("nodepass_sessions").where({ id: sessionId }).first())
          .csrf,
      ).toBe(csrf);
      expect(
        await runtime.auth.consume(pending, "import", 1, sessionId),
      ).toMatchObject({ entries: [] });
      expect((await confirm({ code })).response.status).toBe(403);
    });
    it("offers recovery codes and consumes each only once", async () => {
      await factor("recovery", digest("synthetic-recovery-code"));
      expect((await request()).value.methods).toEqual(["recovery"]);
      expect((await confirm({ password: testPassword })).response.status).toBe(
        403,
      );
      expect(
        (await confirm({ code: "synthetic-recovery-code" })).response.status,
      ).toBe(200);
      expect(
        (await confirm({ code: "synthetic-recovery-code" })).response.status,
      ).toBe(403);
    });
    it("shares the TOTP attempt limit with login and bounds password attempts", async () => {
      for (let index = 0; index < 5; index++)
        expect((await confirm({ code: "invalid" })).response.status).toBe(403);
      expect((await confirm({ code: "invalid" })).response.status).toBe(429);
      await runtime.db("nodepass_limits").delete();
      for (let index = 0; index < 10; index++)
        await confirm({ password: "wrong" });
      expect((await confirm({ password: testPassword })).response.status).toBe(
        429,
      );
    });
    it("offers only current-user passkeys and binds a single-use UV challenge to the current session", async () => {
      await passkey();
      expect((await request()).value.methods).toEqual(["passkey"]);
      const { value } = await options();
      expect(value.options.allowCredentials).toEqual([
        { id: "synthetic-credential", type: "public-key" },
      ]);
      expect(value.options.userVerification).toBe("required");
      const before = await runtime
        .db("nodepass_sessions")
        .where({ id: sessionId })
        .first();
      expect((await assertion(value.challenge)).response.status).toBe(200);
      expect(verification).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrigin: runtime.config.publicUrl,
          expectedRPID: runtime.config.rpId,
          requireUserVerification: true,
        }),
      );
      expect(
        (await runtime.db("nodepass_sessions").where({ id: sessionId }).first())
          .createdAt,
      ).toBe(before.createdAt);
      expect((await assertion(value.challenge)).response.status).toBe(403);
    });
    it("rejects absent, expired, foreign-session and wrong-purpose passkey challenges", async () => {
      expect((await options()).response.status).toBe(403);
      await passkey();
      expect((await assertion("missing")).response.status).toBe(403);
      const expired = (await options()).value.challenge;
      await runtime.db("nodepass_challenges").update({ expiresAt: 1 });
      expect((await assertion(expired)).response.status).toBe(403);
      const oldSession = (await options()).value.challenge;
      await issue();
      expect((await assertion(oldSession)).response.status).toBe(403);
      const login = await runtime.auth.challenge(null, null, "passkey-login", {
        challenge: "other-purpose",
      });
      expect((await assertion(login)).response.status).toBe(403);
    });
    it("rejects credentials from another user before cryptographic verification", async () => {
      await passkey();
      await factor("passkey", "{}", otherId, "foreign-credential");
      expect(
        (
          await assertion(
            (await options()).value.challenge,
            "foreign-credential",
          )
        ).response.status,
      ).toBe(403);
      expect(verification).not.toHaveBeenCalled();
    });
    it.each(["unverified", "exception", "counter race"])(
      "rejects invalid passkey assertions: %s",
      async (failure) => {
        await passkey();
        const { value } = await options();
        if (failure === "unverified")
          verification.mockResolvedValue({ verified: false });
        if (failure === "exception")
          verification.mockRejectedValue(
            new Error("Synthetic verification failure"),
          );
        if (failure === "counter race")
          verification.mockImplementation(async () => {
            await runtime
              .db("nodepass_factors")
              .where({ userId: 1 })
              .update({ counter: 10 });
            return { verified: true, authenticationInfo: { newCounter: 1 } };
          });
        expect((await assertion(value.challenge)).response.status).toBe(403);
      },
    );
    it("does not recreate a session revoked while a passkey is being checked", async () => {
      await passkey();
      const { value } = await options();
      verification.mockImplementation(async () => {
        await runtime.db("nodepass_sessions").where({ id: sessionId }).delete();
        return { verified: true, authenticationInfo: { newCounter: 1 } };
      });
      expect((await assertion(value.challenge)).response.status).toBe(401);
      expect(
        await runtime.db("nodepass_sessions").where({ id: sessionId }).first(),
      ).toBeUndefined();
    });
  },
);
