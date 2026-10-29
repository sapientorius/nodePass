import { feathers } from "@feathersjs/feathers";
import { koa, rest, bodyParser } from "@feathersjs/koa";
import Router from "@koa/router";
import serve from "koa-static";
import {
  BadRequest,
  Forbidden,
  Unavailable,
  Conflict,
  NotFound,
} from "@feathersjs/errors";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { Fields } from "./services/fields.js";
import { fieldModule } from "./compat/field-modules.js";
import type { Context } from "koa";
import type { Config } from "./config.js";
import { database, migrate, putSetting, audit, type Database } from "./db.js";
import { Vault } from "./security/vault.js";
import {
  Auth,
  body,
  text,
  exact,
  type RequestIdentity,
} from "./security/auth.js";
import { Accounts, integer, type ServiceParams } from "./services/accounts.js";
import { Catalogue } from "./services/catalogue.js";
import { Resources } from "./services/resources.js";
import { Migration } from "./migration/service.js";
import { setupFailure } from "./migration/errors.js";
import { backup } from "./migration/backup.js";
import {
  checkStrength,
  hashPassword,
  verifyPassword,
} from "./security/password.js";
import {
  languages,
  defaultPolicy,
  version,
  type SecurityPolicy,
} from "@nodepass/contracts";
import { jsonRpc, actions } from "./compat/jsonrpc.js";
import { Transfer, parseImport } from "./services/transfer.js";
import { Integrations } from "./services/integrations.js";
import { jobs } from "./services/jobs.js";
import { Updates } from "./services/updates.js";
import { UpdateSource } from "./services/update-source.js";
import { proxyPeerMatcher } from "./security/proxy.js";
import { Tokens, Presets } from "./services/management.js";
import { openApi } from "./openapi.js";
import { token } from "./security/crypto.js";
import { mapData } from "./compat/data.js";
import { managementParams } from "./services/user-management.js";

