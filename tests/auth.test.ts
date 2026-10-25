import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type { Context } from "koa";
import * as OTPAuth from "otpauth";
import bcrypt from "bcryptjs";
import { bounded } from "../packages/server/src/security/password.js";
import { createHmac } from "node:crypto";
import { harness } from "./harness.js";
import {
  Auth,
  body,
  exact,
  text,
  mapData,
} from "../packages/server/src/security/auth.js";
import { putSetting } from "../packages/server/src/db.js";
import { digest, token } from "../packages/server/src/security/crypto.js";
import { defaultPolicy } from "@nodepass/contracts";
const mock = vi.hoisted(() => ({
  registration: vi.fn(),
  authentication: vi.fn(),
  entries: [] as any[],
  bind: vi.fn(),
  search: vi.fn(),
  startTLS: vi.fn(),
  unbind: vi.fn(),
}));
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: mock.registration,
  verifyAuthenticationResponse: mock.authentication,
}));
vi.mock("ldapts", () => ({
  Client: class {
    bind = mock.bind;
    search = mock.search;
    startTLS = mock.startTLS;
    unbind = mock.unbind;
  },
}));
function context(
  data: unknown = {},
  headers: Record<string, string> = {},
  cookie = "",
) {
  const values = new Map<string, string>(cookie ? [["nodepass", cookie]] : []);
  const ctx = {
    method: "POST",
    request: { body: data },
    ip: "127.0.0.1",
    req: { socket: { remoteAddress: "127.0.0.1" } },
    get: (key: string) => headers[key.toLowerCase()] ?? "",
    cookies: {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  } as unknown as Context;
  return { ctx, values };
}
describe("strict authentication input", () => {
  it("bounds expensive password work and recovers capacity after completion", async () => {
    const release: (() => void)[] = [];
    const work = Array.from({ length: 4 }, () =>
      bounded(() => new Promise<void>((resolve) => release.push(resolve))),
    );
    await expect(bounded(async () => {})).rejects.toThrow("capacity");
    release.forEach((fn) => fn());
    await Promise.all(work);
    await expect(bounded(async () => true)).resolves.toBe(true);
  });
  it.each([null, [], 0, "text"])("rejects non-object body %s", (value) =>
    expect(() => body(context(value).ctx)).toThrow(),
  );
  it("validates exact keys, strings, preferences and empty data", () => {
    expect(mapData(null)).toEqual({});
    expect(mapData('NPJ1:{"lang":"de_DE"}')).toEqual({ lang: "de_DE" });
    expect(mapData("a:0:{}")).toEqual({});
    expect(() => text({ x: "" }, "x")).toThrow();
    expect(() => text({ x: "too long" }, "x", 2)).toThrow();
    expect(() => exact({ root: true }, [])).toThrow();
    expect(body(context({ login: "x" }).ctx)).toEqual({ login: "x" });
  });
});
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "authentication state transitions on real storage",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      raw = "",
      csrf = "";
    const client = (data: unknown = {}, method = "POST") => {
      const c = context(data, { "x-csrf-token": csrf }, raw);
      c.ctx.method = method;
      return c;
    };
    const issue = async (verified = false) => {
      const c = context();
      const id = await r.auth.issue(c.ctx, await r.auth.user(1), verified);
      raw = c.values.get("nodepass")!;
      csrf = id.session.csrf;
      return id;
    };
    const accept = (c: ReturnType<typeof context>) => {
      raw = c.values.get("nodepass")!;
      csrf = (c.ctx.body as any).csrf;
    };
    beforeAll(async () => {
      r = await harness();
    });
    afterAll(async () => {
      await r?.dispose();
    });
    beforeEach(() => {
      mock.bind.mockReset().mockResolvedValue(undefined);
      mock.unbind.mockReset().mockResolvedValue(undefined);
      mock.startTLS.mockReset().mockResolvedValue(undefined);
      mock.search
        .mockReset()
        .mockImplementation(async () => ({ searchEntries: mock.entries }));
    });
    it("rotates session IDs, gates enrollment, expires idle and absolute sessions, rejects CSRF", async () => {
      const pending = await issue();
      expect((await r.auth.viewer(pending)).phase).toBe("enroll");
      expect((await r.auth.identity(client({}, "GET").ctx, true)).user.id).toBe(
        1,
      );
      await expect(r.auth.identity(client({}, "GET").ctx)).rejects.toThrow(
        "multi-factor",
      );
      await expect(r.auth.identity(context({}, {}).ctx)).rejects.toThrow();
      await expect(
        r.auth.identity(context({}, {}, "x".repeat(101)).ctx),
      ).rejects.toThrow();
      const old = raw;
      await issue(true);
      expect(raw).not.toBe(old);
      await expect(
        r.auth.identity(context({}, {}, old).ctx, true),
      ).rejects.toThrow();
      await expect(
        r.auth.identity(context({}, { "x-csrf-token": "bad" }, raw).ctx),
      ).rejects.toThrow("CSRF");
      let id = await r.auth.identity(client().ctx);
      await r
        .db("nodepass_sessions")
        .where({ id: id.session.id })
        .update({ lastSeen: Date.now() - 40000 });
      expect((await r.auth.identity(client().ctx)).user.id).toBe(1);
      await r
        .db("nodepass_sessions")
        .where({ id: id.session.id })
        .update({ lastSeen: 1 });
      await expect(r.auth.identity(client().ctx)).rejects.toThrow("expired");
      id = await issue(true);
      await r
        .db("nodepass_sessions")
        .where({ id: id.session.id })
        .update({ createdAt: 1 });
      await expect(r.auth.identity(client().ctx)).rejects.toThrow("expired");
      id = await issue(true);
      id.session.verifiedAt = Date.now() - 301000;
      expect(() => r.auth.requireRecent(id)).toThrow();
      id.session.complete = 0;
      expect(() => r.auth.requireRecent(id)).toThrow();
    });
    it("maintains persistent user/source limits with an expiry window", async () => {
      await r.auth.limit("case", "source", 1, 1000);
      await expect(r.auth.limit("case", "source", 1, 1000)).rejects.toThrow(
        "later",
      );
      await r
        .db("nodepass_limits")
        .where({ id: digest("case/source") })
        .update({ resetAt: 1 });
      await expect(
        r.auth.limit("case", "source", 1, 1000),
      ).resolves.toBeUndefined();
    });
    it("grandfathers weak PHP passwords and upgrades hashes only after a valid login", async () => {
      const hash = await bcrypt.hash("old", 4);
      await r.db("User").where({ id: 1 }).update({ pass: hash });
      await expect(
        r.auth.login(context({ login: "unknown", password: "wrong" }).ctx),
      ).rejects.toThrow("credentials");
      await expect(
        r.auth.login(context({ login: "admin", password: "wrong" }).ctx),
      ).rejects.toThrow("credentials");
      expect(
        Buffer.from(
          (await r.db("User").where({ id: 1 }).first()).pass,
        ).toString(),
      ).toBe(hash);
      const c = context({ login: "admin", password: "old" });
      await r.auth.login(c.ctx);
      accept(c);
      expect(
        Buffer.from(
          (await r.db("User").where({ id: 1 }).first()).pass,
        ).toString(),
      ).toMatch(/^\$argon2id\$/);
      await r.db("User").where({ id: 1 }).update({ isDisabled: 1 });
      await expect(r.auth.user(1)).rejects.toThrow();
      await expect(
        r.auth.login(context({ login: "admin", password: "old" }).ctx),
      ).rejects.toThrow();
      await r.db("User").where({ id: 1 }).update({ isDisabled: 0 });
      await r
        .db("User")
        .where({ id: 1 })
        .update({ preferences: 'NPJ1:{"lang":"ja_JP"}' });
      expect((await r.auth.user(1)).language).toBe("ja_JP");
      await expect(r.auth.user(99999)).rejects.toThrow();
    });
    it("enforces one-use, expiry, session and user binding for encrypted challenges", async () => {
      const challenge = await r.auth.challenge(1, "session", "test", {
        secret: "private value",
      });
      const stored = await r
        .db("nodepass_challenges")
        .where({ id: digest(challenge) })
        .first();
      expect(stored.value).not.toContain("private value");
      await expect(
        r.auth.consume(challenge, "test", 2, "session"),
      ).rejects.toThrow();
      await expect(
        r.auth.consume(challenge, "test", 1, "other"),
      ).rejects.toThrow();
      expect(
        (await r.auth.consume(challenge, "test", 1, "session")).secret,
      ).toBe("private value");
      await expect(r.auth.consume(challenge, "test")).rejects.toThrow();
      const expired = await r.auth.challenge(null, null, "test", {});
      await r
        .db("nodepass_challenges")
        .where({ id: digest(expired) })
        .update({ expiresAt: 1 });
      await expect(r.auth.consume(expired, "test")).rejects.toThrow();
    });
    it("enrolls TOTP, prevents future-window replay and never permits enrollment to bypass existing MFA", async () => {
      await issue();
      const c = client();
      await r.auth.totpStart(c.ctx);
      const enrollment = c.ctx.body as any,
        otp = new OTPAuth.TOTP({ secret: enrollment.secret });
      const finish = client({
        challenge: enrollment.challenge,
        code: otp.generate({ timestamp: Date.now() + 30000 }),
      });
      await r.auth.totpFinish(finish.ctx);
      accept(finish);
      expect((finish.ctx.body as any).phase).toBe("ready");
      expect(
        (await r.db("nodepass_factors").where({ kind: "totp" }).first()).data,
      ).not.toContain(enrollment.secret);
      await expect(r.auth.totpStart(client().ctx)).rejects.toThrow("already");
      await expect(
        r.auth.totpVerify(
          client({ code: otp.generate({ timestamp: Date.now() + 30000 }) }).ctx,
        ),
      ).rejects.toThrow("Invalid code");
      await issue();
      expect(
        (
          await r.auth.viewer(
            await r.auth.identity(client({}, "GET").ctx, true),
          )
        ).phase,
      ).toBe("verify");
      await expect(r.auth.totpStart(client().ctx)).rejects.toThrow(
        "existing factor",
      );
      await expect(r.auth.passkeyOptions(client().ctx, true)).rejects.toThrow(
        "existing factor",
      );
      await r
        .db("nodepass_factors")
        .where({ kind: "totp" })
        .update({ counter: 0 });
      const verified = client({ code: otp.generate() });
      await r.auth.totpVerify(verified.ctx);
      accept(verified);
      expect((verified.ctx.body as any).phase).toBe("ready");
      await expect(
        r.auth.totpVerify(client({ code: "000000" }).ctx),
      ).rejects.toThrow();
      const recovery = client();
      await r.auth.recovery(recovery.ctx);
      const codes = (recovery.ctx.body as any).codes;
      expect(codes).toHaveLength(10);
      expect(
        (await r.db("nodepass_factors").where({ kind: "recovery" }).first())
          .data,
      ).not.toBe(codes[0]);
      const useCode = client({ code: codes[0] });
      await r.auth.totpVerify(useCode.ctx);
      accept(useCode);
      await expect(
        r.auth.totpVerify(client({ code: codes[0] }).ctx),
      ).rejects.toThrow();
      await r
        .db("nodepass_limits")
        .where({ id: digest("totp/1") })
        .delete();
    });
    it("binds WebAuthn verification to the exact RP, origin and user verification; revokes old sessions", async () => {
      await issue(true);
      const c = client();
      await r.auth.passkeyOptions(c.ctx, true);
      const options = c.ctx.body as any;
      expect(options.options.authenticatorSelection.userVerification).toBe(
        "required",
      );
      mock.registration.mockResolvedValue({ verified: false });
      await expect(
        r.auth.passkeyFinish(
          client({ challenge: options.challenge, response: {} }).ctx,
          true,
        ),
      ).rejects.toThrow("registration");
      const again = client();
      await r.auth.passkeyOptions(again.ctx, true);
      mock.registration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "test-credential",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 1,
            transports: ["internal"],
          },
        },
      });
      const finish = client({
        challenge: (again.ctx.body as any).challenge,
        response: {},
        name: "My device",
      });
      await r.auth.passkeyFinish(finish.ctx, true);
      accept(finish);
      expect(mock.registration).toHaveBeenLastCalledWith(
        expect.objectContaining({
          expectedOrigin: r.config.publicUrl,
          expectedRPID: r.config.rpId,
          requireUserVerification: true,
        }),
      );
      const third = client();
      await r.auth.passkeyOptions(third.ctx, true);
      expect((third.ctx.body as any).options.excludeCredentials[0].id).toBe(
        "test-credential",
      );
      const optionsLogin = context();
      await r.auth.passkeyOptions(optionsLogin.ctx, false);
      mock.authentication.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 2 },
      });
      const login = context({
        challenge: (optionsLogin.ctx.body as any).challenge,
        response: { id: "test-credential" },
      });
      await r.auth.passkeyFinish(login.ctx, false);
      accept(login);
      expect((login.ctx.body as any).phase).toBe("ready");
      expect(mock.authentication).toHaveBeenCalledWith(
        expect.objectContaining({
          requireUserVerification: true,
          expectedRPID: r.config.rpId,
        }),
      );
      await expect(r.auth.passkeyFinish(login.ctx, false)).rejects.toThrow(
        "challenge",
      );
      await expect(
        r.auth.passkeyFinish(
          client({ response: "bad", challenge: "x" }).ctx,
          false,
        ),
      ).rejects.toThrow("response");
      const invalid = await r.auth.challenge(null, null, "passkey-login", {
        challenge: "x",
      });
      await expect(
        r.auth.passkeyFinish(
          context({ challenge: invalid, response: { id: "unknown" } }).ctx,
          false,
        ),
      ).rejects.toThrow("passkey");
      const denied = await r.auth.challenge(null, null, "passkey-login", {
        challenge: "x",
      });
      mock.authentication.mockResolvedValue({ verified: false });
      await expect(
        r.auth.passkeyFinish(
          context({ challenge: denied, response: { id: "test-credential" } })
            .ctx,
          false,
        ),
      ).rejects.toThrow("passkey");
    });
    it("rechecks LDAP state and rejects disabled, expired, ambiguous or untrusted directory records", async () => {
      const user = { ...(await r.auth.user(1)), isLdap: 1 };
      await expect(r.auth.directory(user)).rejects.toThrow("unavailable");
      const c = {
        ldapEnabled: "1",
        ldapServer: "ldaps://directory.example.org",
        ldapBase: "dc=example,dc=org",
        ldapBindUser: "bind",
        ldapBindPass: "synthetic",
        ldapGroup: "cn=staff,dc=example,dc=org",
      };
      await r.vault.saveConfiguration("integration/directory", c);
      mock.entries = [
        { dn: "uid=admin,dc=example,dc=org", memberOf: c.ldapGroup },
      ];
      expect(await r.auth.directory(user, "password")).toBe(true);
      expect(mock.bind).toHaveBeenLastCalledWith(
        mock.entries[0].dn,
        "password",
      );
      for (const records of [
        [],
        [{ dn: "x" }, { dn: "y" }],
        [{ dn: "x", userAccountControl: 2 }],
        [{ dn: "x", pwdAccountLockedTime: "locked" }],
        [{ dn: "x", accountExpires: 1 }],
        [{ dn: "x", memberOf: "other" }],
      ]) {
        mock.entries = records;
        expect(await r.auth.directory(user)).toBe(false);
      }
      mock.bind.mockRejectedValueOnce(new Error("network"));
      expect(await r.auth.directory(user)).toBe(false);
      await r.vault.saveConfiguration("integration/directory", {
        ...c,
        ldapServer: "ldap://directory.example.org",
        ldapTlsEnabled: "1",
        ldapAds: "1",
      });
      mock.entries = [
        {
          dn: "uid=admin",
          memberOf: [c.ldapGroup],
          accountExpires: "9223372036854775807",
        },
      ];
      expect(await r.auth.directory(user)).toBe(true);
      expect(mock.startTLS).toHaveBeenCalled();
      expect(mock.search).toHaveBeenLastCalledWith(
        c.ldapBase,
        expect.objectContaining({ filter: "(sAMAccountName=admin)" }),
      );
      await r.vault.saveConfiguration("integration/directory", {
        ...c,
        ldapServer: "ldap://directory.example.org",
        ldapTlsEnabled: "0",
      });
      await expect(r.auth.directory(user)).rejects.toThrow("TLS");
      expect(await r.auth.directory({ ...user, isLdap: 0 })).toBe(true);
      await r.vault.saveConfiguration("integration/directory", {
        ...c,
        ldapDefaultGroup: "1",
        ldapDefaultProfile: "1",
      });
      const login = context({
        login: "directory-user",
        password: "directory pass",
      });
      await r.auth.login(login.ctx);
      const created = await r
        .db("User")
        .where({ login: "directory-user" })
        .first();
      expect(created.isLdap).toBe(1);
      expect(created.isAdminApp).toBe(0);
      mock.entries = [];
      const directoryAuth = await r.auth.issue(
        context().ctx,
        await r.auth.user(created.id),
        true,
      );
      const dirSession = await r
        .db("nodepass_sessions")
        .where({ id: directoryAuth.session.id })
        .first();
      expect(dirSession).toBeDefined();
    });
    it("verifies signed SSO assertions, explicit account mapping, one-use nonce and safe provisioning", async () => {
      const auth = new Auth(
          r.db,
          { ...r.config, trustProxy: true, trustedProxies: ["127.0.0.1"] },
          r.vault,
        ),
        secret = token();
      await r.vault.saveConfiguration("integration/sso", {
        enabled: true,
        secret,
        allowedLogins: "admin",
        autoProvision: true,
        defaultGroup: 1,
        defaultProfile: 1,
      });
      const signed = (login: string, offset = 0, nonce = token()) => {
        const payload = Buffer.from(
          JSON.stringify({
            login,
            timestamp: Math.floor(Date.now() / 1000) + offset,
            nonce,
          }),
        ).toString("base64url");
        return context(
          {},
          {
            "x-nodepass-identity": payload,
            "x-nodepass-signature": createHmac("sha256", secret)
              .update(payload)
              .digest("hex"),
          },
        );
      };
      await expect(r.auth.sso(signed("admin").ctx)).rejects.toThrow("ingress");
      const c = signed("admin");
      await auth.sso(c.ctx);
      expect((c.ctx.body as any).phase).toBe("verify");
      await expect(auth.sso(c.ctx)).rejects.toThrow("already");
      await expect(auth.sso(signed("admin", -120).ctx)).rejects.toThrow(
        "Expired",
      );
      await expect(auth.sso(context().ctx)).rejects.toThrow("assertion");
      const fresh = signed("sso-user");
      await auth.sso(fresh.ctx);
      const user = await r.db("User").where({ login: "sso-user" }).first();
      expect(user.isAdminApp).toBe(0);
      expect(user.isAdminAcc).toBe(0);
      await auth.sso(signed("sso-user").ctx);
      await r.vault.saveConfiguration("integration/sso", { enabled: false });
      await expect(auth.sso(signed("admin").ctx)).rejects.toThrow("disabled");
    });
    it("checks directory sessions and passkeys again after directory membership is revoked", async () => {
      const row = await r.db("User").where({ login: "directory-user" }).first(),
        c = context(),
        id = await r.auth.issue(c.ctx, await r.auth.user(row.id), true),
        headers = { "x-csrf-token": id.session.csrf };
      mock.entries = [];
      await expect(
        r.auth.identity(context({}, headers, c.values.get("nodepass")).ctx),
      ).rejects.toThrow("Directory");
      await expect(
        r.auth.login(
          context({ login: "directory-user", password: "wrong" }).ctx,
        ),
      ).rejects.toThrow("credentials");
      await r.db("nodepass_factors").insert({
        userId: row.id,
        kind: "passkey",
        credentialId: "directory-key",
        credentialHash: digest("directory-key"),
        name: "Directory key",
        data: JSON.stringify({ publicKey: "AQID" }),
        counter: 0,
        confirmed: 1,
      });
      const challenge = await r.auth.challenge(null, null, "passkey-login", {
        challenge: "synthetic",
      });
      await expect(
        r.auth.passkeyFinish(
          context({ challenge, response: { id: "directory-key" } }).ctx,
          false,
        ),
      ).rejects.toThrow("Directory");
      const profile = await r.db("UserProfile").where({ id: 1 }).first();
      await r.db("UserProfile").where({ id: 1 }).update({
        profile: 'NPJ1:{"accView":true,"accEdit":1,"accFiles":false}',
      });
      expect(
        (
          await r.auth.viewer(
            await r.auth.issue(context().ctx, await r.auth.user(1), true),
          )
        ).permissions,
      ).toEqual({ accView: true, accEdit: true, accFiles: false });
      await r
        .db("UserProfile")
        .where({ id: 1 })
        .update({ profile: profile.profile });
      await r.vault.saveConfiguration("integration/directory", {
        ldapEnabled: "1",
        ldapServer: "directory.example.org",
        ldapBase: "dc=example",
        ldapBindUser: "bind",
        ldapBindPass: "synthetic",
      });
      mock.entries = [{ dn: "uid=directory-user" }];
      expect(await r.auth.directory(await r.auth.user(row.id))).toBe(true);
    });
    it("rejects unmapped SSO identities and incomplete automatic provisioning", async () => {
      const auth = new Auth(
          r.db,
          { ...r.config, trustProxy: true, trustedProxies: ["127.0.0.1"] },
          r.vault,
        ),
        secret = token();
      const assertion = (login: string) => {
        const payload = Buffer.from(
          JSON.stringify({
            login,
            timestamp: Math.floor(Date.now() / 1000),
            nonce: token(),
          }),
        ).toString("base64url");
        return context(
          {},
          {
            "x-nodepass-identity": payload,
            "x-nodepass-signature": createHmac("sha256", secret)
              .update(payload)
              .digest("hex"),
          },
        );
      };
      await r.vault.saveConfiguration("integration/sso", {
        enabled: true,
        secret,
      });
      await expect(auth.sso(assertion("unmapped").ctx)).rejects.toThrow(
        "mapped",
      );
      await expect(auth.sso(assertion("admin").ctx)).rejects.toThrow("mapped");
      await r.vault.saveConfiguration("integration/sso", {
        enabled: true,
        secret,
        autoProvision: true,
        defaultGroup: 99999,
        defaultProfile: 1,
      });
      await expect(
        auth.sso(assertion("provision-failure").ctx),
      ).rejects.toThrow("provisioning");
      await r.vault.saveConfiguration("integration/sso", {
        enabled: true,
        secret,
        allowedLogins: "directory-user",
      });
      mock.entries = [];
      await expect(auth.sso(assertion("directory-user").ctx)).rejects.toThrow(
        "Directory",
      );
    });
    it("rejects an invalid TOTP enrollment code and a concurrently enrolled factor", async () => {
      await r.db("nodepass_factors").where({ userId: 1 }).delete();
      await issue(true);
      const started = client();
      await r.auth.totpStart(started.ctx);
      const data = started.ctx.body as any,
        otp = new OTPAuth.TOTP({ secret: data.secret });
      let code = "000000";
      while (otp.validate({ token: code, window: 1 }) !== null)
        code = String(Number(code) + 1).padStart(6, "0");
      await expect(
        r.auth.totpFinish(client({ challenge: data.challenge, code }).ctx),
      ).rejects.toThrow("Invalid code");
      const id = await r.auth.identity(client().ctx),
        challenge = await r.auth.challenge(1, id.session.id, "totp-enroll", {
          secret: data.secret,
        });
      await r.db("nodepass_factors").insert({
        userId: 1,
        kind: "totp",
        name: "Concurrent setup",
        data: r.vault.wrap(data.secret, "totp/1").toString("base64"),
        counter: 0,
        confirmed: 1,
      });
      await expect(
        r.auth.totpFinish(client({ challenge, code: otp.generate() }).ctx),
      ).rejects.toThrow("already");
    });
    it("applies a newly mandatory factor to existing password-only sessions and revokes logout", async () => {
      await r.db("nodepass_factors").where({ userId: 1 }).delete();
      await putSetting(r.db, "security", { ...defaultPolicy, mfa: "optional" });
      await issue();
      expect((await r.auth.identity(client().ctx)).session.complete).toBe(1);
      await putSetting(r.db, "security", { ...defaultPolicy, mfa: "everyone" });
      await expect(r.auth.identity(client().ctx)).rejects.toThrow(
        "multi-factor",
      );
      await r.auth.logout(client().ctx);
      await expect(r.auth.identity(client().ctx, true)).rejects.toThrow();
    });
  },
);
