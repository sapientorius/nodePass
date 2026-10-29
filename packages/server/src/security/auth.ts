import type { Context } from "koa";
import {
  BadRequest,
  Forbidden,
  NotAuthenticated,
  TooManyRequests,
} from "@feathersjs/errors";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { proxyMatcher, proxyPeerMatcher } from "./proxy.js";
import { matchingPresets } from "../compat/presets.js";
import { sessionRange } from "../compat/preset-validation.js";
import { Client } from "ldapts";
import {
  defaultPolicy,
  languages,
  type SecurityPolicy,
  type Viewer,
  type ConfirmationMethods,
} from "@nodepass/contracts";
import { audit, getSetting, type Database, type Row } from "../db.js";
import type { Config } from "../config.js";
import { mapData } from "../compat/data.js";
export { mapData } from "../compat/data.js";
import { digest, equal, token } from "./crypto.js";
import { hashPassword, verifyPassword } from "./password.js";
import { isAdmin, type Principal } from "./policy.js";
import type { Vault } from "./vault.js";
let dummyHash: Promise<string> | undefined;

export interface User extends Principal {
  name: string;
  login: string;
  email?: string;
  isLdap: number;
  language: Viewer["language"];
  theme?: Viewer["theme"];
  view?: Viewer["view"];
}
export interface Session {
  id: string;
  userId: number;
  csrf: string;
  complete: number;
  verifiedAt: number;
  createdAt: number;
  lastSeen: number;
}
export interface RequestIdentity {
  user: User;
  session: Session;
}
export function body(ctx: Context): Row {
  const b = (ctx.request as typeof ctx.request & { body?: unknown }).body;
  if (!b || typeof b !== "object" || Array.isArray(b))
    throw new BadRequest("Expected an object");
  return b as Row;
}
export function text(data: Row, key: string, max = 512): string {
  const value = data[key];
  if (typeof value !== "string" || !value || value.length > max)
    throw new BadRequest(`Invalid ${key}`);
  return value;
}
export function exact(data: Row, keys: string[]): void {
  if (Object.keys(data).some((k) => !keys.includes(k)))
    throw new BadRequest("Unknown input field");
}
export class Auth {
  private readonly trustedPeer: ReturnType<typeof proxyPeerMatcher>;
  constructor(
    readonly db: Database,
    readonly config: Config,
    readonly vault: Vault,
  ) {
    this.trustedPeer = proxyPeerMatcher(config.trustedProxies);
  }
  async policy(): Promise<SecurityPolicy> {
    return getSetting(this.db, "security", defaultPolicy);
  }
  async user(id: number): Promise<User> {
    const row = await this.db("User").where({ id }).first();
    if (!row || row.isDisabled)
      throw new NotAuthenticated("Authentication required");
    const profile = await this.db("UserProfile")
      .where({ id: row.userProfileId })
      .first();
    const preferences = mapData(row.preferences);
    const groups = await this.db("UserToUserGroup")
      .where({ userId: id })
      .select("userGroupId");
    return {
      id: row.id,
      name: row.name,
      login: row.login,
      email: row.email,
      isAdminApp: row.isAdminApp,
      isAdminAcc: row.isAdminAcc,
      isDisabled: row.isDisabled,
      userGroupId: row.userGroupId,
      isLdap: row.isLdap,
      groups: groups.map((g) => g.userGroupId),
      profile: mapData(profile?.profile),
      language: languages.includes(preferences.lang as Viewer["language"])
        ? (preferences.lang as Viewer["language"])
        : "de_DE",
      ...(preferences.theme === "light" || preferences.theme === "dark"
        ? { theme: preferences.theme }
        : {}),
      ...(preferences.view === "list" || preferences.view === "cards"
        ? { view: preferences.view }
        : {}),
    };
  }
  async directory(user: User, password?: string): Promise<boolean> {
    if (!user.isLdap) return true;
    const legacy = await this.vault.configuration<Record<string, string>>(
      "legacy-config",
      this.config.legacy as Record<string, string>,
    );
    const l = await this.vault.configuration<Record<string, string>>(
      "integration/directory",
      legacy,
    );
    if (
      l.ldapEnabled !== "1" ||
      !l.ldapServer ||
      !l.ldapBase ||
      !l.ldapBindUser ||
      !l.ldapBindPass
    )
      throw new NotAuthenticated("Directory unavailable");
    const url = new URL(
      l.ldapServer.includes("://") ? l.ldapServer : `ldaps://${l.ldapServer}`,
    );
    if (url.protocol !== "ldaps:" && l.ldapTlsEnabled !== "1")
      throw new NotAuthenticated("Directory TLS required");
    const client = new Client({
      url: url.toString(),
      timeout: 5000,
      connectTimeout: 5000,
      tlsOptions: { rejectUnauthorized: true },
    });
    const escaped = user.login.replace(
      /[\\*()\0]/g,
      (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
    try {
      if (url.protocol !== "ldaps:")
        await client.startTLS({ rejectUnauthorized: true });
      await client.bind(l.ldapBindUser, l.ldapBindPass);
      const attribute = l.ldapAds === "1" ? "sAMAccountName" : "uid";
      const result = await client.search(l.ldapBase, {
        scope: "sub",
        filter: `(${attribute}=${escaped})`,
        attributes: [
          "dn",
          "userAccountControl",
          "memberOf",
          "pwdAccountLockedTime",
          "accountExpires",
        ],
        sizeLimit: 2,
      });
      const record =
        result.searchEntries.length === 1 ? result.searchEntries[0] : undefined;
      if (
        !record ||
        Number(record.userAccountControl ?? 0) & 2 ||
        record.pwdAccountLockedTime
      )
        return false;
      const expires = Number(record.accountExpires ?? 0);
      if (
        expires > 0 &&
        expires < 9e18 &&
        expires / 10000 - 11644473600000 < Date.now()
      )
        return false;
      if (l.ldapGroup) {
        const memberships = Array.isArray(record.memberOf)
          ? record.memberOf
          : [record.memberOf];
        if (
          !memberships.some(
            (g) => String(g).toLowerCase() === l.ldapGroup!.toLowerCase(),
          )
        )
          return false;
      }
      if (password !== undefined) await client.bind(record.dn, password);
      return true;
    } catch {
      return false;
    } finally {
      await client.unbind().catch(() => {});
    }
  }
  async limit(
    scope: string,
    source: string,
    max = 10,
    period = 900000,
  ): Promise<void> {
    const id = digest(`${scope}/${source}`),
      now = Date.now();
    const blocked = await this.db.transaction(async (trx) => {
      await trx("nodepass_limits")
        .insert({ id, attempts: 0, resetAt: now + period })
        .onConflict("id")
        .ignore();
      const row = await trx("nodepass_limits")
        .where({ id })
        .forUpdate()
        .first();
      const attempts = Number(row.resetAt) < now ? 1 : Number(row.attempts) + 1;
      await trx("nodepass_limits")
        .where({ id })
        .update({
          attempts,
          resetAt: Number(row.resetAt) < now ? now + period : row.resetAt,
        });
      return attempts > max;
    });
    if (blocked) throw new TooManyRequests("Try again later");
  }
  async identity(ctx: Context, allowPending = false): Promise<RequestIdentity> {
    const value = ctx.cookies.get("nodepass");
    if (!value || value.length > 100)
      throw new NotAuthenticated("Authentication required");
    const session = (await this.db("nodepass_sessions")
      .where({ id: digest(value) })
      .first()) as Session | undefined;
    const policy = await this.policy(),
      now = Date.now();
    if (
      !session ||
      now - Number(session.lastSeen) > policy.sessionIdleSeconds * 1000 ||
      now - Number(session.createdAt) > policy.sessionAbsoluteSeconds * 1000
    )
      throw new NotAuthenticated("Session expired");
    const user = await this.user(session.userId);
    const timeout = (await matchingPresets(this.db, user)).find(
      (p) => p.type === "session.timeout",
    );
    if (
      timeout &&
      proxyMatcher([sessionRange(timeout.data)])(ctx.ip) &&
      Date.now() - Number(session.lastSeen) >
        Math.min(policy.sessionIdleSeconds, Number(timeout.data.timeout)) * 1000
    )
      throw new NotAuthenticated("Session expired");
    if (user.isLdap && !(await this.directory(user)))
      throw new NotAuthenticated("Directory access denied");
    const factors = await this.db("nodepass_factors")
      .where({ userId: user.id, confirmed: 1 })
      .count({ n: "id" })
      .first();
    const required =
      policy.mfa === "everyone" ||
      (policy.mfa === "admins" && isAdmin(user)) ||
      Number(factors?.n) > 0;
    if (required && Number(session.verifiedAt) === 0) {
      session.complete = 0;
      await this.db("nodepass_sessions")
        .where({ id: session.id })
        .update({ complete: 0 });
    }
    if (!allowPending && !session.complete)
      throw new Forbidden("Complete multi-factor authentication", {
        code: "MFA_REQUIRED",
      });
    if (now - Number(session.lastSeen) > 30000)
      await this.db("nodepass_sessions")
        .where({ id: session.id })
        .update({ lastSeen: now });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(ctx.method) &&
      !equal(ctx.get("x-csrf-token"), session.csrf)
    )
      throw new Forbidden("Invalid CSRF token");
    return { user, session };
  }
  async viewer(identity: RequestIdentity): Promise<Viewer & { phase: string }> {
    const { user, session } = identity;
    const permissions = Object.fromEntries(
      Object.entries(user.profile).map(([key, value]) => [
        key,
        value === true || value === 1,
      ]),
    );
    const factors = await this.db("nodepass_factors")
      .where({ userId: user.id, confirmed: 1 })
      .select("id");
    return {
      // A UI invalidation hint only; authorization always uses current DB state.
      accessRevision: createHash("sha256")
        .update(
          JSON.stringify([
            user.id,
            user.userGroupId,
            [...new Set(user.groups)].sort((a, b) => a - b),
            !!user.isAdminApp,
            !!user.isAdminAcc,
            !!user.isLdap,
            Object.keys(permissions)
              .filter((key) => permissions[key])
              .sort(),
          ]),
        )
        .digest("hex"),
      id: user.id,
      name: user.name,
      login: user.login,
      isAdmin: isAdmin(user),
      isAppAdmin: user.isAdminApp === 1,
      isAccountAdmin: user.isAdminAcc === 1,
      directory: !!user.isLdap,
      ...(user.theme ? { theme: user.theme } : {}),
      ...(user.view ? { view: user.view } : {}),
      language: user.language,
      needsMfa: !session.complete,
      phase: session.complete ? "ready" : factors.length ? "verify" : "enroll",
      csrf: session.csrf,
      permissions,
    };
  }
  async issue(
    ctx: Context,
    user: User,
    verified = false,
  ): Promise<RequestIdentity> {
    const policy = await this.policy();
    const factors = await this.db("nodepass_factors")
      .where({ userId: user.id, confirmed: 1 })
      .select("id");
    const required =
      policy.mfa === "everyone" ||
      (policy.mfa === "admins" && isAdmin(user)) ||
      factors.length > 0;
    const raw = token(),
      now = Date.now();
    const session: Session = {
      id: digest(raw),
      userId: user.id,
      csrf: token(),
      complete: verified || !required ? 1 : 0,
      verifiedAt: verified ? now : 0,
      createdAt: now,
      lastSeen: now,
    };
    const old = ctx.cookies.get("nodepass");
    if (old)
      await this.db("nodepass_sessions")
        .where({ id: digest(old) })
        .delete();
    await this.db("nodepass_sessions").insert(session);
    ctx.cookies.set("nodepass", raw, {
      httpOnly: true,
      secure: this.config.publicUrl.startsWith("https:"),
      sameSite: "strict",
      overwrite: true,
      path: "/",
      maxAge: policy.sessionAbsoluteSeconds * 1000,
    });
    await audit(this.db, user.id, "auth.login");
    return { user, session };
  }
  async login(ctx: Context): Promise<void> {
    const data = body(ctx);
    exact(data, ["login", "password"]);
    const login = text(data, "login", 100),
      password = text(data, "password", 4096);
    await this.limit("login/ip", ctx.ip, 40);
    await this.limit("login/user", login.toLowerCase());
    const rows = await this.db("User").where({ login }).limit(2);
    let row = rows.length === 1 ? rows[0] : undefined;
    if (!row && /^[\p{L}\p{N}_.@-]{1,50}$/u.test(login)) {
      const legacy = await this.vault.configuration<Row>(
        "legacy-config",
        this.config.legacy,
      );
      const directory = await this.vault.configuration<Row>(
        "integration/directory",
        legacy,
      );
      if (
        directory.ldapEnabled === "1" &&
        (await this.directory({ id: 0, login, isLdap: 1 } as User, password))
      ) {
        row = await this.provision(
          login,
          Number(directory.ldapDefaultGroup),
          Number(directory.ldapDefaultProfile),
          true,
        );
      }
    }
    const valid =
      row && !row.isDisabled && !row.isLdap
        ? await verifyPassword(password, Buffer.from(row.pass).toString())
        : false;
    if (!row || row.isDisabled || (!row.isLdap && !valid)) {
      if (!row || row.isDisabled) {
        dummyHash ??= hashPassword(token());
        await verifyPassword(password, await dummyHash);
      }
      await audit(this.db, null, "auth.failed");
      throw new NotAuthenticated("Invalid credentials");
    }
    const user = await this.user(row.id);
    if (user.isLdap && !(await this.directory(user, password)))
      throw new NotAuthenticated("Invalid credentials");
    if (
      !user.isLdap &&
      !Buffer.from(row.pass).toString().startsWith("$argon2id$")
    )
      await this.db("User")
        .where({ id: user.id })
        .update({ pass: await hashPassword(password) });
    ctx.body = await this.viewer(await this.issue(ctx, user));
  }
  private async provision(
    login: string,
    groupId: number,
    profileId: number,
    directory = false,
  ): Promise<Row> {
    if (
      !Number.isInteger(groupId) ||
      !Number.isInteger(profileId) ||
      !(await this.db("UserGroup").where({ id: groupId }).first()) ||
      !(await this.db("UserProfile").where({ id: profileId }).first())
    )
      throw new NotAuthenticated("Identity provisioning is not configured");
    const pass = await hashPassword(token());
    return this.db.transaction(async (trx) => {
      const existing = await trx("User").where({ login }).first();
      if (existing) throw new NotAuthenticated("Identity already exists");
      const [id] = await trx("User").insert({
        name: login,
        login,
        userGroupId: groupId,
        userProfileId: profileId,
        pass,
        hashSalt: randomBytes(32),
        isLdap: Number(directory),
        isAdminApp: 0,
        isAdminAcc: 0,
        isDisabled: 0,
      });
      await audit(trx, id!, "auth.provision");
      return trx("User").where({ id }).first();
    });
  }
  async sso(ctx: Context): Promise<void> {
    if (
      !this.config.trustProxy ||
      !(await this.trustedPeer(ctx.req.socket.remoteAddress))
    )
      throw new NotAuthenticated("Trusted ingress required");
    await this.limit("sso/ip", ctx.ip, 40);
    const config = await this.vault.configuration<Row>("integration/sso", {});
    if (config.enabled !== true || typeof config.secret !== "string")
      throw new NotAuthenticated("SSO is disabled");
    const payload = ctx.get("x-nodepass-identity"),
      signature = ctx.get("x-nodepass-signature");
    if (
      !/^[\w-]{10,2048}$/.test(payload) ||
      !equal(
        signature,
        createHmac("sha256", config.secret).update(payload).digest("hex"),
      )
    )
      throw new NotAuthenticated("Invalid SSO assertion");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    exact(claims, ["login", "timestamp", "nonce"]);
    const login = text(claims, "login", 50),
      nonce = text(claims, "nonce", 100);
    if (
      !/^[\p{L}\p{N}_.@-]{1,50}$/u.test(login) ||
      !Number.isInteger(claims.timestamp) ||
      Math.abs(Date.now() / 1000 - claims.timestamp) > 60 ||
      !/^[-\w]{22,100}$/.test(nonce)
    )
      throw new NotAuthenticated("Expired or invalid SSO assertion");
    try {
      await this.db("nodepass_limits").insert({
        id: digest(`sso/nonce/${nonce}`),
        attempts: 1,
        resetAt: Date.now() + 120000,
      });
    } catch {
      throw new NotAuthenticated("SSO assertion already used");
    }
    let row = await this.db("User").where({ login }).first();
    if (!row && config.autoProvision === true) {
      row = await this.provision(
        login,
        Number(config.defaultGroup),
        Number(config.defaultProfile),
      );
      await this.db("nodepass_settings").insert({
        id: `sso-user/${row.id}`,
        value: "true",
      });
    }
    const allowed = String(config.allowedLogins ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .includes(login);
    if (
      !row ||
      row.isDisabled ||
      (!allowed && !(await getSetting(this.db, `sso-user/${row.id}`, false)))
    )
      throw new NotAuthenticated("SSO identity is not mapped");
    const user = await this.user(row.id);
    if (user.isLdap && !(await this.directory(user)))
      throw new NotAuthenticated("Directory access denied");
    // An upstream assertion is never considered a nodePass second factor.
    ctx.body = await this.viewer(await this.issue(ctx, user));
  }
  async challenge(
    userId: number | null,
    sessionId: string | null,
    kind: string,
    value: unknown,
  ): Promise<string> {
    const raw = token(),
      id = digest(raw);
    await this.db("nodepass_challenges").insert({
      id,
      userId,
      sessionId,
      kind,
      value: this.vault
        .wrap(JSON.stringify(value), `challenge/${kind}/${id}`)
        .toString("base64"),
      expiresAt: Date.now() + 120000,
    });
    return raw;
  }
  async consume(
    raw: string,
    kind: string,
    userId?: number,
    sessionId?: string,
  ): Promise<Row> {
    return this.db.transaction(async (trx) => {
      const row = await trx("nodepass_challenges")
        .where({ id: digest(raw), kind })
        .forUpdate()
        .first();
      if (
        !row ||
        Number(row.expiresAt) < Date.now() ||
        (userId !== undefined && row.userId !== userId) ||
        (sessionId !== undefined && row.sessionId !== sessionId)
      )
        throw new NotAuthenticated("Invalid or expired challenge");
      await trx("nodepass_challenges").where({ id: row.id }).delete();
      return {
        userId: row.userId,
        ...JSON.parse(
          this.vault
            .unwrap(
              Buffer.from(row.value, "base64"),
              `challenge/${kind}/${row.id}`,
            )
            .toString(),
        ),
      };
    });
  }
  requireRecent(identity: RequestIdentity): void {
    if (
      !identity.session.complete ||
      Date.now() -
        Number(identity.session.verifiedAt || identity.session.createdAt) >
        300000
    )
      throw new Forbidden("Confirm your identity again", {
        code: "REAUTHENTICATION_REQUIRED",
      });
  }
  async confirmationMethods(ctx: Context): Promise<void> {
    const id = await this.identity(ctx);
    const factors = await this.db("nodepass_factors")
      .where({ userId: id.user.id, confirmed: 1 })
      .select("kind");
    ctx.body = {
      methods: factors.length
        ? (["passkey", "totp", "recovery"] as const).filter((kind) =>
            factors.some((factor) => factor.kind === kind),
          )
        : ["password"],
    } satisfies ConfirmationMethods;
  }
  async confirmationOptions(ctx: Context): Promise<void> {
    const id = await this.identity(ctx);
    exact(body(ctx), []);
    await this.limit("passkey/ip", ctx.ip, 40);
    const factors = await this.db("nodepass_factors").where({
      userId: id.user.id,
      kind: "passkey",
      confirmed: 1,
    });
    if (!factors.length) throw this.invalidConfirmation();
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: "required",
      allowCredentials: factors.map((factor) => ({ id: factor.credentialId })),
    });
    ctx.body = {
      options,
      challenge: await this.challenge(
        id.user.id,
        id.session.id,
        "passkey-confirm",
        { challenge: options.challenge },
      ),
    };
  }
  private invalidConfirmation(): Forbidden {
    return new Forbidden("Identity confirmation failed", {
      code: "CONFIRMATION_INVALID",
    });
  }
  async confirm(ctx: Context): Promise<void> {
    const id = await this.identity(ctx),
      data = body(ctx);
    await this.limit("confirm", String(id.user.id));
    if ("password" in data) {
      exact(data, ["password"]);
      const password = text(data, "password", 4096);
      const factors = await this.db("nodepass_factors")
        .where({ userId: id.user.id, confirmed: 1 })
        .first();
      if (factors) throw this.invalidConfirmation();
      const row = await this.db("User").where({ id: id.user.id }).first();
      const valid = id.user.isLdap
        ? await this.directory(id.user, password)
        : await verifyPassword(password, Buffer.from(row.pass).toString());
      if (!valid) throw this.invalidConfirmation();
    } else if ("code" in data) {
      exact(data, ["code"]);
      await this.limit("totp", String(id.user.id), 5, 300000);
      if (!(await this.verifyCode(id.user.id, text(data, "code", 100))))
        throw this.invalidConfirmation();
    } else {
      exact(data, ["challenge", "response"]);
      const response = data.response;
      if (!response || typeof response !== "object" || Array.isArray(response))
        throw new BadRequest("Invalid response");
      const challenge = text(data, "challenge");
      const credentialId = text(response as Row, "id", 1024);
      const pending = await this.consume(
        challenge,
        "passkey-confirm",
        id.user.id,
        id.session.id,
      ).catch((error: unknown) => {
        if (error instanceof NotAuthenticated) throw this.invalidConfirmation();
        throw error;
      });
      const factor = await this.db("nodepass_factors")
        .where({
          userId: id.user.id,
          kind: "passkey",
          confirmed: 1,
          credentialHash: digest(credentialId),
        })
        .first();
      if (
        !factor ||
        !(await this.verifyPasskey(
          factor,
          response as AuthenticationResponseJSON,
          pending.challenge,
        ))
      )
        throw this.invalidConfirmation();
    }
    // Recheck expiry/revocation after expensive authentication; never recreate a session.
    const current = await this.identity(ctx);
    if (current.session.id !== id.session.id)
      throw new NotAuthenticated("Session changed");
    const changed = await this.db("nodepass_sessions")
      .where({ id: id.session.id, userId: id.user.id, complete: 1 })
      .update({ verifiedAt: Date.now() });
    if (!changed) throw new NotAuthenticated("Session expired");
    ctx.body = { confirmed: true };
  }
  private async enrollment(identity: RequestIdentity): Promise<void> {
    if (identity.session.complete) {
      this.requireRecent(identity);
      return;
    }
    const existing = await this.db("nodepass_factors")
      .where({ userId: identity.user.id, confirmed: 1 })
      .first();
    if (existing)
      throw new Forbidden("Verify an existing factor before adding another");
  }
  async totpStart(ctx: Context): Promise<void> {
    const id = await this.identity(ctx, true);
    await this.enrollment(id);
    const existing = await this.db("nodepass_factors")
      .where({ userId: id.user.id, kind: "totp", confirmed: 1 })
      .first();
    if (existing) throw new BadRequest("TOTP is already configured");
    const otp = new OTPAuth.TOTP({
      issuer: "nodePass",
      label: id.user.login,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const challenge = await this.challenge(
      id.user.id,
      id.session.id,
      "totp-enroll",
      { secret: otp.secret.base32 },
    );
    ctx.body = {
      challenge,
      secret: otp.secret.base32,
      qr: await QRCode.toDataURL(otp.toString(), {
        errorCorrectionLevel: "M",
        margin: 2,
      }),
    };
  }
  async totpFinish(ctx: Context): Promise<void> {
    const id = await this.identity(ctx, true),
      data = body(ctx);
    await this.enrollment(id);
    exact(data, ["challenge", "code"]);
    const item = await this.consume(
      text(data, "challenge"),
      "totp-enroll",
      id.user.id,
      id.session.id,
    );
    const otp = new OTPAuth.TOTP({
      secret: item.secret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const delta = otp.validate({ token: text(data, "code", 6), window: 1 });
    if (delta === null) throw new NotAuthenticated("Invalid code");
    await this.db.transaction(async (trx) => {
      if (
        await trx("nodepass_factors")
          .where({ userId: id.user.id, kind: "totp", confirmed: 1 })
          .first()
      )
        throw new BadRequest("TOTP already configured");
      await trx("nodepass_factors").insert({
        userId: id.user.id,
        kind: "totp",
        data: this.vault
          .wrap(item.secret, `totp/${id.user.id}`)
          .toString("base64"),
        name: "Authenticator",
        counter: Math.floor(Date.now() / 30000) + delta,
        confirmed: 1,
      });
      await trx("nodepass_sessions").where({ userId: id.user.id }).delete();
    });
    await this.complete(ctx, id.user);
    await audit(this.db, id.user.id, "auth.totp.enroll");
  }
  async totpVerify(ctx: Context): Promise<void> {
    const id = await this.identity(ctx, true),
      data = body(ctx);
    exact(data, ["code"]);
    await this.limit("totp", String(id.user.id), 5, 300000);
    if (!(await this.verifyCode(id.user.id, text(data, "code", 100))))
      throw new NotAuthenticated("Invalid code");
    await this.complete(ctx, id.user);
  }
  private async verifyCode(userId: number, code: string): Promise<boolean> {
    return this.db.transaction(async (trx) => {
      const factors = await trx("nodepass_factors")
        .where({ userId, confirmed: 1 })
        .forUpdate();
      for (const factor of factors) {
        if (factor.kind === "recovery" && equal(factor.data, digest(code))) {
          await trx("nodepass_factors").where({ id: factor.id }).delete();
          return true;
        }
        if (factor.kind === "totp") {
          const otp = new OTPAuth.TOTP({
            secret: this.vault
              .unwrap(Buffer.from(factor.data, "base64"), `totp/${userId}`)
              .toString(),
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          });
          const delta = otp.validate({ token: code, window: 1 });
          const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
          if (delta !== null && step > Number(factor.counter)) {
            await trx("nodepass_factors")
              .where({ id: factor.id })
              .update({ counter: step });
            return true;
          }
        }
      }
      return false;
    });
  }
  private async complete(ctx: Context, user: User): Promise<void> {
    ctx.body = await this.viewer(await this.issue(ctx, user, true));
  }
  async passkeyOptions(ctx: Context, register: boolean): Promise<void> {
    if (register) {
      const id = await this.identity(ctx, true);
      await this.enrollment(id);
      const existing = await this.db("nodepass_factors").where({
        userId: id.user.id,
        kind: "passkey",
      });
      const options = await generateRegistrationOptions({
        rpName: "nodePass",
        rpID: this.config.rpId,
        userID: Buffer.from(digest(`user/${id.user.id}`), "hex"),
        userName: id.user.login,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        excludeCredentials: existing.map((f) => ({ id: f.credentialId })),
      });
      ctx.body = {
        options,
        challenge: await this.challenge(
          id.user.id,
          id.session.id,
          "passkey-register",
          { challenge: options.challenge },
        ),
      };
    } else {
      await this.limit("passkey/ip", ctx.ip, 40);
      const options = await generateAuthenticationOptions({
        rpID: this.config.rpId,
        userVerification: "required",
      });
      ctx.body = {
        options,
        challenge: await this.challenge(null, null, "passkey-login", {
          challenge: options.challenge,
        }),
      };
    }
  }
  async passkeyFinish(ctx: Context, register: boolean): Promise<void> {
    const data = body(ctx);
    exact(data, ["challenge", "response", "name"]);
    const response = data.response;
    if (!response || typeof response !== "object")
      throw new BadRequest("Invalid response");
    if (register) {
      const id = await this.identity(ctx, true);
      await this.enrollment(id);
      const pending = await this.consume(
        text(data, "challenge"),
        "passkey-register",
        id.user.id,
        id.session.id,
      );
      const result = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin: this.config.publicUrl,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      }).catch(() => {
        throw new NotAuthenticated("Passkey registration failed");
      });
      if (!result.verified || !result.registrationInfo)
        throw new NotAuthenticated("Passkey registration failed");
      const c = result.registrationInfo.credential;
      await this.db("nodepass_factors").insert({
        userId: id.user.id,
        kind: "passkey",
        credentialId: c.id,
        credentialHash: digest(c.id),
        name:
          typeof data.name === "string" ? data.name.slice(0, 100) : "Passkey",
        data: JSON.stringify({
          publicKey: Buffer.from(c.publicKey).toString("base64"),
          transports: c.transports,
        }),
        counter: c.counter,
        confirmed: 1,
      });
      await this.db("nodepass_sessions").where({ userId: id.user.id }).delete();
      await audit(this.db, id.user.id, "auth.passkey.enroll");
      await this.complete(ctx, id.user);
    } else {
      await this.limit("passkey/ip", ctx.ip, 40);
      const pending = await this.consume(
        text(data, "challenge"),
        "passkey-login",
      );
      const credentialId = text(response as Row, "id", 1024);
      const factor = await this.db("nodepass_factors")
        .where({
          credentialHash: digest(credentialId),
          kind: "passkey",
          confirmed: 1,
        })
        .first();
      if (!factor) throw new NotAuthenticated("Invalid passkey");
      const user = await this.user(factor.userId);
      if (user.isLdap && !(await this.directory(user)))
        throw new NotAuthenticated("Directory access denied");
      if (
        !(await this.verifyPasskey(
          factor,
          response as AuthenticationResponseJSON,
          pending.challenge,
        ))
      )
        throw new NotAuthenticated("Invalid passkey");
      await this.complete(ctx, user);
    }
  }
  private async verifyPasskey(
    factor: Row,
    response: AuthenticationResponseJSON,
    challenge: string,
  ): Promise<boolean> {
    const credential = JSON.parse(factor.data);
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: this.config.publicUrl,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      credential: {
        id: factor.credentialId,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64")),
        counter: Number(factor.counter),
        transports: credential.transports,
      },
    }).catch(() => null);
    if (!result?.verified) return false;
    const changed = await this.db("nodepass_factors")
      .where({ id: factor.id, counter: factor.counter })
      .update({ counter: result.authenticationInfo.newCounter });
    return changed > 0;
  }
  async recovery(ctx: Context): Promise<void> {
    const id = await this.identity(ctx);
    this.requireRecent(id);
    const codes = Array.from({ length: 10 }, () => token().slice(0, 20));
    await this.db.transaction(async (trx) => {
      await trx("nodepass_factors")
        .where({ userId: id.user.id, kind: "recovery" })
        .delete();
      await trx("nodepass_factors").insert(
        codes.map((code) => ({
          userId: id.user.id,
          kind: "recovery",
          name: "Recovery",
          data: digest(code),
          confirmed: 1,
          counter: 0,
        })),
      );
      await trx("nodepass_sessions")
        .where({ userId: id.user.id })
        .whereNot("id", id.session.id)
        .delete();
    });
    ctx.body = { codes };
    await audit(this.db, id.user.id, "auth.recovery.regenerate");
  }
  async logout(ctx: Context): Promise<void> {
    const id = await this.identity(ctx, true);
    await this.db("nodepass_sessions").where({ id: id.session.id }).delete();
    ctx.cookies.set("nodepass", "", { path: "/", maxAge: 0, overwrite: true });
    await audit(this.db, id.user.id, "auth.logout");
    ctx.status = 204;
  }
}