export async function createApp(
  config: Config,
  providedDb?: Database,
  options: { updateFetch?: typeof fetch } = {},
) {
  const db = providedDb ?? database(config),
    vault = new Vault(db, config.deploymentKey),
    auth = new Auth(db, config, vault),
    accounts = new Accounts(db, vault),
    resources = new Resources(db, accounts, vault),
    migration = new Migration(db, vault, config),
    transfer = new Transfer(db, auth, accounts),
    integrations = new Integrations(db, vault, config.legacy);
  const fields = new Fields(
    db,
    vault,
    async (moduleId, itemId, p, action, transaction) => {
      if (moduleId === 1) {
        await accounts.access(itemId, p, action);
        return;
      }
      const module = fieldModule(moduleId);
      const scopedDb = transaction ?? db;
      if (transaction && ["users", "profiles"].includes(module.catalogue))
        p = await managementParams(transaction, auth, p);
      const user = p.identity!.user,
        write = action === "edit" || action === "editSecret";
      if (module.id === 1001) {
        const row = await db("AuthToken").where({ id: itemId }).first();
        if (
          !row ||
          (!user.isAdminApp &&
            (row.userId !== user.id ||
              (user.profile.mgmApiTokens !== true &&
                user.profile.mgmApiTokens !== 1)))
        )
          throw new Forbidden("Token unavailable");
      } else
        await new Catalogue(scopedDb, module.catalogue, auth).fieldAccess(
          itemId,
          p,
          write,
        );
      if (
        (action === "secret" &&
          !user.isAdminApp &&
          user.profile.accViewPass !== true &&
          user.profile.accViewPass !== 1) ||
        (action === "editSecret" &&
          !user.isAdminApp &&
          user.profile.accEditPass !== true &&
          user.profile.accEditPass !== 1)
      )
        throw new Forbidden("Custom-field secret permission required");
    },
  );
  if (await db.schema.hasTable("nodepass_migrations")) {
    await migrate(db);
    await vault.load();
  }
  let status = await migration.status();
  let updates = new Updates(
    db,
    integrations,
    new UpdateSource(options.updateFetch),
  );
  let stopJobs: () => void | Promise<void> = () => {};
  const startJobs = async () => {
    await stopJobs();
    updates = new Updates(
      db,
      integrations,
      new UpdateSource(options.updateFetch),
    );
    if (status.ready) stopJobs = jobs(db, integrations, updates);
  };
  await startJobs();
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const app = koa(feathers());
  app.proxy = config.trustProxy;
  app.proxyIpHeader = "X-Real-IP";
  app.maxIpsCount = 1;
  const trustedPeer = proxyPeerMatcher(config.trustedProxies);
  const limiter = new Map<string, { count: number; until: number }>();
  app.use(async (ctx, next) => {
    ctx.set({
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cache-Control": "no-store",
    });
    if (config.production)
      ctx.set("Strict-Transport-Security", "max-age=31536000");
    try {
      const forwarded = [
        "x-forwarded-for",
        "x-forwarded-proto",
        "x-forwarded-host",
        "x-real-ip",
        "forwarded",
        "x-nodepass-identity",
        "x-nodepass-signature",
      ].some((h) => ctx.get(h));
      if (
        forwarded &&
        (!config.trustProxy ||
          !(await trustedPeer(ctx.req.socket.remoteAddress)))
      )
        throw new Forbidden("Untrusted proxy headers");
      if (config.production && !ctx.secure && !ctx.path.startsWith("/health/"))
        throw new Forbidden("HTTPS is required");
      if (
        ctx.path.startsWith("/api/v1/setup/") &&
        !["GET", "HEAD"].includes(ctx.method)
      ) {
        if (status.ready) throw new Forbidden("Setup is closed");
        migration.authorize(ctx.get("x-setup-token"));
        ctx.state.setupAuthorized = true;
      }
      if (
        ctx.path.startsWith("/api/v1/") &&
        ![
          "/api/v1/status",
          "/api/v1/auth/login",
          "/api/v1/auth/sso",
          "/api/v1/auth/passkey/login",
          "/api/v1/auth/passkey/login-options",
        ].includes(ctx.path) &&
        !ctx.path.startsWith("/api/v1/setup/") &&
        !ctx.path.startsWith("/api/v1/public/")
      ) {
        if (!status.ready)
          throw new Unavailable("Complete instance setup first");
        await auth.identity(ctx, true);
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(ctx.method) &&
        ctx.path !== "/api.php" &&
        ctx.get("origin") !== config.publicUrl
      )
        throw new Forbidden("Invalid request origin");
      if (
        ctx.path.startsWith("/api/v1/setup") ||
        ctx.path.startsWith("/api/v1/auth")
      ) {
        const now = Date.now(),
          key = ctx.ip;
        let entry = limiter.get(key);
        if (!entry || entry.until < now) {
          if (limiter.size > 2048) limiter.clear();
          entry = { count: 0, until: now + 60000 };
          limiter.set(key, entry);
        }
        if (++entry.count > 100) {
          ctx.status = 429;
          ctx.body = { message: "Try again later" };
          return;
        }
      }
      await next();
    } catch (error) {
      const e = error as { code?: number; status?: number; message?: string };
      const code = Number(e.code ?? e.status ?? 500);
      ctx.status = code >= 400 && code < 600 ? code : 500;
      if (ctx.state.setupAuthorized) {
        const failure = setupFailure(error),
          reference = randomUUID();
        ctx.body = { ...failure, reference, step: "request" };
        console.error(
          JSON.stringify({
            event: "setup.failed",
            reference,
            kind: "request",
            step: "request",
            code: failure.code,
            ...failure.details,
          }),
        );
        return;
      }
      ctx.body = {
        message:
          ctx.status < 500
            ? (e.message ?? "Request failed")
            : "The request could not be completed",
        ...(error instanceof Forbidden &&
        [
          "REAUTHENTICATION_REQUIRED",
          "CONFIRMATION_INVALID",
          "MFA_REQUIRED",
        ].includes(error.data?.code)
          ? { code: error.data.code }
          : {}),
      };
      if (ctx.status >= 500)
        console.error(
          JSON.stringify({
            event: "request.error",
            status: ctx.status,
            path: ctx.path.replace(/\/[^/]{32,}/g, "/[redacted]"),
          }),
        );
    }
  });
  app.use(async (ctx, next) =>
    bodyParser({
      jsonLimit:
        ctx.path === "/api/v1/setup/import"
          ? "90mb"
          : ctx.path === "/api.php"
            ? "64kb"
            : ctx.path.startsWith("/api/v1/auth")
              ? "16kb"
              : "15mb",
      json: true,
      urlencoded: false,
      text: false,
      multipart: false,
    })(ctx, next),
  );
  const router = new Router();
  const requireReady = (): void => {
    if (!status.ready || !vault.unlocked)
      throw new Unavailable("Complete instance setup first");
  };
  const params = async (
    ctx: Context,
    pending = false,
  ): Promise<ServiceParams> => {
    requireReady();
    return { identity: await auth.identity(ctx, pending) };
  };
  const admin = async (
    ctx: Context,
    recent = false,
  ): Promise<RequestIdentity> => {
    const p = await params(ctx),
      id = p.identity!;
    if (!id.user.isAdminApp)
      throw new Forbidden("Application administrator required");
    if (recent) auth.requireRecent(id);
    return id;
  };
  const permission = async (
    ctx: Context,
    flag: string,
    recent = false,
  ): Promise<RequestIdentity> => {
    const id = (await params(ctx)).identity!;
    if (
      !id.user.isAdminApp &&
      id.user.profile[flag] !== true &&
      id.user.profile[flag] !== 1
    )
      throw new Forbidden("Required permission: " + flag);
    if (recent) auth.requireRecent(id);
    return id;
  };
  const setup = async (ctx: Context): Promise<void> => {
    if (status.ready) throw new Forbidden("Setup is closed");
    migration.authorize(ctx.get("x-setup-token"));
  };
  type SetupJob = {
    id: string;
    kind: string;
    step: string;
    state: "running" | "complete" | "failed";
    result?: unknown;
    error?: ReturnType<typeof setupFailure> & {
      reference: string;
      step: string;
    };
  };
  const setupJobs = new Map<string, SetupJob>(),
    setupTasks = new Set<Promise<void>>();
  const queueSetup = (kind: string, work: () => Promise<unknown>): SetupJob => {
    if ([...setupJobs.values()].some((job) => job.state === "running"))
      throw new Conflict("A setup job is already active");
    if (setupJobs.size >= 5) setupJobs.delete(setupJobs.keys().next().value!);
    const job: SetupJob = { id: token(), kind, step: kind, state: "running" };
    setupJobs.set(job.id, job);
    migration.onProgress = (step) => {
      job.step = step;
    };
    const task = (async () => {
      try {
        job.result = await work();
        status = await migration.status();
        await startJobs();
        job.state = "complete";
        job.step = "saved";
      } catch (error) {
        job.state = "failed";
        job.error = {
          ...setupFailure(error),
          reference: randomUUID(),
          step: job.step,
        };
        console.error(
          JSON.stringify({
            event: "setup.failed",
            reference: job.error.reference,
            kind,
            step: job.step,
            code: job.error.code,
            ...job.error.details,
          }),
        );
      } finally {
        migration.onProgress = undefined;
      }
    })();
    setupTasks.add(task);
    void task.then(
      () => setupTasks.delete(task),
      () => setupTasks.delete(task),
    );
    return job;
  };
  router.get("/api/v1/setup/jobs/:id", (ctx) => {
    migration.authorize(ctx.get("x-setup-token"));
    const job = setupJobs.get(ctx.params.id!);
    if (!job)
      throw new NotFound(
        "Setup job unavailable; restart the setup with the same data volume to resume",
      );
    ctx.body = job;
  });
  router.get("/health/live", (ctx) => {
    ctx.body = { status: "alive" };
  });
  router.get("/health/ready", async (ctx) => {
    try {
      await db.raw("SELECT 1");
    } catch {
      ctx.status = 503;
      ctx.body = { status: "database-unavailable" };
      return;
    }
    ctx.status = status.ready && vault.unlocked ? 200 : 503;
    ctx.body = { status: ctx.status === 200 ? "ready" : "setup-required" };
  });
  router.get("/api/v1/status", async (ctx) => {
    ctx.body = {
      name: "nodePass",
      version,
      setupRequired: !status.ready,
      legacy: status.legacy,
      sso:
        status.ready &&
        (
          await vault.configuration<Record<string, unknown>>(
            "integration/sso",
            {},
          )
        ).enabled === true,
    };
  });
  router.post("/api/v1/setup/preflight", async (ctx) => {
    await setup(ctx);
    const data = body(ctx);
    ctx.body = await migration.preflight(
      data.configuration
        ? (await import("./compat/config.js")).parseConfig(
            text(data, "configuration", 1000000),
          )
        : undefined,
    );
  });
  router.post("/api/v1/setup/fresh", async (ctx) => {
    await setup(ctx);
    const data = body(ctx);
    exact(data, ["login", "name", "password"]);
    await migration.fresh({
      login: text(data, "login", 50),
      name: text(data, "name", 80),
      password: text(data, "password"),
      token: ctx.get("x-setup-token"),
    });
    status = await migration.status();
    await startJobs();
    ctx.body = { ready: status.ready };
  });
  router.post("/api/v1/setup/migrate", async (ctx) => {
    await setup(ctx);
    const data = body(ctx);
    exact(data, [
      "login",
      "password",
      "masterPassword",
      "configuration",
      "maintenance",
    ]);
    if (
      data.configuration !== undefined &&
      typeof data.configuration !== "string"
    )
      throw new BadRequest("Invalid configuration");
    const input = {
      login: text(data, "login", 100),
      password: text(data, "password", 4096),
      masterPassword: text(data, "masterPassword", 4096),
      configuration: data.configuration,
      maintenance: data.maintenance,
      token: ctx.get("x-setup-token"),
    };
    const job = queueSetup("migrate", async () => {
      try {
        return await migration.takeover(input);
      } finally {
        input.password = "";
        input.masterPassword = "";
        input.configuration = "";
      }
    });
    ctx.status = 202;
    ctx.body = { job: job.id };
  });
  router.post("/api/v1/setup/import", async (ctx) => {
    await setup(ctx);
    const data = body(ctx);
    exact(data, ["dump", "configuration"]);
    let source = text(data, "dump", 64 * 1024 ** 2);
    let configuration =
      data.configuration === undefined
        ? undefined
        : text(data, "configuration", 1000000);
    const job = queueSetup("import", async () => {
      try {
        await migration.importDump(source, configuration);
        return { imported: true };
      } finally {
        source = "";
        configuration = undefined;
      }
    });
    ctx.status = 202;
    ctx.body = { job: job.id };
  });
  router.post("/api/v1/auth/login", async (ctx) => {
    requireReady();
    await auth.login(ctx);
  });
  router.post("/api/v1/auth/sso", async (ctx) => {
    requireReady();
    await auth.sso(ctx);
  });
  const tokens = new Tokens(db, auth),
    presets = new Presets(db);
  router.get("/api/v1/token-scopes", async (ctx) => {
    await params(ctx);
    ctx.body = Object.keys(actions).map((value) => ({ label: value, value }));
  });
  router.get("/api/v1/tokens", async (ctx) => {
    ctx.body = await tokens.list(await params(ctx));
  });
  router.post("/api/v1/tokens", async (ctx) => {
    ctx.body = await tokens.create(body(ctx), await params(ctx));
  });
  router.delete("/api/v1/tokens/:id", async (ctx) => {
    await tokens.remove(integer(ctx.params.id), await params(ctx));
    ctx.status = 204;
  });
  router.get("/api/v1/presets", async (ctx) => {
    ctx.body = await presets.list(await params(ctx), ctx.query.all === "true");
  });
  router.post("/api/v1/presets", async (ctx) => {
    const p = await params(ctx);
    auth.requireRecent(p.identity!);
    ctx.body = await presets.save(undefined, body(ctx), p);
  });
  router.patch("/api/v1/presets/:id", async (ctx) => {
    const p = await params(ctx);
    auth.requireRecent(p.identity!);
    ctx.body = await presets.save(integer(ctx.params.id), body(ctx), p);
  });
  router.delete("/api/v1/presets/:id", async (ctx) => {
    const p = await params(ctx);
    auth.requireRecent(p.identity!);
    await presets.remove(integer(ctx.params.id), p);
    ctx.status = 204;
  });
  router.get("/api/v1/auth/session", async (ctx) => {
    ctx.body = await auth.viewer((await params(ctx, true)).identity!);
  });
  router.get("/api/v1/auth/policy", async (ctx) => {
    await params(ctx);
    const policy = await auth.policy();
    ctx.body = { minLength: policy.minLength, minScore: policy.minScore };
  });
  router.post("/api/v1/auth/logout", async (ctx) => {
    requireReady();
    await auth.logout(ctx);
  });
  router.post("/api/v1/auth/totp/start", async (ctx) => {
    requireReady();
    await auth.totpStart(ctx);
  });
  router.post("/api/v1/auth/totp/enroll", async (ctx) => {
    requireReady();
    await auth.totpFinish(ctx);
  });
  router.post("/api/v1/auth/totp/verify", async (ctx) => {
    requireReady();
    await auth.totpVerify(ctx);
  });
  router.post("/api/v1/auth/passkey/register-options", async (ctx) => {
    requireReady();
    await auth.passkeyOptions(ctx, true);
  });
  router.post("/api/v1/auth/passkey/register", async (ctx) => {
    requireReady();
    await auth.passkeyFinish(ctx, true);
  });
  router.post("/api/v1/auth/passkey/login-options", async (ctx) => {
    requireReady();
    await auth.passkeyOptions(ctx, false);
  });
  router.post("/api/v1/auth/passkey/login", async (ctx) => {
    requireReady();
    await auth.passkeyFinish(ctx, false);
  });
  router.post("/api/v1/auth/recovery", async (ctx) => {
    requireReady();
    await auth.recovery(ctx);
  });
  router.get("/api/v1/auth/confirm", async (ctx) => {
    requireReady();
    await auth.confirmationMethods(ctx);
  });
  router.post("/api/v1/auth/confirm", async (ctx) => {
    requireReady();
    await auth.confirm(ctx);
  });
  router.post("/api/v1/auth/confirm/passkey-options", async (ctx) => {
    requireReady();
    await auth.confirmationOptions(ctx);
  });
  router.get("/api/v1/auth/factors", async (ctx) => {
    const id = (await params(ctx)).identity!;
    ctx.body = await db("nodepass_factors")
      .where({ userId: id.user.id, confirmed: 1 })
      .whereNot("kind", "recovery")
      .select("id", "kind", "name");
  });
  router.delete("/api/v1/auth/factors/:id", async (ctx) => {
    const id = (await params(ctx)).identity!;
    auth.requireRecent(id);
    const factorId = integer(ctx.params.id);
    await db.transaction(async (trx) => {
      const factors = await trx("nodepass_factors")
        .where({ userId: id.user.id, confirmed: 1 })
        .whereNot("kind", "recovery")
        .forUpdate();
      if (!factors.some((f) => f.id === factorId))
        throw new BadRequest("Unknown factor");
      const policy = await auth.policy();
      if (
        factors.length <= 1 &&
        (policy.mfa === "everyone" ||
          (policy.mfa === "admins" &&
            (id.user.isAdminApp || id.user.isAdminAcc)))
      )
        throw new Forbidden("Enroll a replacement factor first");
      await trx("nodepass_factors")
        .where({ id: factorId, userId: id.user.id })
        .delete();
      await trx("nodepass_sessions").where({ userId: id.user.id }).delete();
      await audit(trx, id.user.id, "auth.factor.remove", factorId);
    });
    ctx.status = 204;
  });
  router.post("/api/v1/auth/password", async (ctx) => {
    const id = (await params(ctx)).identity!;
    auth.requireRecent(id);
    if (id.user.isLdap)
      throw new BadRequest(
        "Change directory passwords in your directory service",
      );
    const data = body(ctx);
    exact(data, ["current", "password"]);
    const row = await db("User").where({ id: id.user.id }).first();
    if (
      !(await verifyPassword(
        text(data, "current", 4096),
        Buffer.from(row.pass).toString(),
      ))
    )
      throw new Forbidden("Invalid credentials");
    const value = text(data, "password");
    checkStrength(value, await auth.policy());
    const hash = await hashPassword(value);
    await db.transaction(async (trx) => {
      await trx("User")
        .where({ id: id.user.id })
        .update({ pass: hash, lastUpdate: new Date() });
      await trx("nodepass_sessions").where({ userId: id.user.id }).delete();
      await audit(trx, id.user.id, "auth.password.change");
    });
    ctx.status = 204;
  });
  router.patch("/api/v1/preferences", async (ctx) => {
    const id = (await params(ctx)).identity!,
      data = body(ctx);
    exact(data, ["lang", "theme", "view"]);
    if (data.lang !== undefined && !languages.includes(data.lang))
      throw new BadRequest("Invalid language");
    if (data.theme !== undefined && !["light", "dark"].includes(data.theme))
      throw new BadRequest("Invalid theme");
    if (data.view !== undefined && !["list", "cards"].includes(data.view))
      throw new BadRequest("Invalid view");
    const row = await db("User").where({ id: id.user.id }).first();
    const preferences = { ...mapData(row.preferences), ...data };
    await db("User")
      .where({ id: id.user.id })
      .update({ preferences: `NPJ1:${JSON.stringify(preferences)}` });
    ctx.body = preferences;
  });
  router.post("/api/v1/accounts/:id/secret", async (ctx) => {
    ctx.body = await accounts.secret(integer(ctx.params.id), await params(ctx));
  });
  router.post("/api/v1/accounts/:id/password", async (ctx) => {
    const data = body(ctx);
    exact(data, ["password", "version"]);
    ctx.body = await accounts.changeSecret(
      integer(ctx.params.id),
      text(data, "password", 1900),
      integer(data.version, 0),
      await params(ctx),
    );
  });
  router.get("/api/v1/accounts/:id/permissions", async (ctx) => {
    ctx.body = await accounts.grants(integer(ctx.params.id), await params(ctx));
  });
  router.put("/api/v1/accounts/:id/permissions", async (ctx) => {
    await accounts.setGrants(
      integer(ctx.params.id),
      body(ctx),
      await params(ctx),
    );
    ctx.status = 204;
  });
  router.get("/api/v1/accounts/:id/fields", async (ctx) => {
    ctx.body = await accounts.fields(integer(ctx.params.id), await params(ctx));
  });
  router.get("/api/v1/items/:module/:id/fields", async (ctx) => {
    ctx.body = await fields.list(
      integer(ctx.params.module),
      integer(ctx.params.id),
      await params(ctx),
    );
  });
  router.post("/api/v1/items/:module/:id/fields/:field/secret", async (ctx) => {
    ctx.body = await fields.reveal(
      integer(ctx.params.module),
      integer(ctx.params.id),
      integer(ctx.params.field),
      await params(ctx),
    );
  });
  router.put("/api/v1/items/:module/:id/fields/:field", async (ctx) => {
    const data = body(ctx);
    exact(data, ["value"]);
    if (typeof data.value !== "string")
      throw new BadRequest("Invalid field value");
    await fields.set(
      integer(ctx.params.module),
      integer(ctx.params.id),
      integer(ctx.params.field),
      data.value,
      await params(ctx),
    );
    ctx.status = 204;
  });
  router.post("/api/v1/accounts/:id/fields/:field/secret", async (ctx) => {
    ctx.body = await accounts.fieldSecret(
      integer(ctx.params.id),
      integer(ctx.params.field),
      await params(ctx),
    );
  });
  router.put("/api/v1/accounts/:id/fields/:field", async (ctx) => {
    const data = body(ctx);
    exact(data, ["value"]);
    if (typeof data.value !== "string")
      throw new BadRequest("Invalid field value");
    await accounts.setField(
      integer(ctx.params.id),
      integer(ctx.params.field),
      data.value,
      await params(ctx),
    );
    ctx.status = 204;
  });
  router.get("/api/v1/accounts/:id/history", async (ctx) => {
    ctx.body = await accounts.history(
      integer(ctx.params.id),
      await params(ctx),
    );
  });
  router.post("/api/v1/accounts/:id/history/:history/secret", async (ctx) => {
    ctx.body = await accounts.historySecret(
      integer(ctx.params.id),
      integer(ctx.params.history),
      await params(ctx),
    );
  });
  router.post("/api/v1/accounts/:id/history/:history/restore", async (ctx) => {
    const data = body(ctx);
    exact(data, ["version"]);
    ctx.body = await accounts.restore(
      integer(ctx.params.id),
      integer(ctx.params.history),
      integer(data.version, 0),
      await params(ctx),
    );
  });
  router.post("/api/v1/accounts/:id/favorite", async (ctx) => {
    const data = body(ctx);
    exact(data, ["enabled"]);
    if (typeof data.enabled !== "boolean")
      throw new BadRequest("Invalid favorite");
    await accounts.favorite(
      integer(ctx.params.id),
      data.enabled,
      await params(ctx),
    );
    ctx.status = 204;
  });
  router.get("/api/v1/accounts/:id/files", async (ctx) => {
    ctx.body = await resources.files(integer(ctx.params.id), await params(ctx));
  });
  router.post("/api/v1/accounts/:id/files", async (ctx) => {
    ctx.body = await resources.upload(
      integer(ctx.params.id),
      body(ctx),
      await params(ctx),
    );
  });
  router.get("/api/v1/files/:id", async (ctx) => {
    const file = await resources.download(
      integer(ctx.params.id),
      await params(ctx),
    );
    ctx.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    ctx.type = "application/octet-stream";
    ctx.body = file.content;
  });
  router.delete("/api/v1/files/:id", async (ctx) => {
    await resources.deleteFile(integer(ctx.params.id), await params(ctx));
    ctx.status = 204;
  });
  router.get("/api/v1/accounts/:id/links", async (ctx) => {
    ctx.body = await resources.links(integer(ctx.params.id), await params(ctx));
  });
  router.post("/api/v1/accounts/:id/links", async (ctx) => {
    const p = await params(ctx);
    ctx.body = await resources.share(integer(ctx.params.id), body(ctx), p);
  });
  router.delete("/api/v1/links/:id", async (ctx) => {
    await resources.revokeLink(integer(ctx.params.id), await params(ctx));
    ctx.status = 204;
  });
  router.post("/api/v1/public/:hash/reveal", async (ctx) => {
    requireReady();
    await auth.limit("public", ctx.ip, 30);
    ctx.body = await resources.reveal(ctx.params.hash!);
  });
  router.get("/api/v1/security", async (ctx) => {
    await admin(ctx);
    ctx.body = await auth.policy();
  });
  router.patch("/api/v1/security", async (ctx) => {
    const id = await admin(ctx, true),
      data = body(ctx);
    exact(data, Object.keys(defaultPolicy));
    if (!["optional", "admins", "everyone"].includes(data.mfa))
      throw new BadRequest("Invalid MFA policy");
    const policy: SecurityPolicy = {
      mfa: data.mfa,
      minLength: integer(data.minLength, 12, 128),
      minScore: integer(data.minScore, 2, 4),
      sessionIdleSeconds: integer(data.sessionIdleSeconds, 60, 3600),
      sessionAbsoluteSeconds: integer(data.sessionAbsoluteSeconds, 300, 86400),
    };
    await db.transaction(async (trx) => {
      await putSetting(trx, "security", policy);
      await audit(trx, id.user.id, "security.policy");
    });
    ctx.body = policy;
  });
  router.get("/api/v1/account-access", async (ctx) => {
    await admin(ctx);
    ctx.body = { fullGroupAccess: await accounts.fullGroup() };
  });
  router.patch("/api/v1/account-access", async (ctx) => {
    const id = await admin(ctx, true),
      data = body(ctx);
    exact(data, ["fullGroupAccess"]);
    if (typeof data.fullGroupAccess !== "boolean")
      throw new BadRequest("Invalid secondary group access setting");
    await db.transaction(async (trx) => {
      await putSetting(trx, "fullGroupAccess", data.fullGroupAccess);
      await audit(trx, id.user.id, "security.account-access");
    });
    ctx.body = { fullGroupAccess: data.fullGroupAccess };
  });
  router.get("/api/v1/events", async (ctx) => {
    await permission(ctx, "evl");
    if (
      Object.keys(ctx.query).some((key) => key !== "legacy") ||
      (ctx.query.legacy !== undefined && ctx.query.legacy !== "true")
    )
      throw new BadRequest("Invalid event query");
    const legacy = ctx.query.legacy === "true";
    const rows = legacy
      ? (
          await db("EventLog")
            .select(
              "id",
              "date",
              "action",
              "userId",
              "description",
              "login as userLogin",
            )
            .orderBy("id", "desc")
            .limit(200)
        ).map((row) => ({
          ...row,
          date: new Date(row.date * 1000).toISOString(),
          target: row.description,
        }))
      : await db("nodepass_audit").orderBy("id", "desc").limit(200);
    const targetUserId = (row: { action: string; target: unknown }) => {
      const id = Number(row.target);
      return !legacy &&
        (row.action.startsWith("users.") ||
          ["token.create", "auth.emergency.recovery"].includes(row.action)) &&
        /^[1-9]\d*$/.test(String(row.target)) &&
        Number.isSafeInteger(id)
        ? id
        : null;
    };
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.userId, targetUserId(row)])),
    ].filter((id): id is number => Number.isSafeInteger(id) && id > 0);
    const users = await db("User").select("id", "login").whereIn("id", userIds);
    const logins = new Map<number, string>(
      users.map((user) => [user.id, user.login]),
    );
    ctx.body = rows.map((row) => ({
      ...row,
      userLogin: row.userLogin || logins.get(row.userId) || null,
      targetUserLogin: logins.get(targetUserId(row) ?? 0) ?? null,
    }));
  });
  router.get("/api/v1/updates", async (ctx) => {
    const id = await admin(ctx);
    ctx.body = await updates.status(id.user.id);
  });
  router.get("/api/v1/updates/releases", async (ctx) => {
    await admin(ctx);
    ctx.body = await updates.releases();
  });
  router.post("/api/v1/updates/acknowledgement", async (ctx) => {
    const id = await admin(ctx),
      data = body(ctx);
    exact(data, ["id"]);
    const notificationId = text(data, "id", 64);
    if (!/^[a-f0-9]{64}$/.test(notificationId))
      throw new BadRequest("Invalid update notification");
    await updates.acknowledge(id.user.id, notificationId);
    ctx.status = 204;
  });
  router.get("/api/v1/notifications", async (ctx) => {
    const id = (await params(ctx)).identity!;
    ctx.body = await db("Notification")
      .where((b) => b.where("userId", id.user.id).orWhereNull("userId"))
      .modify((q) => {
        if (!id.user.isAdminApp) q.where("onlyAdmin", 0);
      })
      .orderBy("id", "desc")
      .limit(100);
    for (const item of ctx.body as any[])
      if (!item.userId)
        item.checked = await (
          await import("./db.js")
        ).getSetting(db, `notification/${id.user.id}/${item.id}`, false);
  });
  router.post("/api/v1/notifications/:id/read", async (ctx) => {
    const { user } = (await params(ctx)).identity!;
    const notification = await db("Notification")
      .where({ id: integer(ctx.params.id) })
      .first();
    if (
      !notification ||
      (notification.userId && notification.userId !== user.id) ||
      (notification.onlyAdmin && !user.isAdminApp)
    )
      throw new Forbidden("Notification unavailable");
    if (notification.userId)
      await db("Notification")
        .where({ id: notification.id })
        .update({ checked: 1 });
    else
      await putSetting(db, `notification/${user.id}/${notification.id}`, true);
    ctx.status = 204;
  });
  router.post("/api/v1/backups", async (ctx) => {
    const id = await permission(ctx, "configBackup", true);
    const name = await backup(
      db,
      resolve(config.dataDir, "backups"),
      config.deploymentKey,
      { legacy: config.legacy, publicUrl: config.publicUrl },
    );
    await audit(db, id.user.id, "backup.create");
    ctx.body = { name };
  });
  router.get("/api/v1/backups/:name", async (ctx) => {
    await permission(ctx, "configBackup", true);
    if (!/^nodepass-\d+-[A-Za-z0-9_-]{8}\.npb$/.test(ctx.params.name!))
      throw new BadRequest("Invalid backup name");
    ctx.set("Content-Disposition", `attachment; filename="${ctx.params.name}"`);
    ctx.type = "application/octet-stream";
    ctx.body = createReadStream(
      resolve(config.dataDir, "backups", ctx.params.name!),
    );
  });
  router.post("/api.php", async (ctx) => {
    requireReady();
    await jsonRpc(ctx, auth, accounts);
  });
  router.get("/api/v1/integrations/:name", async (ctx) => {
    await permission(ctx, "configGeneral");
    ctx.body = await integrations.view(ctx.params.name!);
  });
  router.patch("/api/v1/integrations/:name", async (ctx) => {
    const id = await permission(ctx, "configGeneral", true);
    await integrations.save(ctx.params.name!, body(ctx), id.user.id);
    ctx.status = 204;
  });
  router.post("/api/v1/integrations/smtp/test", async (ctx) => {
    await permission(ctx, "configGeneral", true);
    await integrations.mail(
      "nodePass · Connection test",
      "The configured nodePass mail connection is working.",
    );
    ctx.body = { sent: true };
  });
  router.post("/api/v1/wiki", async (ctx) => {
    await params(ctx);
    const data = body(ctx);
    exact(data, ["method", "query"]);
    if (!["search", "page"].includes(data.method))
      throw new BadRequest("Invalid wiki method");
    ctx.body = await integrations.wiki(data.method, text(data, "query", 200));
  });
  router.post("/api/v1/import/preview", async (ctx) => {
    const id = await permission(ctx, "configImport", true),
      data = body(ctx);
    exact(data, ["format", "source", "password"]);
    const entries = await parseImport(
      text(data, "format", 20),
      text(data, "source", 10 * 1024 ** 2),
      data.password ?? "",
    );
    ctx.body = {
      count: entries.length,
      names: entries.slice(0, 20).map((e) => e.name),
      challenge: await auth.challenge(id.user.id, id.session.id, "import", {
        entries,
      }),
    };
  });
  router.post("/api/v1/import/commit", async (ctx) => {
    const id = await permission(ctx, "configImport", true),
      data = body(ctx);
    exact(data, ["challenge", "categoryId", "clientId", "userGroupId"]);
    const pending = await auth.consume(
      text(data, "challenge"),
      "import",
      id.user.id,
      id.session.id,
    );
    ctx.body = await transfer.commit(
      pending.entries,
      {
        categoryId: integer(data.categoryId),
        clientId: integer(data.clientId),
        userGroupId: integer(data.userGroupId),
      },
      { identity: id },
    );
  });
  router.post("/api/v1/export", async (ctx) => {
    const id = await permission(ctx, "configBackup", true),
      data = body(ctx);
    exact(data, ["format", "password", "cleartext"]);
    const result = await transfer.export(
      text(data, "format", 20),
      data.password ?? "",
      data.cleartext === true,
      { identity: id },
    );
    ctx.type = result.type;
    ctx.set("Content-Disposition", `attachment; filename="${result.filename}"`);
    ctx.body = result.content;
  });
  router.get("/api/v1/openapi.json", async (ctx) => {
    await params(ctx);
    ctx.body = openApi(
      router.stack.map((layer) => ({
        path: String(layer.path),
        methods: layer.methods,
      })),
      config.publicUrl,
    );
  });
  app.use(router.routes());
  app.use(router.allowedMethods());
  app.use(async (ctx, next) => {
    if (ctx.path.startsWith("/api/v1/")) {
      requireReady();
      ctx.feathers = {
        ...ctx.feathers,
        identity: await auth.identity(ctx),
      } as ServiceParams;
    }
    await next();
  });
  app.configure(rest());
  app.use("api/v1/accounts", accounts, {
    methods: ["find", "get", "create", "patch", "remove"],
  });
  for (const name of [
    "categories",
    "clients",
    "tags",
    "groups",
    "users",
    "profiles",
    "fields",
  ])
    app.use(`api/v1/${name}`, new Catalogue(db, name, auth), {
      methods: ["find", "get", "create", "patch", "remove"],
    });
  const web = resolve(process.env.WEB_ROOT ?? "packages/web/dist");
  app.use(serve(web, { maxage: 0, index: false }));
  app.use(async (ctx) => {
    if (
      ctx.method === "GET" &&
      !ctx.path.startsWith("/api") &&
      !ctx.path.startsWith("/health")
    ) {
      ctx.type = "html";
      ctx.body = await readFile(resolve(web, "index.html"), "utf8");
    }
  });
  return {
    app,
    db,
    auth,
    vault,
    accounts,
    resources,
    migration,
    get updates() {
      return updates;
    },
    close: async () => {
      await stopJobs();
      await Promise.allSettled([...setupTasks]);
      vault.destroy();
      await db.destroy();
    },
  };
}
