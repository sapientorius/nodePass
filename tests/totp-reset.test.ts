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
import { resolve } from "node:path";
import * as OTPAuth from "otpauth";
import { defaultPolicy } from "@nodepass/contracts";
import { harness, testPassword } from "./harness.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";
import { Auth } from "../packages/server/src/security/auth.js";
import {
  authState,
  lockAuthState,
  saveAuthState,
} from "../packages/server/src/security/auth-state.js";
import { digest } from "../packages/server/src/security/crypto.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import { resetTotp } from "../packages/server/src/services/totp-reset.js";
import { managementParams } from "../packages/server/src/services/user-management.js";
import { putSetting } from "../packages/server/src/db.js";
import { database } from "../packages/server/src/db.js";
import { isolatedDatabase } from "./database.js";
import { backup } from "../packages/server/src/migration/backup.js";
import { restore } from "../packages/server/src/migration/restore.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { loadConfig } from "../packages/server/src/config.js";
import { lockUserManagement } from "../packages/server/src/services/user-management.js";

const webauthn = vi.hoisted(() => ({
  registration: vi.fn(),
  authentication: vi.fn(),
}));
const faults = vi.hoisted(() => ({ audit: false }));
vi.mock("../packages/server/src/db.js", async (original) => {
  const actual =
    await original<typeof import("../packages/server/src/db.js")>();
  return {
    ...actual,
    audit: async (...args: Parameters<typeof actual.audit>) => {
      if (faults.audit && args[2] === "users.totp.reset")
        throw new Error("Synthetic audit failure");
      return actual.audit(...args);
    },
  };
});
vi.mock("@simplewebauthn/server", async (original) => ({
  ...(await original<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: webauthn.registration,
  verifyAuthenticationResponse: webauthn.authentication,
}));
function gate() {
  let release!: () => void;
  let reached!: () => void;
  return {
    ready: new Promise<void>((resolve) => {
      reached = resolve;
    }),
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached: () => reached(),
    release: () => release(),
  };
}

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "administrator TOTP reset",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    let http: Awaited<ReturnType<typeof createApp>>;
    let server: Awaited<ReturnType<typeof http.app.listen>>;
    let target: number, manager: number, base: string;
    async function client(userId: number, verified = true) {
      const state = { raw: "", csrf: "" };
      const ctx = (data: unknown = {}, method = "POST") =>
        ({
          method,
          request: { body: data },
          ip: "127.0.0.1",
          get: (key: string) =>
            key.toLowerCase() === "x-csrf-token" ? state.csrf : "",
          cookies: {
            get: () => state.raw,
            set: (_key: string, value: string) => {
              state.raw = value;
            },
          },
        }) as unknown as Context;
      const id = await r.auth.issue(ctx(), await r.auth.user(userId), verified);
      state.csrf = id.session.csrf;
      return {
        state,
        ctx,
        id,
        accept: (c: Context) => {
          state.csrf = (c.body as any).csrf;
        },
      };
    }
    const reset = async (id = target) =>
      resetTotp(r.db, r.auth, id, await r.params());
    const factor = async (kind: string, userId = target) => {
      const [id] = await r.db("nodepass_factors").insert({
        userId,
        kind,
        confirmed: 1,
        counter: 0,
        name: "Synthetic factor",
        data:
          kind === "totp"
            ? r.vault
                .wrap("JBSWY3DPEHPK3PXP", `totp/${userId}`)
                .toString("base64")
            : kind === "passkey"
              ? JSON.stringify({
                  publicKey: Buffer.from("synthetic key").toString("base64"),
                })
              : digest("synthetic-recovery"),
        ...(kind === "passkey"
          ? {
              credentialId: `synthetic-${userId}`,
              credentialHash: digest(`synthetic-${userId}`),
            }
          : {}),
      });
      return id!;
    };
    beforeAll(async () => {
      r = await harness();
      const root = await r.params();
      const profiles = new Catalogue(r.db, "profiles", r.auth);
      const profile = await profiles.create(
        { name: "Reader", profile: {} },
        root,
      );
      const managerProfile = await profiles.create(
        {
          name: "Manager",
          profile: { mgmUsers: true, mgmUsersResetPassword: true },
        },
        root,
      );
      const users = new Catalogue(r.db, "users", r.auth);
      target = (
        await users.create(
          {
            name: "Synthetic reader",
            login: "reader",
            password: testPassword,
            userGroupId: 1,
            userProfileId: profile.id,
          },
          root,
        )
      ).id;
      manager = (
        await users.create(
          {
            name: "Synthetic manager",
            login: "manager",
            password: testPassword,
            userGroupId: 1,
            userProfileId: managerProfile.id,
          },
          root,
        )
      ).id;
      http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await http.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing listener");
      base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await http?.close();
      await r?.dispose();
    });
    beforeEach(async () => {
      vi.restoreAllMocks();
      faults.audit = false;
      webauthn.registration.mockReset();
      webauthn.authentication.mockReset().mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      await r
        .db("User")
        .whereIn("id", [1, target, manager])
        .update({ isDisabled: 0, isAdminAcc: 0 });
      await r.db("User").where({ id: 1 }).update({ isAdminApp: 1 });
      await r
        .db("User")
        .whereIn("id", [target, manager])
        .update({ isAdminApp: 0 });
      for (const table of [
        "nodepass_factors",
        "nodepass_sessions",
        "nodepass_challenges",
        "nodepass_limits",
        "nodepass_audit",
      ])
        await r.db(table).delete();
      await r
        .db("nodepass_settings")
        .where("id", "like", "auth-state/%")
        .delete();
      await putSetting(r.db, "security", { ...defaultPolicy, mfa: "optional" });
    });
    it("removes only the target's TOTP/recovery, sessions and challenges and audits the actor", async () => {
      await factor("totp");
      await factor("recovery");
      await factor("passkey");
      await factor("recovery", manager);
      const c = await client(target);
      await r.auth.issue(c.ctx(), await r.auth.user(target));
      await r.auth.challenge(target, null, "test", {});
      await r.auth.challenge(manager, null, "test", {});
      const retained = await r
        .db("nodepass_factors")
        .where({ userId: target, kind: "passkey" })
        .first();
      const root = await r.params();
      await resetTotp(r.db, r.auth, target, root);
      expect(await r.db("nodepass_factors").where({ userId: target })).toEqual([
        retained,
      ]);
      expect(
        await r.db("nodepass_sessions").where({ userId: target }),
      ).toHaveLength(0);
      expect(
        await r.db("nodepass_challenges").where({ userId: target }),
      ).toHaveLength(0);
      expect(
        await r.db("nodepass_factors").where({ userId: manager }),
      ).toHaveLength(1);
      expect(
        await r.db("nodepass_challenges").where({ userId: manager }),
      ).toHaveLength(1);
      expect(
        await r
          .db("nodepass_sessions")
          .where({ id: root.identity!.session.id }),
      ).toHaveLength(1);
      expect(await authState(r.db, target)).toEqual({
        revision: 1,
        enrollmentRequired: false,
      });
      expect(
        await r.db("nodepass_audit").where({ action: "users.totp.reset" }),
      ).toMatchObject([{ userId: 1, target: String(target) }]);
      await expect(r.auth.identity(c.ctx())).rejects.toThrow("Session");
    });
    it.each(["optional", "admins", "everyone"] as const)(
      "requires enrollment under the %s global policy and clears it only after confirmation",
      async (mfa) => {
        await putSetting(r.db, "security", { ...defaultPolicy, mfa });
        await reset();
        const restarted = new Auth(r.db, r.config, r.vault);
        const c = await client(target, false);
        expect(await restarted.viewer(c.id)).toMatchObject({
          phase: "enroll",
          mfaMethods: [],
          mfaResetPending: true,
        });
        await expect(restarted.identity(c.ctx())).rejects.toMatchObject({
          data: { code: "MFA_REQUIRED" },
        });
        await expect(
          managementParams(r.db, r.auth, { identity: c.id }),
        ).rejects.toThrow(/Session|Authentication|multi-factor/);
        const start = c.ctx();
        await restarted.totpStart(start);
        const enrollment = start.body as any;
        expect((await authState(r.db, target)).enrollmentRequired).toBe(true);
        await expect(
          restarted.totpFinish(
            c.ctx({ challenge: enrollment.challenge, code: "broken" }),
          ),
        ).rejects.toThrow();
        expect((await authState(r.db, target)).enrollmentRequired).toBe(true);
        const retry = c.ctx();
        await restarted.totpStart(retry);
        const data = retry.body as any;
        const finish = c.ctx({
          challenge: data.challenge,
          code: new OTPAuth.TOTP({ secret: data.secret }).generate(),
        });
        await restarted.totpFinish(finish);
        c.accept(finish);
        expect(finish.body).toMatchObject({
          phase: "ready",
          mfaResetPending: false,
          mfaMethods: ["totp"],
        });
        expect(await restarted.identity(c.ctx())).toBeTruthy();
        const codes = c.ctx();
        await restarted.recovery(codes);
        expect((codes.body as any).codes).toHaveLength(10);
        expect(await authState(r.db, target)).toEqual({
          revision: 1,
          enrollmentRequired: false,
        });
      },
    );
    it("keeps passkeys usable and reports no deleted code methods", async () => {
      await factor("totp");
      await factor("recovery");
      await factor("passkey");
      await reset();
      const c = await client(target, false);
      expect(await r.auth.viewer(c.id)).toMatchObject({
        phase: "verify",
        mfaMethods: ["passkey"],
        mfaResetPending: false,
      });
      const challenge = await r.auth.challenge(null, null, "passkey-login", {
        challenge: "synthetic",
      });
      const finish = c.ctx({
        challenge,
        response: { id: `synthetic-${target}` },
      });
      await r.auth.passkeyFinish(finish, false);
      c.accept(finish);
      expect(finish.body).toMatchObject({ phase: "ready" });
      expect(await r.auth.identity(c.ctx())).toBeTruthy();
    });
    it("clears reset enrollment only after confirming a new passkey", async () => {
      await reset();
      const c = await client(target, false),
        options = c.ctx();
      await r.auth.passkeyOptions(options, true);
      webauthn.registration.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "replacement-key",
            publicKey: new Uint8Array([1, 2]),
            counter: 0,
          },
        },
      });
      const finish = c.ctx({
        challenge: (options.body as any).challenge,
        response: {},
      });
      await r.auth.passkeyFinish(finish, true);
      c.accept(finish);
      expect(finish.body).toMatchObject({
        phase: "ready",
        mfaResetPending: false,
        mfaMethods: ["passkey"],
      });
      expect(await r.auth.identity(c.ctx())).toBeTruthy();
      expect(await authState(r.db, target)).toEqual({
        revision: 1,
        enrollmentRequired: false,
      });
    });
    it("rejects old codes and invalidates a replacement enrollment on repeated reset", async () => {
      await factor("totp");
      await factor("recovery");
      const old = await client(target, false);
      await reset();
      await expect(
        r.auth.totpVerify(old.ctx({ code: "synthetic-recovery" })),
      ).rejects.toThrow("Session");
      const c = await client(target, false);
      await expect(
        r.auth.totpVerify(c.ctx({ code: "synthetic-recovery" })),
      ).rejects.toThrow("Invalid code");
      await expect(
        r.auth.totpVerify(
          c.ctx({
            code: new OTPAuth.TOTP({ secret: "JBSWY3DPEHPK3PXP" }).generate(),
          }),
        ),
      ).rejects.toThrow("Invalid code");
      const start = c.ctx();
      await r.auth.totpStart(start);
      await reset();
      const data = start.body as any;
      await expect(
        r.auth.totpFinish(
          c.ctx({
            challenge: data.challenge,
            code: new OTPAuth.TOTP({ secret: data.secret }).generate(),
          }),
        ),
      ).rejects.toThrow("Session");
      expect(await authState(r.db, target)).toEqual({
        revision: 2,
        enrollmentRequired: true,
      });
    });
    it("cannot regenerate recovery factors from a session read before reset", async () => {
      await factor("totp");
      const c = await client(target),
        paused = gate();
      const identity = r.auth.identity.bind(r.auth);
      vi.spyOn(r.auth, "identity").mockImplementationOnce(async (...args) => {
        const current = await identity(...args);
        paused.reached();
        await paused.wait;
        return current;
      });
      const pending = r.auth.recovery(c.ctx());
      const denied = expect(pending).rejects.toThrow("Session");
      await paused.ready;
      await reset();
      paused.release();
      await denied;
      expect(
        await r.db("nodepass_factors").where({ userId: target }),
      ).toHaveLength(0);
    });
    it("preserves reset state and enrollment gating through an actual backup and restore", async () => {
      await reset();
      const directory = resolve(r.config.dataDir, "reset-backups");
      const name = await backup(r.db, directory, r.config.deploymentKey, {
        legacy: r.config.legacy,
      });
      const isolated = await isolatedDatabase(loadConfig());
      const db = database(isolated.config);
      const vault = new Vault(db, r.config.deploymentKey);
      try {
        await restore(
          db,
          resolve(directory, name),
          r.config.deploymentKey,
          r.config.deploymentKey,
          resolve(directory, "restore"),
        );
        await vault.load();
        expect(await authState(db, target)).toEqual({
          revision: 1,
          enrollmentRequired: true,
        });
        const restoredAuth = new Auth(db, r.config, vault);
        const c = await client(manager);
        const id = await restoredAuth.issue(
          c.ctx(),
          await restoredAuth.user(target),
        );
        expect(await restoredAuth.viewer(id)).toMatchObject({
          phase: "enroll",
          mfaResetPending: true,
        });
      } finally {
        vault.destroy();
        await db.destroy();
        await isolated.drop();
      }
    });
    it("rechecks a queued actor's role after the management lock is released", async () => {
      const params = await r.params();
      let denied!: Promise<void>;
      await r.db.transaction(async (trx) => {
        await lockUserManagement(trx);
        await trx("User").where({ id: 1 }).update({ isAdminApp: 0 });
        denied = expect(resetTotp(r.db, r.auth, target, params)).rejects.toThrow(
          "Application administrator required",
        );
      });
      await denied;
      expect((await authState(r.db, target)).revision).toBe(0);
    });
    it("permits resetting another admin and a disabled user without enabling them", async () => {
      await r
        .db("User")
        .where({ id: target })
        .update({ isAdminApp: 1, isDisabled: 1 });
      await reset();
      expect(
        (await r.db("User").where({ id: target }).first()).isDisabled,
      ).toBe(1);
      await expect(r.auth.user(target)).rejects.toThrow();
      await r.db("User").where({ id: target }).update({ isDisabled: 0 });
      await reset();
      expect((await authState(r.db, target)).revision).toBe(2);
    });
    it.each([
      "manager",
      "account-admin",
      "self",
      "missing",
      "revoked",
      "incomplete",
      "idle",
      "absolute",
      "disabled",
      "mfa",
      "old",
    ])("rejects %s without resetting anything", async (kind) => {
      await factor("totp");
      const actorId =
        kind === "manager" || kind === "account-admin" ? manager : 1;
      if (kind === "account-admin")
        await r.db("User").where({ id: manager }).update({ isAdminAcc: 1 });
      const p = await r.params(actorId);
      const sessionId = p.identity!.session.id;
      if (kind === "revoked")
        await r.db("nodepass_sessions").where({ id: sessionId }).delete();
      const changes: Record<string, object> = {
        incomplete: { complete: 0 },
        idle: { lastSeen: 1 },
        absolute: { createdAt: 1 },
        mfa: { verifiedAt: 0 },
        old: { verifiedAt: Date.now() - 301000 },
      };
      if (changes[kind])
        await r
          .db("nodepass_sessions")
          .where({ id: sessionId })
          .update(changes[kind]);
      if (kind === "mfa") await putSetting(r.db, "security", defaultPolicy);
      if (kind === "disabled")
        await r.db("User").where({ id: actorId }).update({ isDisabled: 1 });
      await expect(
        resetTotp(
          r.db,
          r.auth,
          kind === "self" ? actorId : kind === "missing" ? 999999 : target,
          p,
        ),
      ).rejects.toThrow();
      expect(
        await r.db("nodepass_factors").where({ userId: target }),
      ).toHaveLength(1);
      expect(await authState(r.db, target)).toEqual({
        revision: 0,
        enrollmentRequired: false,
      });
      expect(
        await r.db("nodepass_audit").where({ action: "users.totp.reset" }),
      ).toHaveLength(0);
    });
    it("rolls back state, factors, sessions and challenges when auditing fails", async () => {
      await factor("totp");
      const c = await client(target);
      await r.auth.challenge(target, c.id.session.id, "test", {});
      faults.audit = true;
      try {
        await expect(reset()).rejects.toThrow("Synthetic audit failure");
      } finally {
        faults.audit = false;
      }
      expect(await authState(r.db, target)).toEqual({
        revision: 0,
        enrollmentRequired: false,
      });
      expect(
        await r.db("nodepass_factors").where({ userId: target }),
      ).toHaveLength(1);
      expect(
        await r.db("nodepass_challenges").where({ userId: target }),
      ).toHaveLength(1);
      expect(await r.auth.identity(c.ctx())).toBeTruthy();
    });
    it("rejects a password login paused before session issuance across a reset", async () => {
      const c = await client(manager);
      const issue = r.auth.issue.bind(r.auth);
      const loginGate = gate();
      vi.spyOn(r.auth, "issue").mockImplementation(async (...args) => {
        loginGate.reached();
        await loginGate.wait;
        return issue(...args);
      });
      const pending = r.auth.login(
        c.ctx({ login: "reader", password: testPassword }),
      );
      const denied = expect(pending).rejects.toThrow("Authentication changed");
      await loginGate.ready;
      await reset();
      loginGate.release();
      await denied;
      expect(
        await r.db("nodepass_sessions").where({ userId: target }),
      ).toHaveLength(0);
    });
    it("rejects a consumed TOTP enrollment challenge if reset wins before the write", async () => {
      const c = await client(target, false);
      const start = c.ctx();
      await r.auth.totpStart(start);
      const data = start.body as any,
        paused = gate(),
        consume = r.auth.consume.bind(r.auth);
      vi.spyOn(r.auth, "consume").mockImplementation(async (...args) => {
        const result = await consume(...args);
        paused.reached();
        await paused.wait;
        return result;
      });
      const pending = r.auth.totpFinish(
        c.ctx({
          challenge: data.challenge,
          code: new OTPAuth.TOTP({ secret: data.secret }).generate(),
        }),
      );
      const denied = expect(pending).rejects.toThrow("Session");
      await paused.ready;
      await reset();
      paused.release();
      await denied;
      expect(
        await r.db("nodepass_factors").where({ userId: target }),
      ).toHaveLength(0);
      expect((await authState(r.db, target)).enrollmentRequired).toBe(true);
    });
    it("rejects passkey registration verified concurrently with a reset", async () => {
      const c = await client(target, false),
        options = c.ctx();
      await r.auth.passkeyOptions(options, true);
      const paused = gate();
      webauthn.registration.mockImplementation(async () => {
        paused.reached();
        await paused.wait;
        return {
          verified: true,
          registrationInfo: {
            credential: {
              id: "new-key",
              publicKey: new Uint8Array([1]),
              counter: 0,
            },
          },
        };
      });
      const pending = r.auth.passkeyFinish(
        c.ctx({ challenge: (options.body as any).challenge, response: {} }),
        true,
      );
      const denied = expect(pending).rejects.toThrow("Session");
      await paused.ready;
      await reset();
      paused.release();
      await denied;
      expect(
        await r.db("nodepass_factors").where({ userId: target }),
      ).toHaveLength(0);
    });
    it.each(["totp", "recovery", "passkey"])(
      "serializes a completed %s proof with reset and revokes its resulting session",
      async (kind) => {
        await factor(kind);
        const c = await client(target, false),
          paused = gate();
        const issue = Auth.prototype.issue;
        vi.spyOn(Auth.prototype, "issue").mockImplementation(async function (
          this: Auth,
          ...args
        ) {
          if (args[1].id === target && args[2]) {
            paused.reached();
            await paused.wait;
          }
          return issue.apply(this, args);
        });
        const data =
          kind === "totp"
            ? {
                code: new OTPAuth.TOTP({
                  secret: "JBSWY3DPEHPK3PXP",
                }).generate(),
              }
            : kind === "recovery"
              ? { code: "synthetic-recovery" }
              : {
                  challenge: await r.auth.challenge(
                    null,
                    null,
                    "passkey-login",
                    { challenge: "synthetic" },
                  ),
                  response: { id: `synthetic-${target}` },
                };
        const pending =
          kind === "passkey"
            ? r.auth.passkeyFinish(c.ctx(data), false)
            : r.auth.totpVerify(c.ctx(data));
        await paused.ready;
        const resetting = reset();
        paused.release();
        await Promise.all([pending, resetting]);
        expect(
          await r.db("nodepass_sessions").where({ userId: target }),
        ).toHaveLength(0);
        expect(
          await r
            .db("nodepass_factors")
            .where({ userId: target })
            .whereIn("kind", ["totp", "recovery"]),
        ).toHaveLength(0);
      },
    );
    it("rejects stale authentication revisions and malformed stored states", async () => {
      await reset();
      const c = await client(manager);
      await expect(
        r.auth.issue(c.ctx(), await r.auth.user(target), true, 0),
      ).rejects.toThrow("Authentication changed");
      for (const state of [
        null,
        { revision: -1, enrollmentRequired: false },
        { revision: 0, enrollmentRequired: "false" },
      ]) {
        await putSetting(r.db, `auth-state/${target}`, state);
        await expect(authState(r.db, target)).rejects.toThrow(
          "Invalid authentication state",
        );
      }
      await r.db.transaction(async (trx) => {
        await putSetting(trx, `auth-state/${target}`, {
          revision: Number.MAX_SAFE_INTEGER,
          enrollmentRequired: false,
        });
      });
      await expect(reset()).rejects.toThrow("revision exhausted");
    });
    it("protects the last factor while a reset enrollment requirement remains", async () => {
      await reset();
      const id = await factor("passkey");
      const c = await client(target);
      await expect(r.auth.removeFactor(c.ctx(), id)).rejects.toThrow(
        "replacement",
      );
      const key = await r.auth.challenge(target, null, "test", {});
      expect(key).toBeTruthy();
      await expect(
        r.auth.challenge(target, "missing-session", "test", {}),
      ).rejects.toThrow("Session");
      await r.db.transaction(async (trx) => {
        const state = await lockAuthState(trx, target);
        await saveAuthState(trx, target, {
          ...state,
          enrollmentRequired: false,
        });
      });
      await r.auth.removeFactor(c.ctx(), id);
      expect(
        await r.db("nodepass_sessions").where({ userId: target }),
      ).toHaveLength(0);
    });
    it("enforces HTTP origin, CSRF, body, target, role and recent confirmation", async () => {
      const c = await client(1);
      async function request(
        id: string,
        headers: Record<string, string> = {},
        data: unknown = {},
      ) {
        return fetch(`${base}/api/v1/users/${id}/totp-reset`, {
          method: "POST",
          headers: {
            origin: r.config.publicUrl,
            "content-type": "application/json",
            cookie: `nodepass=${c.state.raw}`,
            "x-csrf-token": c.state.csrf,
            ...headers,
          },
          body: JSON.stringify(data),
        });
      }
      expect(
        (await request(String(target), { origin: "https://foreign.example" }))
          .status,
      ).toBe(403);
      expect(
        (await request(String(target), { "x-csrf-token": "wrong" })).status,
      ).toBe(403);
      expect((await request(String(target), {}, { force: true })).status).toBe(
        400,
      );
      expect((await request("not-an-id")).status).toBe(400);
      await r
        .db("nodepass_sessions")
        .where({ id: c.id.session.id })
        .update({ verifiedAt: Date.now() - 301000 });
      expect(await (await request(String(target))).json()).toMatchObject({
        code: "REAUTHENTICATION_REQUIRED",
      });
      const confirmation = c.ctx({ password: testPassword });
      await r.auth.confirm(confirmation);
      expect((await request(String(target))).status).toBe(204);
      expect((await request(String(target))).status).toBe(204);
      expect((await authState(r.db, target)).revision).toBe(2);
      const listing = await fetch(`${base}/api/v1/users`, {
        headers: { cookie: `nodepass=${c.state.raw}` },
      });
      expect(
        (await listing.json()).find((user: any) => user.id === target)
          .management.canResetTotp,
      ).toBe(true);
      await r.db("User").where({ id: 1 }).update({ isAdminApp: 0 });
      expect((await request(String(target))).status).toBe(403);
    });
  },
);
