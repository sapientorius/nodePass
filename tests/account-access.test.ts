import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Context } from "koa";
import { harness, testPassword } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import { Tokens } from "../packages/server/src/services/management.js";
import { getSetting, putSetting, type Row } from "../packages/server/src/db.js";
import type { ServiceParams } from "../packages/server/src/services/accounts.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "account privacy, historical authorization and secondary-group configuration",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      http: Awaited<ReturnType<typeof createApp>>,
      server: Awaited<
        ReturnType<Awaited<ReturnType<typeof harness>>["app"]["listen"]>
      >,
      base: string,
      reader: Row,
      p: ServiceParams,
      rp: ServiceParams;
    const input = {
      name: "ACL fixture",
      password: "synthetic current secret",
      categoryId: 1,
      clientId: 1,
      userGroupId: 4,
    };
    const sessions = new Map<
      number,
      { cookie: string; csrf: string; id: string }
    >();
    const session = async (userId: number) => {
      let cookie = "";
      const identity = await r.auth.issue(
        {
          cookies: {
            get: () => undefined,
            set: (_name: string, value: string) => {
              cookie = `nodepass=${value}`;
            },
          },
        } as unknown as Context,
        await r.auth.user(userId),
        true,
      );
      const value = {
        cookie,
        csrf: identity.session.csrf,
        id: identity.session.id,
      };
      sessions.set(userId, value);
      return value;
    };
    const request = async (
      userId: number,
      path: string,
      method = "GET",
      data?: unknown,
      extra: Record<string, string> = {},
    ) => {
      const credentials = sessions.get(userId) ?? (await session(userId));
      const response = await fetch(base + path, {
        method,
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          cookie: credentials.cookie,
          "x-csrf-token": credentials.csrf,
          ...extra,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    };
    beforeAll(async () => {
      r = await harness();
      p = await r.params();
      const groups = new Catalogue(r.db, "groups", r.auth);
      for (const name of [
        "Developer fixture",
        "Secondary fixture",
        "Unrelated fixture",
      ])
        await groups.create({ name }, p);
      const profile = await new Catalogue(r.db, "profiles", r.auth).create(
        {
          name: "ACL capabilities",
          profile: {
            accView: true,
            accViewPass: true,
            accViewHistory: true,
            accAdd: true,
            accEdit: true,
            accEditPass: true,
            accDelete: true,
            accFiles: true,
            accPublicLinks: true,
            accPermission: true,
          },
        },
        p,
      );
      reader = await new Catalogue(r.db, "users", r.auth).create(
        {
          name: "ACL reader",
          login: "acl-reader",
          password: testPassword,
          userGroupId: 2,
          userProfileId: profile.id,
          groups: [3],
        },
        p,
      );
      await r.db("UserToUserGroup").insert({ userId: 1, userGroupId: 3 });
      p = await r.params();
      rp = await r.params(reader.id);
      http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await http.app.listen(0, "127.0.0.1");
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
      await http?.close();
      await r?.dispose();
    });

    it("keeps SQL totals, pagination and direct access consistent for memberships, grants and privacy", async () => {
      const cases = [
        { name: "unrelated", group: 4, off: false, on: false },
        { name: "primary", group: 2, off: true, on: true },
        { name: "additional membership", group: 3, off: true, on: true },
        { name: "direct read", group: 4, direct: true, off: true, on: true },
        { name: "primary grant", group: 4, grant: 2, off: true, on: true },
        { name: "additional grant", group: 4, grant: 3, off: false, on: true },
        {
          name: "private secondary",
          group: 3,
          groupPrivate: true,
          direct: true,
          grant: 2,
          off: false,
          on: false,
        },
        {
          name: "private primary",
          group: 2,
          groupPrivate: true,
          off: true,
          on: true,
        },
        {
          name: "private owner",
          group: 2,
          private: true,
          direct: true,
          grant: 2,
          off: false,
          on: false,
        },
      ];
      const fixtures: ((typeof cases)[number] & { id: number })[] = [];
      for (const item of cases) {
        const account = await r.accounts.create(
          {
            ...input,
            name: `Matrix ${item.name}`,
            userGroupId: item.group,
            isPrivate: !!item.private,
          },
          p,
        );
        await r.accounts.setGrants(
          account.id,
          {
            users: item.direct ? [{ userId: reader.id, isEdit: false }] : [],
            groups: item.grant
              ? [{ userGroupId: item.grant, isEdit: true }]
              : [],
          },
          p,
        );
        // Preserve imported privacy without impersonating a foreign primary group.
        await r
          .db("Account")
          .where({ id: account.id })
          .update({ isPrivateGroup: Number(!!item.groupPrivate) });
        fixtures.push({ ...item, id: account.id });
      }
      for (const full of [false, true]) {
        await putSetting(r.db, "fullGroupAccess", full);
        const expected = fixtures
          .filter((f) => (full ? f.on : f.off))
          .map((f) => f.id)
          .sort((a, b) => a - b);
        const ids: number[] = [];
        for (let skip = 0; skip < expected.length; skip++) {
          const page = await r.accounts.find({
            ...rp,
            query: { search: "Matrix", limit: 1, skip },
          });
          expect(page.total).toBe(expected.length);
          expect(page.data).toHaveLength(1);
          expect(JSON.stringify(page)).not.toContain(input.password);
          ids.push(page.data[0]!.id);
        }
        expect(ids.sort((a, b) => a - b)).toEqual(expected);
        expect(
          (
            await r.accounts.find({
              ...rp,
              query: { search: "Matrix", categoryId: 1, op: "or" },
            })
          ).total,
        ).toBe(expected.length);
        for (const fixture of fixtures) {
          if (expected.includes(fixture.id)) {
            const account = await r.accounts.get(fixture.id, rp);
            expect(account.permissions.secret).toBe(true);
            expect(account.permissions.edit).toBe(!fixture.direct);
            expect((await r.accounts.secret(fixture.id, rp)).password).toBe(
              input.password,
            );
          } else {
            await expect(r.accounts.get(fixture.id, rp)).rejects.toThrow(
              "not found",
            );
            await expect(r.accounts.secret(fixture.id, rp)).rejects.toThrow(
              "not found",
            );
          }
        }
        const privateGroup = fixtures.find(
          (f) => f.groupPrivate && f.group === 3,
        )!;
        await expect(r.accounts.get(privateGroup.id, p)).rejects.toThrow(
          "not found",
        );
        const before = await r.accounts.find({
          ...p,
          query: { search: "Matrix" },
        });
        expect(before.data.map((a) => a.id)).not.toContain(privateGroup.id);
      }
      await putSetting(r.db, "fullGroupAccess", false);
      for (const user of [
        { ...rp.identity!.user, isDisabled: 1 },
        { ...rp.identity!.user, profile: { accView: "false" } },
        { ...rp.identity!.user, profile: {} },
      ]) {
        expect(
          (
            await r.accounts.find({
              ...rp,
              identity: { ...rp.identity!, user },
            })
          ).total,
        ).toBe(0);
      }
      for (const malformed of ["true", "false", 1, null]) {
        await putSetting(r.db, "fullGroupAccess", malformed);
        expect(await r.accounts.fullGroup()).toBe(false);
      }
      await putSetting(r.db, "fullGroupAccess", false);
    });

    it("rejects group-private writes outside the primary group before persisting changes", async () => {
      await expect(
        r.accounts.create(
          { ...input, name: "Rejected private group", isPrivateGroup: true },
          p,
        ),
      ).rejects.toThrow("primary group");
      expect(
        await r.db("Account").where({ name: "Rejected private group" }),
      ).toEqual([]);
      const account = await r.accounts.create(
        { ...input, userGroupId: 1, isPrivateGroup: true },
        p,
      );
      await expect(
        r.accounts.patch(account.id, { ...input, version: account.version }, p),
      ).rejects.toThrow("primary group");
      expect((await r.accounts.get(account.id, p)).userGroupId).toBe(1);
      expect(await r.accounts.history(account.id, p)).toEqual([]);
      expect((await r.accounts.get(account.id, p)).version).toBe(
        account.version,
      );
    });
    it("filters historical ownership, groups and privacy before the limit and before decryption or restore", async () => {
      const account = await r.accounts.create(
        { ...input, name: "Historical fixture" },
        p,
      );
      await r.accounts.changeSecret(
        account.id,
        "synthetic replacement",
        account.version,
        p,
      );
      await r.accounts.setGrants(
        account.id,
        { users: [{ userId: reader.id, isEdit: true }], groups: [] },
        p,
      );
      const original = await r
        .db("AccountHistory")
        .where({ accountId: account.id })
        .first();
      expect(
        (await r.accounts.historySecret(account.id, original.id, rp)).password,
      ).toBe(input.password);
      const decrypt = vi.spyOn(r.vault, "decrypt");
      try {
        for (const flags of [
          { userId: 1, userGroupId: 4, isPrivate: 1, isPrivateGroup: 0 },
          {
            userId: reader.id,
            userGroupId: 3,
            isPrivate: 0,
            isPrivateGroup: 1,
          },
        ]) {
          await r.db("AccountHistory").where({ id: original.id }).update(flags);
          for (const full of [false, true]) {
            await putSetting(r.db, "fullGroupAccess", full);
            decrypt.mockClear();
            expect(await r.accounts.history(account.id, rp)).toEqual([]);
            await expect(
              r.accounts.historySecret(account.id, original.id, rp),
            ).rejects.toThrow("not found");
            await expect(
              r.accounts.restore(account.id, original.id, 2, rp),
            ).rejects.toThrow("not found");
            expect(decrypt).not.toHaveBeenCalled();
          }
          // An application administrator also needs historical privacy access.
          await expect(
            r.accounts.historySecret(account.id, original.id, {
              ...rp,
              identity: {
                ...rp.identity!,
                user: { ...rp.identity!.user, isAdminApp: 1 },
              },
            }),
          ).rejects.toThrow("not found");
        }
      } finally {
        decrypt.mockRestore();
      }
      await r
        .db("AccountHistory")
        .where({ id: original.id })
        .update({ userId: 1, userGroupId: 2, isPrivate: 0, isPrivateGroup: 1 });
      expect(
        (await r.accounts.historySecret(account.id, original.id, rp)).password,
      ).toBe(input.password);
      // More than one full page of denied newer histories must not hide an allowed older row.
      const { id: _id, ...copy } = original;
      await r.db("AccountHistory").insert(
        Array.from({ length: 101 }, () => ({
          ...copy,
          isPrivate: 1,
          userId: 1,
        })),
      );
      expect(
        (await r.accounts.history(account.id, rp)).map((h) => h.id),
      ).toEqual([original.id]);
      // Historical relation matters even when the current group is accessible.
      await r.accounts.setGrants(account.id, { users: [], groups: [] }, p);
      await r
        .db("Account")
        .where({ id: account.id })
        .update({ userGroupId: 2 });
      await r
        .db("AccountHistory")
        .where({ id: original.id })
        .update({ userGroupId: 4, isPrivateGroup: 0 });
      expect(await r.accounts.history(account.id, rp)).toEqual([]);
      await expect(
        r.accounts.historySecret(account.id, original.id, rp),
      ).rejects.toThrow("not found");
      await r.accounts.setGrants(
        account.id,
        { users: [], groups: [{ userGroupId: 3, isEdit: false }] },
        p,
      );
      await putSetting(r.db, "fullGroupAccess", false);
      expect(await r.accounts.history(account.id, rp)).toEqual([]);
      await putSetting(r.db, "fullGroupAccess", true);
      expect(
        (await r.accounts.historySecret(account.id, original.id, rp)).password,
      ).toBe(input.password);
      await r.db("Account").where({ id: account.id }).update({ isPrivate: 1 });
      await expect(
        r.accounts.historySecret(account.id, original.id, rp),
      ).rejects.toThrow("not found");
      await putSetting(r.db, "fullGroupAccess", false);
    });

    it("blocks formerly private snapshots after a real privacy change and permits their original owner", async () => {
      const account = await r.accounts.create(
        { ...input, name: "Formerly private fixture", isPrivate: true },
        p,
      );
      const current = await r.accounts.patch(
        account.id,
        {
          ...input,
          isPrivate: false,
          password: "synthetic public replacement",
          version: account.version,
        },
        p,
      );
      await r.accounts.setGrants(
        account.id,
        { users: [{ userId: reader.id, isEdit: true }], groups: [] },
        p,
      );
      const history = await r.accounts.history(account.id, p);
      expect(history).toHaveLength(1);
      expect(
        (await r.accounts.historySecret(account.id, history[0]!.id, p))
          .password,
      ).toBe(input.password);
      expect(await r.accounts.history(account.id, rp)).toEqual([]);
      await expect(
        r.accounts.historySecret(account.id, history[0]!.id, rp),
      ).rejects.toThrow("not found");
      await expect(
        r.accounts.restore(account.id, history[0]!.id, current.version, rp),
      ).rejects.toThrow("not found");
      expect(
        (await request(reader.id, `/api/v1/accounts/${account.id}/history`))
          .body,
      ).toEqual([]);
      expect(
        (
          await request(
            reader.id,
            `/api/v1/accounts/${account.id}/history/${history[0]!.id}/secret`,
            "POST",
            {},
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            reader.id,
            `/api/v1/accounts/${account.id}/history/${history[0]!.id}/restore`,
            "POST",
            { version: current.version },
          )
        ).status,
      ).toBe(404);
    });

    it("requires recent application-admin authentication, CSRF and strict booleans for the setting", async () => {
      const path = "/api/v1/account-access";
      expect((await request(1, path)).body).toEqual({ fullGroupAccess: false });
      expect((await request(reader.id, path)).status).toBe(403);
      expect(
        (await request(reader.id, path, "PATCH", { fullGroupAccess: true }))
          .status,
      ).toBe(403);
      await r.db("User").where({ id: reader.id }).update({ isAdminAcc: 1 });
      expect(
        (await request(reader.id, path, "PATCH", { fullGroupAccess: true }))
          .status,
      ).toBe(403);
      await r.db("User").where({ id: reader.id }).update({ isAdminAcc: 0 });
      expect(
        (
          await request(
            1,
            path,
            "PATCH",
            { fullGroupAccess: true },
            { cookie: "" },
          )
        ).status,
      ).toBe(401);
      for (const headers of [
        { "x-csrf-token": "wrong" },
        { origin: "https://invalid.example" },
      ])
        expect(
          (await request(1, path, "PATCH", { fullGroupAccess: true }, headers))
            .status,
        ).toBe(403);
      for (const data of [
        {},
        { fullGroupAccess: "true" },
        { fullGroupAccess: 1 },
        { fullGroupAccess: null },
        { fullGroupAccess: true, unknown: true },
      ])
        expect((await request(1, path, "PATCH", data)).status).toBe(400);
      const adminSession = sessions.get(1)!;
      await r
        .db("nodepass_sessions")
        .where({ id: adminSession.id })
        .update({
          verifiedAt: Date.now() - 600000,
          createdAt: Date.now() - 600000,
        });
      expect(
        (await request(1, path, "PATCH", { fullGroupAccess: true })).status,
      ).toBe(403);
      await session(1);
      const active = sessions.get(1)!;
      await r
        .db("nodepass_sessions")
        .where({ id: active.id })
        .update({ complete: 0 });
      expect(
        (await request(1, path, "PATCH", { fullGroupAccess: true })).status,
      ).toBe(403);
      await session(1);
      for (const fullGroupAccess of [true, false]) {
        expect(await request(1, path, "PATCH", { fullGroupAccess })).toEqual({
          status: 200,
          body: { fullGroupAccess },
        });
        expect((await request(1, path)).body).toEqual({ fullGroupAccess });
        expect(await getSetting(r.db, "fullGroupAccess", null)).toBe(
          fullGroupAccess,
        );
      }
      expect(
        await r
          .db("nodepass_audit")
          .where({ action: "security.account-access" }),
      ).toHaveLength(2);
    });

    it("uses the same privacy decisions over actual HTTP and legacy RPC", async () => {
      const hidden = await r.accounts.create(
        { ...input, name: "HTTP private group", userGroupId: 3 },
        p,
      );
      await r
        .db("Account")
        .where({ id: hidden.id })
        .update({ isPrivateGroup: 1 });
      const shared = await r.accounts.create(
        { ...input, name: "HTTP secondary grant" },
        p,
      );
      await r.accounts.setGrants(
        shared.id,
        { users: [], groups: [{ userGroupId: 3, isEdit: false }] },
        p,
      );
      const tokens = await new Tokens(r.db, r.auth).create(
        {
          userId: reader.id,
          methods: ["account/search", "account/view", "account/viewPass"],
          password: testPassword,
          expiresAt: Date.now() + 3600000,
        },
        p,
      );
      const rpc = async (method: string, params: Row) =>
        request(reader.id, "/api.php", "POST", {
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            authToken: tokens.token,
            tokenPass: testPassword,
            ...params,
          },
        });
      for (const fullGroupAccess of [false, true]) {
        await request(1, "/api/v1/account-access", "PATCH", {
          fullGroupAccess,
        });
        for (const actor of [reader.id, 1]) {
          expect(
            (await request(actor, `/api/v1/accounts/${hidden.id}`)).status,
          ).toBe(404);
          expect(
            (
              await request(
                actor,
                `/api/v1/accounts/${hidden.id}/secret`,
                "POST",
                {},
              )
            ).status,
          ).toBe(404);
          expect(
            (await request(actor, `/api/v1/accounts/${hidden.id}/history`))
              .status,
          ).toBe(404);
          expect(
            (await request(actor, `/api/v1/accounts/${hidden.id}/files`))
              .status,
          ).toBe(404);
          expect(
            (await request(actor, `/api/v1/accounts/${hidden.id}/fields`))
              .status,
          ).toBe(404);
          expect(
            (
              await request(
                actor,
                `/api/v1/accounts/${hidden.id}/links`,
                "POST",
                { seconds: 60, views: 1 },
              )
            ).status,
          ).toBe(404);
        }
        const list = await request(reader.id, "/api/v1/accounts?search=HTTP");
        expect(list.body.total).toBe(fullGroupAccess ? 1 : 0);
        expect(
          (
            await request(
              reader.id,
              `/api/v1/accounts/${shared.id}/secret`,
              "POST",
              {},
            )
          ).status,
        ).toBe(fullGroupAccess ? 200 : 404);
        for (const method of ["account/view", "account/viewPass"]) {
          expect(
            (await rpc(method, { id: hidden.id })).body.error,
          ).toBeTruthy();
          const response = (await rpc(method, { id: shared.id })).body;
          if (fullGroupAccess) expect(response.result).toBeTruthy();
          else expect(response.error).toBeTruthy();
        }
        const result = (await rpc("account/search", { text: "HTTP" })).body;
        expect(result.result.result).toHaveLength(fullGroupAccess ? 1 : 0);
        expect(JSON.stringify(result)).not.toContain(input.password);
      }
      await putSetting(r.db, "fullGroupAccess", false);
    });
  },
);
