import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { once } from "node:events";
import { harness, testPassword } from "./harness.js";
import { serializePhp } from "./serialization.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import {
  userManagement,
  lockUserManagement,
  managementParams,
} from "../packages/server/src/services/user-management.js";
import { verifyPassword } from "../packages/server/src/security/password.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";
import { Fields } from "../packages/server/src/services/fields.js";
import type { Context } from "koa";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "atomic user management and explicit password reset permission",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      users: Catalogue,
      profiles: Catalogue;
    let readerId: number,
      managerId: number,
      readerProfile: number,
      managerProfile: number;
    const readerData = () => ({
      name: "Scoped reader",
      login: "scoped.reader",
      userGroupId: 1,
      userProfileId: readerProfile,
    });
    const managerRights = {
      mgmUsers: true,
      mgmUsersResetPassword: true,
      accView: true,
    };
    beforeAll(async () => {
      r = await harness();
      users = new Catalogue(r.db, "users", r.auth);
      profiles = new Catalogue(r.db, "profiles", r.auth);
      const root = await r.params();
      readerProfile = (
        await profiles.create(
          { name: "Scoped reader", profile: { accView: true } },
          root,
        )
      ).id;
      managerProfile = (
        await profiles.create(
          { name: "Scoped manager", profile: managerRights },
          root,
        )
      ).id;
      readerId = (
        await users.create({ ...readerData(), password: testPassword }, root)
      ).id;
      managerId = (
        await users.create(
          {
            name: "Manager",
            login: "scoped.manager",
            userGroupId: 1,
            userProfileId: managerProfile,
            password: testPassword,
          },
          root,
        )
      ).id;
      await r.db("UserGroup").insert({ id: 2, name: "Outside scope" });
    });
    afterAll(async () => {
      await r?.dispose();
    });
    beforeEach(async () => {
      vi.restoreAllMocks();
      await r.db("User").where({ id: readerId }).update({
        isAdminApp: 0,
        isAdminAcc: 0,
        isDisabled: 0,
        userGroupId: 1,
        userProfileId: readerProfile,
      });
      await r.db("User").where({ id: managerId }).update({ isDisabled: 0 });
      await r
        .db("UserToUserGroup")
        .whereIn("userId", [readerId, managerId])
        .delete();
      await r
        .db("UserProfile")
        .where({ id: readerProfile })
        .update({ profile: 'NPJ1:{"accView":true}' });
      await r
        .db("UserProfile")
        .where({ id: managerProfile })
        .update({ profile: `NPJ1:${JSON.stringify(managerRights)}` });
      await r.db("nodepass_audit").delete();
    });
    it.each([
      serializePhp({ mgmUsers: 1, accView: 1 }),
      'NPJ1:{"mgmUsers":true,"accView":true}',
    ])(
      "does not infer reset permission from existing or imported profiles: %s",
      async (profile) => {
        await r
          .db("UserProfile")
          .where({ id: managerProfile })
          .update({ profile });
        const manager = await r.params(managerId);
        expect((await users.get(readerId, manager)).management).toEqual({
          canEdit: true,
          canResetPassword: false,
        });
        await users.patch(readerId, readerData(), manager);
        const before = await r.db("User").where({ id: readerId }).first();
        await expect(
          users.patch(
            readerId,
            { ...readerData(), password: testPassword },
            manager,
          ),
        ).rejects.toThrow("Password reset permission");
        expect(
          (await r.db("User").where({ id: readerId }).first()).pass,
        ).toEqual(before.pass);
        expect(
          await r
            .db("nodepass_audit")
            .where({ action: "users.password.reset" }),
        ).toHaveLength(0);
        const created = await users.create(
          {
            name: "New user",
            login: `new.${Date.now()}`,
            userGroupId: 1,
            userProfileId: readerProfile,
            password: testPassword,
          },
          manager,
        );
        expect(created.isAdminApp).toBe(0);
        expect(
          (await r.db("UserProfile").where({ id: managerProfile }).first())
            .profile,
        ).toEqual(Buffer.from(profile));
      },
    );
    it("requires both rights and preserves all target boundaries for resets", async () => {
      const manager = await r.params(managerId);
      await users.patch(
        readerId,
        { ...readerData(), password: testPassword },
        manager,
      );
      expect(
        (await users.get(readerId, manager)).management.canResetPassword,
      ).toBe(true);
      await r
        .db("UserProfile")
        .where({ id: managerProfile })
        .update({ profile: 'NPJ1:{"mgmUsersResetPassword":true}' });
      await expect(
        users.patch(
          readerId,
          { ...readerData(), password: testPassword },
          await r.params(managerId),
        ),
      ).rejects.toThrow("permission");
      await r
        .db("UserProfile")
        .where({ id: managerProfile })
        .update({ profile: `NPJ1:${JSON.stringify(managerRights)}` });
      for (const key of ["isAdminApp", "isAdminAcc"])
        for (const value of [true, false])
          await expect(
            users.patch(readerId, { ...readerData(), [key]: value }, manager),
          ).rejects.toThrow("Administrator");
      await expect(
        users.patch(
          managerId,
          {
            ...readerData(),
            login: "scoped.manager",
            userProfileId: managerProfile,
          },
          manager,
        ),
      ).rejects.toThrow("privilege");
    });
    it("returns consistent edit reasons without disclosing metadata to ordinary viewers", async () => {
      const manager = await r.params(managerId);
      const expected: [Record<string, unknown>, string][] = [
        [{ isAdminApp: 1 }, "administrator"],
        [{ isAdminAcc: 1 }, "administrator"],
        [{ userGroupId: 2 }, "groups"],
      ];
      for (const [change, reason] of expected) {
        await r
          .db("User")
          .where({ id: readerId })
          .update({ isAdminApp: 0, isAdminAcc: 0, userGroupId: 1, ...change });
        expect((await users.get(readerId, manager)).management).toEqual({
          canEdit: false,
          canResetPassword: false,
          reason,
        });
        await expect(
          users.patch(readerId, readerData(), manager),
        ).rejects.toThrow();
      }
      await r
        .db("User")
        .where({ id: readerId })
        .update({ isAdminApp: 0, isAdminAcc: 0, userGroupId: 1 });
      await r
        .db("UserProfile")
        .where({ id: readerProfile })
        .update({ profile: 'NPJ1:{"configBackup":true}' });
      expect(
        (await users.find(manager)).find((row) => row.id === readerId)
          .management.reason,
      ).toBe("profile");
      expect((await users.get(managerId, manager)).management.reason).toBe(
        "self",
      );
      expect(
        await users.get(managerId, await r.params(readerId)),
      ).not.toHaveProperty("management");
      expect(
        userManagement(
          { ...manager.identity!.user, profile: {} },
          { id: readerId, userGroupId: 1, groups: [] },
          {},
        ).reason,
      ).toBe("permission");
    });
    it.each([
      "promotion",
      "groups",
      "target profile",
      "requested profile",
      "actor rights",
    ])(
      "rejects a password write after a concurrent %s change",
      async (kind) => {
        const manager = await r.params(managerId),
          root = await r.params();
        const requestedProfile =
          kind === "requested profile"
            ? (
                await profiles.create(
                  { name: "Requested profile", profile: { accView: true } },
                  root,
                )
              ).id
            : readerProfile;
        let reached!: () => void, release!: () => void;
        const ready = new Promise<void>((resolve) => (reached = resolve)),
          gate = new Promise<void>((resolve) => (release = resolve));
        const policy = r.auth.policy.bind(r.auth);
        vi.spyOn(r.auth, "policy").mockImplementationOnce(async () => {
          reached();
          await gate;
          return policy();
        });
        const pending = users.patch(
          readerId,
          {
            ...readerData(),
            userProfileId: requestedProfile,
            password: testPassword,
          },
          manager,
        );
        const rejected = expect(pending).rejects.toThrow(
          /Administrator|another group|greater|permission/,
        );
        await ready;
        if (kind === "promotion")
          await users.patch(
            readerId,
            { ...readerData(), isAdminApp: true },
            root,
          );
        if (kind === "groups")
          await users.patch(readerId, { ...readerData(), groups: [2] }, root);
        if (kind === "target profile" || kind === "requested profile")
          await profiles.patch(
            kind === "requested profile" ? requestedProfile : readerProfile,
            {
              name: "Now privileged",
              profile: { accView: true, configBackup: true },
            },
            root,
          );
        if (kind === "actor rights")
          await profiles.patch(
            managerProfile,
            { name: "Revoked manager", profile: { accView: true } },
            root,
          );
        const before = await r.db("User").where({ id: readerId }).first();
        const auditBefore = await r.db("nodepass_audit").orderBy("id");
        release();
        await rejected;
        expect(
          (await r.db("User").where({ id: readerId }).first()).pass,
        ).toEqual(before.pass);
        expect(await r.db("nodepass_audit").orderBy("id")).toEqual(auditBefore);
      },
    );
    it("records exact role transitions and resets without secrets, and rejects the last admin removal", async () => {
      const root = await r.params();
      await users.patch(
        readerId,
        { ...readerData(), isAdminApp: true, isAdminAcc: true },
        root,
      );
      await users.patch(
        readerId,
        { ...readerData(), isAdminApp: true, isAdminAcc: true },
        root,
      );
      await users.patch(
        readerId,
        {
          ...readerData(),
          isAdminApp: false,
          isAdminAcc: false,
          password: testPassword,
        },
        root,
      );
      const audit = await r.db("nodepass_audit").orderBy("id");
      expect(
        audit
          .filter((row) => row.action.startsWith("users.role"))
          .map((row) => row.action),
      ).toEqual([
        "users.role.app.0_to_1",
        "users.role.account.0_to_1",
        "users.role.app.1_to_0",
        "users.role.account.1_to_0",
      ]);
      expect(
        audit.filter((row) => row.action === "users.password.reset"),
      ).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(testPassword);
      expect(JSON.stringify(audit)).not.toContain("argon2");
      for (const change of [{ isAdminApp: false }, { isDisabled: true }])
        await expect(
          users.patch(
            1,
            {
              name: "Test admin",
              login: "admin",
              userGroupId: 1,
              userProfileId: 1,
              ...change,
            },
            root,
          ),
        ).rejects.toThrow("last");
    });
    it("requires recent confirmation only for effective sensitive changes", async () => {
      const root = await r.params();
      await r
        .db("nodepass_sessions")
        .where({ id: root.identity!.session.id })
        .update({ verifiedAt: Date.now() - 301000 });
      await users.patch(
        readerId,
        { ...readerData(), isAdminApp: false, isDisabled: false, groups: [] },
        root,
      );
      for (const change of [
        { password: testPassword },
        { isAdminAcc: true },
        { isDisabled: true },
        { userGroupId: 2 },
        { groups: [2] },
        { userProfileId: managerProfile },
      ])
        await expect(
          users.patch(readerId, { ...readerData(), ...change }, root),
        ).rejects.toMatchObject({
          data: { code: "REAUTHENTICATION_REQUIRED" },
        });
      await expect(
        profiles.patch(readerProfile, { name: "Change", profile: {} }, root),
      ).rejects.toMatchObject({ data: { code: "REAUTHENTICATION_REQUIRED" } });
      expect(await r.db("nodepass_audit")).toHaveLength(1);
    });
    it.each(["revoked", "incomplete", "idle", "absolute", "disabled", "mfa"])(
      "rejects a %s actor session during the transaction",
      async (kind) => {
        const root = await r.params();
        const id = root.identity!.session.id;
        if (kind === "revoked")
          await r.db("nodepass_sessions").where({ id }).delete();
        if (kind === "incomplete")
          await r.db("nodepass_sessions").where({ id }).update({ complete: 0 });
        if (kind === "idle")
          await r.db("nodepass_sessions").where({ id }).update({ lastSeen: 1 });
        if (kind === "absolute")
          await r
            .db("nodepass_sessions")
            .where({ id })
            .update({ createdAt: 1 });
        if (kind === "disabled")
          await r.db("User").where({ id: 1 }).update({ isDisabled: 1 });
        if (kind === "mfa")
          await r
            .db("nodepass_sessions")
            .where({ id })
            .update({ verifiedAt: 0 });
        try {
          await expect(
            users.patch(readerId, readerData(), root),
          ).rejects.toThrow(/Session|Authentication|multi-factor/);
        } finally {
          await r.db("User").where({ id: 1 }).update({ isDisabled: 0 });
        }
        expect(await r.db("nodepass_audit")).toHaveLength(0);
      },
    );
    it("serializes competing last-admin demotions", async () => {
      const root = await r.params();
      await users.patch(readerId, { ...readerData(), isAdminApp: true }, root);
      const second = await r.params(readerId);
      const results = await Promise.allSettled([
        users.patch(
          1,
          {
            name: "Test admin",
            login: "admin",
            userGroupId: 1,
            userProfileId: 1,
            isAdminApp: false,
          },
          root,
        ),
        users.patch(readerId, { ...readerData(), isAdminApp: false }, second),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        await r.db("User").where({ isAdminApp: 1, isDisabled: 0 }),
      ).toHaveLength(1);
      await r.db("User").where({ id: 1 }).update({ isAdminApp: 1 });
    });
    it("rechecks custom-field writes under the same management lock", async () => {
      const root = await r.params(),
        manager = await r.params(managerId);
      const definition = await new Catalogue(r.db, "fields", r.auth).create(
        { name: "User note", moduleId: 701, typeId: 1 },
        root,
      );
      let reached!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => (reached = resolve)),
        gate = new Promise<void>((resolve) => (release = resolve));
      const fields = new Fields(
        r.db,
        r.vault,
        async (_module, id, p, action, transaction) => {
          const db = transaction ?? r.db;
          const current = transaction
            ? await managementParams(db, r.auth, p)
            : p;
          await new Catalogue(db, "users", r.auth).fieldAccess(
            id,
            current,
            action === "edit" || action === "editSecret",
          );
          if (!transaction) {
            reached();
            await gate;
          }
        },
      );
      const pending = fields.set(
        701,
        readerId,
        definition.id,
        "blocked",
        manager,
      );
      const rejected = expect(pending).rejects.toThrow("Administrator");
      await ready;
      await users.patch(readerId, { ...readerData(), isAdminApp: true }, root);
      release();
      await rejected;
      expect(
        await r.db("CustomFieldData").where({ definitionId: definition.id }),
      ).toHaveLength(0);
      await fields.set(701, readerId, definition.id, "allowed", root);
      await r.db.transaction(async (trx) => {
        await lockUserManagement(trx);
        expect(
          (await managementParams(trx, r.auth, root)).identity!.user.isAdminApp,
        ).toBe(1);
      });
    });
    it("checks a newly prepared password against the current policy before writing", async () => {
      const manager = await r.params(managerId);
      const replacement = "synthetic telescope copper valley 418!";
      await users.patch(
        readerId,
        { ...readerData(), password: replacement },
        manager,
      );
      const row = await r.db("User").where({ id: readerId }).first();
      expect(
        await verifyPassword(replacement, Buffer.from(row.pass).toString()),
      ).toBe(true);
    });
  },
);

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "user management confirmation over HTTP",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      http: Awaited<ReturnType<typeof createApp>>,
      server: Awaited<ReturnType<typeof http.app.listen>>;
    let base: string, raw: string, csrf: string, id: string, target: number;
    const data = () => ({
      name: "HTTP reader",
      login: "http.reader",
      userGroupId: 1,
      userProfileId: 1,
    });
    const request = async (
      path: string,
      method: string,
      value: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(`${base}/api/v1/${path}`, {
        method,
        headers: {
          origin: r.config.publicUrl,
          "content-type": "application/json",
          cookie: `nodepass=${raw}`,
          "x-csrf-token": csrf,
          ...headers,
        },
        body: JSON.stringify(value),
      });
      return { status: response.status, value: await response.json() };
    };
    beforeAll(async () => {
      r = await harness();
      target = (
        await new Catalogue(r.db, "users", r.auth).create(
          { ...data(), password: testPassword },
          await r.params(),
        )
      ).id;
      http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await http.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test listener");
      base = `http://127.0.0.1:${address.port}`;
      const identity = await r.auth.issue(
        {
          cookies: {
            get: () => undefined,
            set: (_key: string, value: string) => (raw = value),
          },
        } as unknown as Context,
        await r.auth.user(1),
        true,
      );
      id = identity.session.id;
      csrf = identity.session.csrf;
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await http?.close();
      await r?.dispose();
    });
    it("rejects an old confirmation without changes, then accepts the same body after confirmation", async () => {
      await r
        .db("nodepass_sessions")
        .where({ id })
        .update({ verifiedAt: Date.now() - 600000 });
      const body = { ...data(), isAdminAcc: true };
      expect(await request(`users/${target}`, "PATCH", body)).toMatchObject({
        status: 403,
        value: { code: "REAUTHENTICATION_REQUIRED" },
      });
      expect(
        (await r.db("User").where({ id: target }).first()).isAdminAcc,
      ).toBe(0);
      expect(
        (
          await request(
            "auth/confirm",
            "POST",
            { password: testPassword },
            { "x-csrf-token": "wrong" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request("auth/confirm", "POST", {
            password: "synthetic wrong password",
          })
        ).status,
      ).toBe(403);
      expect(
        (await request("auth/confirm", "POST", { password: testPassword }))
          .status,
      ).toBe(200);
      expect((await request(`users/${target}`, "PATCH", body)).status).toBe(
        200,
      );
      await r.db("nodepass_sessions").where({ id }).update({ complete: 0 });
      expect((await request(`users/${target}`, "PATCH", body)).status).toBe(
        403,
      );
    });
  },
);
