import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context } from "koa";
import { once } from "node:events";
import { harness, testPassword } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import * as database from "../packages/server/src/db.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "user edits and active HTTP sessions",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    let http: Awaited<ReturnType<typeof createApp>>;
    let server: Awaited<
      ReturnType<Awaited<ReturnType<typeof harness>>["app"]["listen"]>
    >;
    let base: string;
    let users: Catalogue;
    let profiles: Catalogue;
    let target: number;
    let profile: number;
    type Client = Awaited<ReturnType<typeof client>>;
    let admin: Client;
    const client = async (id: number, verified = true) => {
      let raw = "";
      const issued = await r.auth.issue(
        {
          cookies: {
            get: () => undefined,
            set: (_name: string, value: string) => {
              raw = value;
            },
          },
        } as unknown as Context,
        await r.auth.user(id),
        verified,
      );
      return {
        session: issued.session,
        request: async (
          path: string,
          method = "GET",
          data?: unknown,
          headers = {},
        ) => {
          const response = await fetch(base + "/api/v1/" + path, {
            method,
            headers: {
              origin: r.config.publicUrl,
              cookie: `nodepass=${raw}`,
              "x-csrf-token": issued.session.csrf,
              "content-type": "application/json",
              ...headers,
            },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
          });
          return {
            status: response.status,
            value: response.status === 204 ? null : await response.json(),
          };
        },
      };
    };
    const edit = async (
      id: number,
      patch: Record<string, unknown>,
      actor = admin,
    ) => {
      const row = await users.get(id, await r.params());
      return actor.request(`users/${id}`, "PATCH", {
        name: row.name,
        login: row.login,
        userGroupId: row.userGroupId,
        userProfileId: row.userProfileId,
        groups: row.groups,
        isAdminApp: !!row.isAdminApp,
        isAdminAcc: !!row.isAdminAcc,
        isDisabled: !!row.isDisabled,
        ...patch,
      });
    };
    beforeAll(async () => {
      r = await harness();
      http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await http.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test listener");
      base = `http://127.0.0.1:${address.port}`;
      users = new Catalogue(r.db, "users", r.auth);
      profiles = new Catalogue(r.db, "profiles", r.auth);
      admin = await client(1);
      profile = (
        await profiles.create(
          { name: "Session reader", profile: { accView: true } },
          await r.params(),
        )
      ).id;
      target = (
        await users.create(
          {
            name: "Session user",
            login: "session-user",
            userGroupId: 1,
            userProfileId: profile,
            password: testPassword,
            groups: [],
            isAdminApp: false,
            isAdminAcc: false,
          },
          await r.params(),
        )
      ).id;
      await r
        .db("UserGroup")
        .insert({ id: 2, name: "Session secondary group" });
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await http?.close();
      await r?.dispose();
    });

    it("keeps self edits, renamed logins and unchanged admin flags authenticated without renewing credentials", async () => {
      const other = await client(1);
      const before = await admin.request("auth/session");
      const saved = await edit(1, {
        name: "Renamed administrator",
        login: "renamed-admin",
        email: "synthetic@example.invalid",
        notes: "Session test",
      });
      expect(saved.status).toBe(200);
      for (const c of [admin, other]) {
        const current = await c.request("auth/session");
        expect(current.status).toBe(200);
        expect(current.value).toMatchObject({
          name: "Renamed administrator",
          login: "renamed-admin",
          accessRevision: before.value.accessRevision,
        });
        const stored = await r
          .db("nodepass_sessions")
          .where({ id: c.session.id })
          .first();
        for (const key of ["createdAt", "verifiedAt", "csrf"])
          expect(String(stored[key])).toBe(
            String(c.session[key as keyof typeof c.session]),
          );
      }
    });

    it("keeps multiple sessions across user, group and profile changes and enforces new rights immediately", async () => {
      const first = await client(target),
        second = await client(target);
      const account = await r.accounts.create(
        {
          name: "Primary group session account",
          categoryId: 1,
          clientId: 1,
          userGroupId: 1,
          isPrivateGroup: true,
          password: "synthetic account secret",
        },
        await r.params(),
      );
      let previous = (await first.request("auth/session")).value.accessRevision;
      for (const patch of [
        {
          name: "Renamed reader",
          login: "renamed-reader",
          email: "reader@example.invalid",
          notes: "Updated",
        },
        { userGroupId: 2 },
        { groups: [1] },
        { groups: [] },
      ]) {
        expect((await edit(target, patch)).status).toBe(200);
        for (const c of [first, second])
          expect((await c.request("auth/session")).status).toBe(200);
        const revision = (await first.request("auth/session")).value
          .accessRevision;
        if ("name" in patch) expect(revision).toBe(previous);
        else expect(revision).not.toBe(previous);
        previous = revision;
        const currentUser = await users.get(target, await r.params());
        expect((await first.request(`accounts/${account.id}`)).status).toBe(
          currentUser.userGroupId === 1 ? 200 : 404,
        );
      }
      expect(
        (
          await admin.request(`profiles/${profile}`, "PATCH", {
            name: "Renamed session profile",
            profile: { accView: true },
          })
        ).status,
      ).toBe(200);
      expect((await first.request("auth/session")).value.accessRevision).toBe(
        previous,
      );
      expect(
        (
          await first.request("categories", "POST", {
            name: "Denied session category",
          })
        ).status,
      ).toBe(403);
      for (const allowed of [true, false]) {
        expect(
          (
            await admin.request(`profiles/${profile}`, "PATCH", {
              name: "Updated profile",
              profile: { accView: true, mgmCategories: allowed },
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await first.request("categories", "POST", {
              name: "Session category",
            })
          ).status,
        ).toBe(allowed ? 201 : 403);
        for (const c of [first, second])
          expect(
            (await c.request("auth/session")).value.permissions.mgmCategories,
          ).toBe(allowed);
      }
      const another = await profiles.create(
        { name: "Another profile", profile: { accView: true, mgmTags: true } },
        await r.params(),
      );
      expect((await edit(target, { userProfileId: another.id })).status).toBe(
        200,
      );
      expect(
        (await first.request("auth/session")).value.permissions.mgmTags,
      ).toBe(true);
      expect((await second.request("auth/session")).status).toBe(200);
    });

    it.each(["isAdminApp", "isAdminAcc"])(
      "revokes all target sessions on grant and removal of %s only when changed",
      async (flag) => {
        for (const enabled of [true, false]) {
          const first = await client(target),
            second = await client(target);
          expect((await edit(target, { [flag]: enabled })).status).toBe(200);
          for (const c of [first, second])
            expect((await c.request("auth/session")).status).toBe(401);
          expect((await admin.request("auth/session")).status).toBe(200);
          const fresh = await client(target);
          expect((await edit(target, { [flag]: enabled })).status).toBe(200);
          expect((await fresh.request("auth/session")).status).toBe(200);
        }
      },
    );

    it.each(["password", "isDisabled"])(
      "revokes all target sessions for %s",
      async (field) => {
        const first = await client(target),
          second = await client(target);
        expect(
          (
            await edit(target, {
              [field]: field === "password" ? testPassword : true,
            })
          ).status,
        ).toBe(200);
        expect(
          await r.db("nodepass_sessions").where({ userId: target }),
        ).toHaveLength(0);
        for (const c of [first, second])
          expect((await c.request("auth/session")).status).toBe(401);
        expect((await admin.request("auth/session")).status).toBe(200);
        if (field === "isDisabled")
          expect((await edit(target, { isDisabled: false })).status).toBe(200);
      },
    );

    it("retains changes and sessions atomically when authorization, CSRF, origin or auditing rejects a change", async () => {
      const c = await client(target);
      expect((await edit(1, { isAdminApp: false })).status).toBe(403);
      expect((await edit(target, { name: "Unauthorized" }, c)).status).toBe(
        403,
      );
      const row = await users.get(target, await r.params());
      const body = {
        name: row.name,
        login: row.login,
        userGroupId: row.userGroupId,
        userProfileId: row.userProfileId,
        isAdminAcc: true,
      };
      for (const headers of [
        { "x-csrf-token": "wrong" },
        { origin: "https://foreign.invalid" },
      ])
        expect(
          (await admin.request(`users/${target}`, "PATCH", body, headers))
            .status,
        ).toBe(403);
      const audit = vi
        .spyOn(database, "audit")
        .mockRejectedValueOnce(new Error("Synthetic audit failure"));
      try {
        expect((await edit(target, { isAdminAcc: true })).status).toBe(500);
      } finally {
        audit.mockRestore();
      }
      expect((await users.get(target, await r.params())).isAdminAcc).toBe(0);
      expect((await c.request("auth/session")).status).toBe(200);
      expect((await admin.request("auth/session")).status).toBe(200);
    });

    it("returns a machine-readable MFA gate and preserves pending-session inspection", async () => {
      const pending = await client(1, false);
      expect(await pending.request("categories")).toEqual({
        status: 403,
        value: {
          message: "Complete multi-factor authentication",
          code: "MFA_REQUIRED",
        },
      });
      expect((await pending.request("auth/session")).value.phase).toBe(
        "enroll",
      );
      await r
        .db("nodepass_sessions")
        .where({ id: pending.session.id })
        .update({ createdAt: 1 });
      expect((await pending.request("auth/session")).status).toBe(401);
    });

    it("normalizes group order, duplicate memberships and equivalent profile flags in the access fingerprint", async () => {
      const identity = (await r.params(target)).identity!;
      identity.user.groups = [2, 1, 2];
      identity.user.profile = { accView: true, accEdit: 1, accFiles: false };
      const original = (await r.auth.viewer(identity)).accessRevision;
      expect(original).toMatch(/^[a-f0-9]{64}$/);
      identity.user.groups = [1, 2];
      identity.user.profile = { accEdit: true, accView: 1 };
      expect((await r.auth.viewer(identity)).accessRevision).toBe(original);
      for (const patch of [
        { userGroupId: 99 },
        { groups: [1] },
        { isAdminApp: 1 },
        { isAdminAcc: 1 },
        { isLdap: 1 },
        { profile: { accView: true } },
      ]) {
        expect(
          (
            await r.auth.viewer({
              ...identity,
              user: { ...identity.user, ...patch },
            })
          ).accessRevision,
        ).not.toBe(original);
      }
    });

    it("revokes the acting user's own sessions after a successful administrator-role edit", async () => {
      expect((await edit(target, { isAdminApp: true })).status).toBe(200);
      for (const patch of [{ isAdminAcc: true }, { isAdminApp: false }]) {
        const self = await client(target),
          other = await client(target);
        expect((await edit(target, patch, self)).status).toBe(200);
        expect((await self.request("auth/session")).status).toBe(401);
        expect((await other.request("auth/session")).status).toBe(401);
        expect((await admin.request("auth/session")).status).toBe(200);
      }
    });
  },
);
