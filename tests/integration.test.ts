import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { version } from "@nodepass/contracts";
import { existsSync } from "node:fs";
import { once } from "node:events";
import type { Context } from "koa";
import { loadConfig } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";
import * as OTPAuth from "otpauth";
import { isolatedDatabase } from "./database.js";
import { encryptDefuse } from "../packages/server/src/compat/defuse.js";
import { putSetting } from "../packages/server/src/db.js";
import { UpdateSource } from "../packages/server/src/services/update-source.js";
import { updateFixture } from "./update-fixtures.js";
import { refreshReleaseHistory } from "../packages/server/src/services/release-history.js";
// This suite is mandatory in CI. Local opt-in avoids accidentally targeting a production DB.
const enabled = process.env.NODEPASS_INTEGRATION === "1";
describe.skipIf(!enabled)("real database and HTTP boundaries", () => {
  let runtime: Awaited<ReturnType<typeof createApp>>,
    server: Awaited<
      ReturnType<Awaited<ReturnType<typeof createApp>>["app"]["listen"]>
    >,
    base: string,
    cookie = "",
    csrf = "",
    drop: () => Promise<void>;
  const password = "violet meteor cascade unicycle 83!";
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...extra,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const value = response.status === 204 ? null : await response.json();
    if (value?.csrf) csrf = value.csrf;
    return { response, value };
  };
  beforeAll(async () => {
    if (existsSync(".cache/integration.env"))
      process.loadEnvFile(".cache/integration.env");
    const isolated = await isolatedDatabase(loadConfig());
    drop = isolated.drop;
    runtime = await createApp(isolated.config, undefined, {
      updateFetch: offlineUpdates,
    });
    const [tables] = await runtime.db.raw("SHOW TABLES");
    if (tables.length) throw new Error("Integration database must be empty");
    server = await runtime.app.listen(0, "127.0.0.1");
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test listener");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    if (runtime) await runtime.close();
    if (drop) await drop();
  });
  it("protects bootstrap, creates a fresh instance and requires an admin factor", async () => {
    expect(
      (
        await request("/api/v1/setup/fresh", "POST", {
          login: "admin",
          name: "Admin",
          password,
        })
      ).response.status,
    ).toBe(403);
    const setup = await request(
      "/api/v1/setup/fresh",
      "POST",
      { login: "admin", name: "Admin", password },
      { "x-setup-token": process.env.SETUP_TOKEN! },
    );
    expect(setup.response.status, JSON.stringify(setup.value)).toBe(200);
    const login = await request("/api/v1/auth/login", "POST", {
      login: "admin",
      password,
    });
    expect(login.response.status, JSON.stringify(login.value)).toBe(200);
    expect(login.value.phase).toBe("enroll");
    expect((await request("/api/v1/accounts")).response.status).toBe(403);
    const start = await request("/api/v1/auth/totp/start", "POST", {});
    expect(start.response.status, JSON.stringify(start.value)).toBe(200);
    const otp = new OTPAuth.TOTP({ secret: start.value.secret });
    const enrolled = await request("/api/v1/auth/totp/enroll", "POST", {
      challenge: start.value.challenge,
      code: otp.generate(),
    });
    expect(enrolled.response.status, JSON.stringify(enrolled.value)).toBe(200);
    expect(enrolled.value.phase).toBe("ready");
  });
  it("uses Feathers services without leaking secrets and detects conflicting updates", async () => {
    const fields = {
      name: "Test vault",
      login: "robot",
      password: "synthetic account secret",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
    };
    const created = await request("/api/v1/accounts", "POST", fields);
    expect(created.response.status, JSON.stringify(created.value)).toBe(201);
    expect(created.value).not.toHaveProperty("pass");
    expect(created.value).not.toHaveProperty("key");
    const list = await request("/api/v1/accounts");
    expect(list.response.status, JSON.stringify(list.value)).toBe(200);
    expect(list.value.total).toBe(1);
    expect(JSON.stringify(list.value)).not.toContain(
      "synthetic account secret",
    );
    const secret = await request("/api/v1/accounts/1/secret", "POST", {});
    expect(secret.value.password).toBe(fields.password);
    const edited = await request("/api/v1/accounts/1", "PATCH", {
      ...fields,
      name: "Updated",
      version: 1,
    });
    expect(edited.response.status, JSON.stringify(edited.value)).toBe(200);
    expect(edited.value.version).toBe(2);
    expect(
      (await request("/api/v1/accounts/1", "PATCH", { ...fields, version: 1 }))
        .response.status,
    ).toBe(409);
    expect(
      (await request("/api/v1/accounts?password=bad")).response.status,
    ).toBe(400);
  });
  it("rejects origin and CSRF abuse, then closes bootstrap", async () => {
    expect(
      (
        await request(
          "/api/v1/accounts/1/secret",
          "POST",
          {},
          { "x-csrf-token": "bad" },
        )
      ).response.status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/v1/accounts/1/secret",
          "POST",
          {},
          { origin: "https://attacker.invalid" },
        )
      ).response.status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/v1/setup/fresh",
          "POST",
          {},
          { "x-setup-token": process.env.SETUP_TOKEN! },
        )
      ).response.status,
    ).toBe(403);
  });
  it("serves protected management, personal and account operations through HTTP", async () => {
    expect((await request("/health/live")).response.status).toBe(200);
    expect((await request("/health/ready")).response.status).toBe(200);
    expect((await request("/api/v1/status")).value.setupRequired).toBe(false);
    const doc = await request("/api/v1/openapi.json");
    expect(doc.value.openapi).toBe("3.1.0");
    expect(doc.value.paths["/api/v1/accounts/{id}/secret"].post).toBeDefined();
    expect((await request("/api/v1/auth/session")).value.phase).toBe("ready");
    expect((await request("/api/v1/auth/factors")).value).toHaveLength(1);
    expect(
      (await request("/api/v1/auth/confirm", "POST", { password })).response
        .status,
    ).toBe(403);
    expect(
      (await request("/api/v1/auth/factors/99999", "DELETE")).response.status,
    ).toBe(400);
    const factor = await runtime
      .db("nodepass_factors")
      .where({ kind: "totp" })
      .first();
    expect(
      (await request(`/api/v1/auth/factors/${factor.id}`, "DELETE")).response
        .status,
    ).toBe(403);
    expect(
      (await request("/api/v1/auth/recovery", "POST", {})).value.codes,
    ).toHaveLength(10);
    for (const data of [
      { lang: "unknown" },
      { theme: "pink" },
      { view: "unknown" },
      { pass: "injection" },
    ])
      expect(
        (await request("/api/v1/preferences", "PATCH", data)).response.status,
      ).toBe(400);
    expect(
      (
        await request("/api/v1/preferences", "PATCH", {
          lang: "en_US",
          theme: "dark",
          view: "list",
        })
      ).response.status,
    ).toBe(200);
    const policy = (await request("/api/v1/security")).value;
    expect(policy.mfa).toBe("admins");
    expect(
      (await request("/api/v1/security", "PATCH", { ...policy, mfa: "unsafe" }))
        .response.status,
    ).toBe(400);
    expect(
      (await request("/api/v1/security", "PATCH", policy)).response.status,
    ).toBe(200);
    expect((await request("/api/v1/events")).value.length).toBeGreaterThan(0);
    await runtime.db("EventLog").insert({
      date: 1,
      login: "legacy",
      userId: 1,
      ipAddress: "127.0.0.1",
      action: "legacy.event",
      description: "Retained sysPass event",
      level: "INFO",
    });
    expect((await request("/api/v1/events?legacy=true")).value[0].target).toBe(
      "Retained sysPass event",
    );
    expect((await request("/api/v1/events?legacy=false")).response.status).toBe(
      400,
    );
    expect(
      (await request("/api/v1/preferences", "PATCH", { theme: "light" })).value,
    ).toMatchObject({ lang: "en_US", view: "list", theme: "light" });
    expect((await request("/api/v1/auth/policy")).value.minLength).toBe(15);
    expect((await request("/api/v1/notifications")).response.status).toBe(200);
    const [note] = await runtime.db("Notification").insert({
      component: "test",
      description: "synthetic message",
      date: Math.floor(Date.now() / 1000),
      userId: 1,
      onlyAdmin: 0,
      sticky: 0,
      checked: 0,
    });
    expect(
      (await request(`/api/v1/notifications/${note}/read`, "POST", {})).response
        .status,
    ).toBe(204);
    expect(
      (await request("/api/v1/notifications/99999/read", "POST", {})).response
        .status,
    ).toBe(403);
    expect(
      (await request("/api/v1/accounts/1/favorite", "POST", { enabled: "yes" }))
        .response.status,
    ).toBe(400);
    expect(
      (await request("/api/v1/accounts/1/favorite", "POST", { enabled: true }))
        .response.status,
    ).toBe(204);
    expect(
      (await request("/api/v1/accounts/1/permissions")).response.status,
    ).toBe(200);
    expect(
      (
        await request("/api/v1/accounts/1/permissions", "PUT", {
          users: [],
          groups: [],
        })
      ).response.status,
    ).toBe(204);
    const field = (
      await request("/api/v1/fields", "POST", {
        name: "Reference",
        moduleId: 10,
        typeId: 1,
        isEncrypted: false,
      })
    ).value;
    expect(field.id).toBeGreaterThan(0);
    expect(
      (
        await request(`/api/v1/accounts/1/fields/${field.id}`, "PUT", {
          value: "synthetic value",
        })
      ).response.status,
    ).toBe(204);
    expect((await request("/api/v1/accounts/1/fields")).value[0].value).toBe(
      "synthetic value",
    );
    expect(
      (
        await request(
          `/api/v1/accounts/1/fields/${field.id}/secret`,
          "POST",
          {},
        )
      ).value.value,
    ).toBe("synthetic value");
    const history = (await request("/api/v1/accounts/1/history")).value;
    expect(history).toHaveLength(1);
    expect(
      (
        await request(
          `/api/v1/accounts/1/history/${history[0].id}/secret`,
          "POST",
          {},
        )
      ).value.password,
    ).toBe("synthetic account secret");
    expect(
      (
        await request(
          `/api/v1/accounts/1/history/${history[0].id}/restore`,
          "POST",
          { version: 2 },
        )
      ).response.status,
    ).toBe(200);
    expect(
      (
        await request("/api/v1/accounts/1/password", "POST", {
          password: "new synthetic secret",
          version: 3,
        })
      ).response.status,
    ).toBe(200);
    const file = (
      await request("/api/v1/accounts/1/files", "POST", {
        name: "test.txt",
        content: Buffer.from("synthetic bytes").toString("base64"),
      })
    ).value;
    expect((await request("/api/v1/accounts/1/files")).value).toHaveLength(1);
    const binary = await fetch(`${base}/api/v1/files/${file.id}`, {
      headers: { cookie },
    });
    expect(binary.headers.get("content-disposition")).toContain("attachment");
    expect(await binary.text()).toBe("synthetic bytes");
    expect(
      (await request(`/api/v1/files/${file.id}`, "DELETE")).response.status,
    ).toBe(204);
    const link = (
      await request("/api/v1/accounts/1/links", "POST", {
        views: 1,
        seconds: 60,
      })
    ).value;
    expect((await request("/api/v1/accounts/1/links")).value).toHaveLength(1);
    expect(
      (await request(`/api/v1/public/${link.hash}/reveal`, "POST", {})).value
        .password,
    ).toBe("new synthetic secret");
    expect(
      (await request(`/api/v1/links/${link.id}`, "DELETE")).response.status,
    ).toBe(204);
    for (const name of ["smtp", "syslog", "wiki", "directory", "sso"])
      expect(
        (await request(`/api/v1/integrations/${name}`)).response.status,
      ).toBe(200);
    expect(
      (await request("/api/v1/integrations/smtp", "PATCH", { enabled: false }))
        .response.status,
    ).toBe(204);
    expect(
      (await request("/api/v1/integrations/smtp/test", "POST", {})).response
        .status,
    ).toBe(200);
    expect(
      (await request("/api/v1/wiki", "POST", { method: "unsafe", query: "x" }))
        .response.status,
    ).toBe(400);
    const preview = (
      await request("/api/v1/import/preview", "POST", {
        format: "csv",
        source: "name,password\nFrom HTTP,synthetic",
      })
    ).value;
    expect(preview.count).toBe(1);
    expect(
      (
        await request("/api/v1/import/commit", "POST", {
          challenge: preview.challenge,
          categoryId: 1,
          clientId: 1,
          userGroupId: 1,
        })
      ).value.count,
    ).toBe(1);
    const exported = await fetch(`${base}/api/v1/export`, {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ format: "csv", cleartext: true }),
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain(".csv");
    expect(await exported.text()).toContain("From HTTP");
    expect(
      (await request("/api/v1/token-scopes")).value.length,
    ).toBeGreaterThan(10);
    const issued = await request("/api/v1/tokens", "POST", {
      methods: ["account/search"],
      expiresAt: Date.now() + 3600000,
    });
    expect(issued.value.token).toBeTypeOf("string");
    const tokens = (await request("/api/v1/tokens")).value;
    expect(tokens).toHaveLength(1);
    expect(
      (await request(`/api/v1/tokens/${tokens[0].id}`, "DELETE")).response
        .status,
    ).toBe(204);
    expect(
      (
        await request("/api.php", "POST", {
          jsonrpc: "2.0",
          id: 1,
          method: "unknown",
          params: {},
        })
      ).value.error.code,
    ).toBe(-32601);
    const preset = (
      await request("/api/v1/presets", "POST", {
        type: "account.private",
        userId: null,
        userGroupId: null,
        userProfileId: null,
        fixed: false,
        priority: 1,
        data: { privateUser: false },
      })
    ).value;
    expect((await request("/api/v1/presets?all=true")).value).toHaveLength(1);
    expect(
      (
        await request(`/api/v1/presets/${preset.id}`, "PATCH", {
          type: "account.private",
          userId: null,
          userGroupId: null,
          userProfileId: null,
          fixed: false,
          priority: 2,
          data: { privateUser: false },
        })
      ).response.status,
    ).toBe(200);
    expect(
      (await request(`/api/v1/presets/${preset.id}`, "DELETE")).response.status,
    ).toBe(204);
    const backup = (await request("/api/v1/backups", "POST", {})).value;
    const saved = await fetch(`${base}/api/v1/backups/${backup.name}`, {
      headers: { cookie },
    });
    expect(saved.status).toBe(200);
    expect(
      Buffer.from(await saved.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe("NPB1");
    expect((await request("/api/v1/backups/unsafe")).response.status).toBe(400);
  });
  it("resolves activity user logins without confusing other IDs or exposing user records", async () => {
    const profile = (
      await request("/api/v1/profiles", "POST", {
        name: "Activity reader",
        profile: { evl: true },
      })
    ).value;
    const user = (
      await request("/api/v1/users", "POST", {
        name: "Activity display name",
        login: "activity.reader",
        password,
        userGroupId: 1,
        userProfileId: profile.id,
      })
    ).value;
    expect(user.id).toBeGreaterThan(1);
    const fixtures = [
      ["users.edit", String(user.id)],
      ["users.role.app.0_to_1", String(user.id)],
      ["token.create", String(user.id)],
      ["auth.emergency.recovery", String(user.id)],
      ["account.edit", String(user.id)],
      ["accounts.export", String(user.id)],
      ["token.revoke", String(user.id)],
      ["users.edit", "99998"],
      ["users.edit", `${user.id}suffix`],
      ["users.edit", "9007199254740993"],
      ["auth.login", null],
    ].map(([action, target], index) => ({
      id: 50000 + index,
      date: new Date(),
      action,
      target,
      userId: index === 7 ? 99999 : index === 10 ? null : 1,
    }));
    await runtime.db("nodepass_audit").insert(fixtures);
    const response = await request("/api/v1/events");
    expect(response.response.status).toBe(200);
    const rows = response.value.filter((row: any) => row.id >= 50000);
    expect(rows.map((row: any) => row.id)).toEqual(
      fixtures.map((row) => row.id).reverse(),
    );
    for (const fixture of fixtures) {
      const row = rows.find((row: any) => row.id === fixture.id);
      expect(row).toMatchObject({
        action: fixture.action,
        userId: fixture.userId,
        target: fixture.target,
        userLogin: fixture.userId === 1 ? "admin" : null,
        targetUserLogin: fixture.id < 50004 ? "activity.reader" : null,
      });
      expect(Object.keys(row).sort()).toEqual(
        [
          "id",
          "date",
          "action",
          "userId",
          "target",
          "userLogin",
          "targetUserLogin",
        ].sort(),
      );
    }
    await runtime
      .db("User")
      .where({ id: user.id })
      .update({ login: "renamed.reader" });
    expect(
      (await request("/api/v1/events")).value.find(
        (row: any) => row.id === 50000,
      ),
    ).toMatchObject({
      target: String(user.id),
      targetUserLogin: "renamed.reader",
    });
    await runtime.db("EventLog").insert([
      {
        date: 1,
        login: "historical.reader",
        userId: 65000,
        ipAddress: "127.0.0.1",
        action: "legacy.event",
        description: String(user.id),
        level: "INFO",
      },
      {
        date: 2,
        login: null,
        userId: 1,
        ipAddress: "127.0.0.1",
        action: "legacy.event",
        description: "Synthetic legacy details",
        level: "INFO",
      },
    ]);
    const legacy = (await request("/api/v1/events?legacy=true")).value;
    expect(legacy[0]).toMatchObject({
      userId: 1,
      userLogin: "admin",
      targetUserLogin: null,
    });
    expect(legacy[1]).toMatchObject({
      userId: 65000,
      userLogin: "historical.reader",
      target: String(user.id),
      targetUserLogin: null,
    });
    let raw = "";
    const issueReader = async () =>
      runtime.auth.issue(
        {
          cookies: {
            get: () => undefined,
            set: (_key: string, value: string) => {
              raw = value;
            },
          },
        } as unknown as Context,
        // Resolve the current profile afresh after a permission change.
        await runtime.auth.user(user.id),
        true,
      );
    const reader = await issueReader();
    for (const path of ["/api/v1/events", "/api/v1/events?legacy=true"])
      expect(
        (await request(path, "GET", undefined, { cookie: `nodepass=${raw}` }))
          .response.status,
      ).toBe(200);
    const denied = await request(
      "/api/v1/users",
      "POST",
      {},
      {
        cookie: `nodepass=${raw}`,
        "x-csrf-token": reader.session.csrf,
      },
    );
    expect(denied.response.status).toBe(403);
    expect(denied.value.message).toBe("Management permission required");
    expect(
      (await request("/api/v1/events", "GET", undefined, { cookie: "" }))
        .response.status,
    ).toBe(401);
    expect(
      (
        await request(`/api/v1/profiles/${profile.id}`, "PATCH", {
          name: "Activity reader",
          profile: {},
        })
      ).response.status,
    ).toBe(200);
    await issueReader();
    for (const path of ["/api/v1/events", "/api/v1/events?legacy=true"])
      expect(
        (await request(path, "GET", undefined, { cookie: `nodepass=${raw}` }))
          .response.status,
      ).toBe(403);
  });
  it("supports actual 3.2.11 custom-field modules, historical IDs and independent secret permissions", async () => {
    const issued = await request("/api/v1/tokens", "POST", {
      methods: ["account/search"],
      expiresAt: Date.now() + 3600000,
    });
    expect(issued.response.status).toBe(200);
    const token = (await runtime.db("AuthToken").first()).id;
    for (const module of [1, 101, 301, 701, 801, 901, 1001]) {
      const id = module === 1001 ? token : 1,
        field = (
          await request("/api/v1/fields", "POST", {
            name: "Module " + module,
            moduleId: module,
            typeId: 2,
            isEncrypted: module !== 101,
          })
        ).value;
      expect(field.id).toBeGreaterThan(0);
      expect(
        (
          await request(
            `/api/v1/items/${module}/${id}/fields/${field.id}`,
            "PUT",
            { value: "synthetic field secret" },
          )
        ).response.status,
      ).toBe(204);
      expect(
        (await request(`/api/v1/items/${module}/${id}/fields`)).value.find(
          (f: any) => f.id === field.id,
        ).value,
      ).toBe("");
      expect(
        (
          await request(
            `/api/v1/items/${module}/${id}/fields/${field.id}/secret`,
            "POST",
            {},
          )
        ).value.value,
      ).toBe("synthetic field secret");
    }
    expect(
      (await request("/api/v1/items/10/1/fields")).value.some(
        (f: any) => f.name === "Module 1",
      ),
    ).toBe(true);
    expect((await request("/api/v1/items/63/1/fields")).response.status).toBe(
      400,
    );
    const categoryField = (await request("/api/v1/items/101/1/fields"))
      .value[0];
    const profile = (
      await request("/api/v1/profiles", "POST", {
        name: "Field manager",
        profile: { mgmCategories: true, mgmUsers: true, accView: true },
      })
    ).value;
    const managed = (
      await request("/api/v1/users", "POST", {
        name: "Field manager",
        login: "field-manager",
        password,
        userGroupId: 1,
        userProfileId: profile.id,
      })
    ).value;
    const rootCookie = cookie,
      rootCsrf = csrf;
    try {
      cookie = "";
      csrf = "";
      expect(
        (
          await request("/api/v1/auth/login", "POST", {
            login: "field-manager",
            password,
          })
        ).value.phase,
      ).toBe("ready");
      expect(
        (await request("/api/v1/items/101/1/fields")).response.status,
      ).toBe(200);
      expect(
        (
          await request(
            `/api/v1/items/101/1/fields/${categoryField.id}/secret`,
            "POST",
            {},
          )
        ).response.status,
      ).toBe(403);
      expect(
        (
          await request(
            `/api/v1/items/101/1/fields/${categoryField.id}`,
            "PUT",
            { value: "forbidden" },
          )
        ).response.status,
      ).toBe(403);
      expect(
        (
          await request(
            "/api/v1/items/701/1/fields/" + categoryField.id,
            "PUT",
            { value: "forbidden" },
          )
        ).response.status,
      ).toBe(403);
      expect(
        (await request("/api/v1/items/1001/" + token + "/fields")).response
          .status,
      ).toBe(403);
    } finally {
      cookie = rootCookie;
      csrf = rootCsrf;
    }
    for (const [type, valid, invalid] of [
      [3, "2026-10-23", "2026-02-30"],
      [4, "-12.5e2", "NaN"],
      [5, "ops@example.test", "missing-at"],
      [7, "https://example.test/path", "javascript:alert(1)"],
      [8, "#087f82", "red"],
    ] as const) {
      const field = (
        await request("/api/v1/fields", "POST", {
          name: "Typed " + type,
          moduleId: 101,
          typeId: type,
          isEncrypted: false,
        })
      ).value;
      expect(
        (
          await request(`/api/v1/items/101/1/fields/${field.id}`, "PUT", {
            value: invalid,
          })
        ).response.status,
      ).toBe(400);
      expect(
        (
          await request(`/api/v1/items/101/1/fields/${field.id}`, "PUT", {
            value: valid,
          })
        ).response.status,
      ).toBe(204);
      expect(
        (
          await request(
            `/api/v1/items/101/1/fields/${field.id}/secret`,
            "POST",
            {},
          )
        ).value.value,
      ).toBe(valid);
    }
    const plain = (
      await request("/api/v1/fields", "POST", {
        name: "Historical empty key",
        moduleId: 61,
        typeId: 1,
        isEncrypted: false,
      })
    ).value;
    await runtime.db("CustomFieldData").insert({
      moduleId: 61,
      itemId: 1,
      definitionId: plain.id,
      data: "legacy plain value",
      key: Buffer.alloc(0),
    });
    expect(
      (
        await request(
          `/api/v1/items/101/1/fields/${plain.id}/secret`,
          "POST",
          {},
        )
      ).value.value,
    ).toBe("legacy plain value");
    expect(
      (
        await request(`/api/v1/fields/${plain.id}`, "PATCH", {
          name: "Historical empty key",
          moduleId: 61,
          typeId: 1,
          isEncrypted: true,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await request("/api/v1/items/101/1/fields/999999", "PUT", {
          value: "missing",
        })
      ).response.status,
    ).toBe(404);
    expect(
      (await request("/api/v1/items/101/1/fields/999999/secret", "POST", {}))
        .response.status,
    ).toBe(404);
    expect(
      (await request("/api/v1/tokens/" + token, "DELETE")).response.status,
    ).toBe(204);
    expect(
      await runtime
        .db("CustomFieldData")
        .where({ moduleId: 1001, itemId: token }),
    ).toHaveLength(0);
    await runtime
      .db("User")
      .where({ id: managed.id })
      .update({ isDisabled: 1 });
  });
  it("reports empty and populated custom fields without decrypting their secrets", async () => {
    const created = await request("/api/v1/fields", "POST", {
      name: "Optional presence check",
      moduleId: 101,
      typeId: 2,
      isEncrypted: true,
    });
    expect(created.response.status).toBe(201);
    const fieldId = created.value.id;
    const endpoint = "/api/v1/items/101/1/fields";
    const metadata = async () => {
      const response = await request(endpoint);
      expect(response.response.status).toBe(200);
      return response.value.find(
        (field: { id: number }) => field.id === fieldId,
      );
    };
    const decrypt = vi
      .spyOn(runtime.vault, "decrypt")
      .mockRejectedValue(new Error("Listing must not decrypt secrets"));
    try {
      expect(await metadata()).toMatchObject({
        hasValue: false,
        isEncrypted: true,
        value: "",
      });
      expect(
        (await request(`${endpoint}/${fieldId}/secret`, "POST", {})).response
          .status,
      ).toBe(404);
      expect(
        (await request(`${endpoint}/${fieldId}`, "PUT", { value: "0" }))
          .response.status,
      ).toBe(204);
      expect(await metadata()).toMatchObject({ hasValue: true, value: "" });
      expect(
        (await request(`${endpoint}/${fieldId}`, "PUT", { value: "" })).response
          .status,
      ).toBe(204);
      expect(await metadata()).toMatchObject({ hasValue: false, value: "" });
      const row = await runtime
        .db("CustomFieldData")
        .where({ definitionId: fieldId, itemId: 1 })
        .first();
      for (const value of ["", "0", "legacy secret"]) {
        const encrypted = await encryptDefuse(value, "synthetic legacy master");
        await runtime
          .db("CustomFieldData")
          .where({ id: row.id })
          .update({
            data: Buffer.from(encrypted.pass),
            key: Buffer.from(encrypted.key),
          });
        expect(await metadata()).toMatchObject({
          hasValue: !!value,
          value: "",
        });
      }
      // Old installations can contain plain data even for a secret definition.
      for (const value of ["", "0"]) {
        await runtime
          .db("CustomFieldData")
          .where({ id: row.id })
          .update({ data: Buffer.from(value), key: null });
        expect(await metadata()).toMatchObject({
          hasValue: !!value,
          isEncrypted: true,
          value: "",
        });
      }
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
  });
  it("creates bounded audited sharing links after the recent-confirmation window, while retaining it for recovery codes", async () => {
    const session = await runtime
      .db("nodepass_sessions")
      .where({ csrf })
      .first();
    const sessions = () =>
      runtime.db("nodepass_sessions").where({ id: session.id });
    const earlier = Date.now() - 600000;
    await sessions().update({
      createdAt: earlier,
      verifiedAt: earlier,
      lastSeen: Date.now(),
    });
    try {
      const recovery = await request("/api/v1/auth/recovery", "POST", {});
      expect(recovery.response.status).toBe(403);
      expect(recovery.value.message).toBe("Confirm your identity again");
      const auditBefore = await runtime
        .db("nodepass_audit")
        .where({ action: "share.create", userId: 1, target: "1" });
      const created = await request("/api/v1/accounts/1/links", "POST", {
        views: 1,
        seconds: 60,
      });
      expect(created.response.status, JSON.stringify(created.value)).toBe(200);
      expect(created.value).toMatchObject({ maxViews: 1 });
      expect(created.value.expiresAt).toBeGreaterThan(Date.now() / 1000);
      expect(created.value).not.toHaveProperty("password");
      const link = created.value;
      expect(
        (await request(`/api/v1/public/${link.hash}/reveal`, "POST", {})).value
          .password,
      ).toBe("new synthetic secret");
      expect(
        (await request(`/api/v1/public/${link.hash}/reveal`, "POST", {}))
          .response.status,
      ).toBe(404);
      expect((await request("/api/v1/accounts/1/links")).value).toEqual([]);
      expect(
        (await request(`/api/v1/links/${link.id}`, "DELETE")).response.status,
      ).toBe(204);
      expect(
        await runtime
          .db("nodepass_audit")
          .where({ action: "share.create", userId: 1, target: "1" }),
      ).toHaveLength(auditBefore.length + 1);
      const expiring = await request("/api/v1/accounts/1/links", "POST", {
        views: 2,
        seconds: 60,
      });
      expect(expiring.response.status).toBe(200);
      await runtime
        .db("PublicLink")
        .where({ id: expiring.value.id })
        .update({ dateExpire: 0 });
      expect(
        (
          await request(
            `/api/v1/public/${expiring.value.hash}/reveal`,
            "POST",
            {},
          )
        ).response.status,
      ).toBe(404);
      expect((await request("/api/v1/accounts/1/links")).value).toEqual([]);
      const replacement = await request("/api/v1/accounts/1/links", "POST", {
        views: 3,
        seconds: 60,
      });
      expect(replacement.response.status).toBe(200);
      expect(
        (await request(`/api/v1/links/${replacement.value.id}`, "DELETE"))
          .response.status,
      ).toBe(204);
    } finally {
      await sessions().update({
        createdAt: session.createdAt,
        verifiedAt: session.verifiedAt,
        lastSeen: Date.now(),
      });
    }
  });
  it("still rejects sharing without a complete active session, valid CSRF and the expected origin", async () => {
    const session = await runtime
      .db("nodepass_sessions")
      .where({ csrf })
      .first();
    const sessions = () =>
      runtime.db("nodepass_sessions").where({ id: session.id });
    const path = "/api/v1/accounts/1/links",
      data = { views: 1, seconds: 60 };
    try {
      expect(
        (await request(path, "POST", data, { cookie: "" })).response.status,
      ).toBe(401);
      expect(
        (await request(path, "POST", data, { "x-csrf-token": "wrong" }))
          .response.status,
      ).toBe(403);
      expect(
        (
          await request(path, "POST", data, {
            origin: "https://attacker.invalid",
          })
        ).response.status,
      ).toBe(403);
      await sessions().update({ complete: 0, verifiedAt: 0 });
      const pending = await request(path, "POST", data);
      expect(pending.response.status).toBe(403);
      expect(pending.value.message).toBe(
        "Complete multi-factor authentication",
      );
      await sessions().update({
        complete: 1,
        verifiedAt: session.verifiedAt,
        lastSeen: 1,
      });
      expect((await request(path, "POST", data)).response.status).toBe(401);
      await sessions().update({ createdAt: 1, lastSeen: Date.now() });
      expect((await request(path, "POST", data)).response.status).toBe(401);
      expect(await runtime.db("PublicLink").where({ itemId: 1 })).toHaveLength(
        0,
      );
    } finally {
      await sessions().update({
        createdAt: session.createdAt,
        verifiedAt: session.verifiedAt,
        complete: session.complete,
        lastSeen: Date.now(),
      });
    }
  });
  it("requires both sharing and secret permissions and preserves private-account boundaries for ordinary users", async () => {
    const rootCookie = cookie,
      rootCsrf = csrf;
    const privateAccount = await request("/api/v1/accounts", "POST", {
      name: "Private sharing boundary",
      password: "synthetic private secret",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
      isPrivate: true,
    });
    expect(privateAccount.response.status).toBe(201);
    try {
      for (const [login, flags, permitted] of [
        ["share-no-link-right", { accView: true, accViewPass: true }, false],
        [
          "share-no-secret-right",
          { accView: true, accPublicLinks: true },
          false,
        ],
        [
          "share-allowed",
          { accView: true, accViewPass: true, accPublicLinks: true },
          true,
        ],
      ] as const) {
        cookie = rootCookie;
        csrf = rootCsrf;
        const profile = await request("/api/v1/profiles", "POST", {
          name: login,
          profile: flags,
        });
        expect(profile.response.status).toBe(201);
        const user = await request("/api/v1/users", "POST", {
          name: login,
          login,
          password,
          userGroupId: 1,
          userProfileId: profile.value.id,
        });
        expect(user.response.status).toBe(201);
        cookie = "";
        csrf = "";
        const loggedIn = await request("/api/v1/auth/login", "POST", {
          login,
          password,
        });
        expect(loggedIn.value.phase).toBe("ready");
        await runtime
          .db("nodepass_sessions")
          .where({ userId: user.value.id })
          .update({ createdAt: Date.now() - 600000, lastSeen: Date.now() });
        const data = { views: 1, seconds: 60 };
        const created = await request("/api/v1/accounts/1/links", "POST", data);
        expect(created.response.status, JSON.stringify(created.value)).toBe(
          permitted ? 200 : 404,
        );
        if (permitted) {
          expect(
            (await request(`/api/v1/links/${created.value.id}`, "DELETE"))
              .response.status,
          ).toBe(204);
          expect(
            (
              await request(
                `/api/v1/accounts/${privateAccount.value.id}/links`,
                "POST",
                data,
              )
            ).response.status,
          ).toBe(404);
        }
        expect(await runtime.db("PublicLink")).toHaveLength(0);
      }
    } finally {
      cookie = rootCookie;
      csrf = rootCsrf;
    }
  });
  it("restricts update status and acknowledgements to complete app-admin sessions with CSRF and personal state", async () => {
    await runtime.updates.stop();
    const f = updateFixture();
    const source = new UpdateSource(async (url) =>
      String(url).includes("/assets/")
        ? new Response(f.data)
        : new Response(JSON.stringify([f.row])),
    );
    const checked = await source.check(
      "0.1.0-rc.1",
      null,
      {},
      new AbortController().signal,
    );
    await putSetting(
      runtime.db,
      "updates/history",
      await refreshReleaseHistory(
        source,
        "0.1.0-rc.1",
        checked.cache,
        null,
        checked.latest,
        10 - checked.manifestFetches,
        new AbortController().signal,
        Date.now,
      ),
    );
    await putSetting(runtime.db, "updates/state", {
      lastAttemptAt: Date.now(),
      lastSuccessAt: Date.now(),
      nextCheckAt: Date.now() + 3600000,
      error: null,
      latest: checked.latest,
      cache: checked.cache,
    });
    const status = await request("/api/v1/updates");
    expect(status.response.status).toBe(200);
    const history = await request("/api/v1/updates/releases");
    expect(history.response.status).toBe(200);
    expect(history.value).toMatchObject({
      installedVersion: version,
      latestVersion: "0.3.0",
      releases: [
        { version: "0.3.0", notesStatus: "verified", notes: f.row.body },
      ],
    });
    expect(
      (
        await request("/api/v1/updates/releases", "GET", undefined, {
          cookie: "",
        })
      ).response.status,
    ).toBe(401);
    expect(status.value.available).toMatchObject({
      critical: true,
      acknowledged: false,
    });
    const data = { id: status.value.available.id };
    expect(
      (await request("/api/v1/updates", "GET", undefined, { cookie: "" }))
        .response.status,
    ).toBe(401);
    expect(
      (
        await request("/api/v1/updates/acknowledgement", "POST", data, {
          "x-csrf-token": "wrong",
        })
      ).response.status,
    ).toBe(403);
    expect(
      (
        await request("/api/v1/updates/acknowledgement", "POST", data, {
          origin: "https://evil.test",
        })
      ).response.status,
    ).toBe(403);
    expect(
      (
        await request("/api/v1/updates/acknowledgement", "POST", {
          id: "invalid",
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await request("/api/v1/updates/acknowledgement", "POST", {
          id: "0".repeat(64),
        })
      ).response.status,
    ).toBe(409);
    const session = await runtime
      .db("nodepass_sessions")
      .where({ csrf })
      .first();
    try {
      await runtime
        .db("nodepass_sessions")
        .where({ id: session.id })
        .update({ complete: 0 });
      expect((await request("/api/v1/updates")).response.status).toBe(403);
      expect((await request("/api/v1/updates/releases")).response.status).toBe(
        403,
      );
      await runtime
        .db("nodepass_sessions")
        .where({ id: session.id })
        .update({ complete: 1 });
      for (const isAdminAcc of [0, 1]) {
        await runtime
          .db("User")
          .where({ id: 1 })
          .update({ isAdminApp: 0, isAdminAcc });
        expect((await request("/api/v1/updates")).response.status).toBe(403);
        expect(
          (await request("/api/v1/updates/releases")).response.status,
        ).toBe(403);
        expect(
          (await request("/api/v1/updates/acknowledgement", "POST", data))
            .response.status,
        ).toBe(403);
      }
    } finally {
      await runtime
        .db("User")
        .where({ id: 1 })
        .update({ isAdminApp: 1, isAdminAcc: 0 });
      await runtime
        .db("nodepass_sessions")
        .where({ id: session.id })
        .update({ complete: 1 });
    }
    expect(
      (await request("/api/v1/updates/acknowledgement", "POST", data)).response
        .status,
    ).toBe(204);
    expect(
      (await request("/api/v1/updates")).value.available.acknowledged,
    ).toBe(true);
    expect(await runtime.updates.status(999)).toMatchObject({
      available: { acknowledged: false },
    });
  });
  it("changes passwords through a fresh confirmation and revokes every old session", async () => {
    expect(
      (
        await request("/api/v1/auth/password", "POST", {
          current: "wrong",
          password,
        })
      ).response.status,
    ).toBe(403);
    expect(
      (
        await request("/api/v1/auth/password", "POST", {
          current: password,
          password: "short",
        })
      ).response.status,
    ).toBe(400);
    const next = "amber violin telescope mountain 756!";
    expect(
      (
        await request("/api/v1/auth/password", "POST", {
          current: password,
          password: next,
        })
      ).response.status,
    ).toBe(204);
    expect((await request("/api/v1/auth/session")).response.status).toBe(401);
    expect(
      (
        await request("/api/v1/auth/login", "POST", {
          login: "admin",
          password: next,
        })
      ).value.phase,
    ).toBe("verify");
    const factor = await runtime
        .db("nodepass_factors")
        .where({ kind: "totp" })
        .first(),
      secret = runtime.vault
        .unwrap(Buffer.from(factor.data, "base64"), "totp/1")
        .toString();
    await runtime
      .db("nodepass_factors")
      .where({ id: factor.id })
      .update({ counter: 0 });
    const otp = new OTPAuth.TOTP({ secret });
    expect(
      (
        await request("/api/v1/auth/totp/verify", "POST", {
          code: otp.generate(),
        })
      ).value.phase,
    ).toBe("ready");
    expect(
      (await request("/api/v1/auth/logout", "POST", {})).response.status,
    ).toBe(204);
    expect((await request("/api/v1/accounts")).response.status).toBe(401);
  });
});
