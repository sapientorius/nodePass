import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import type { Context } from "koa";
import { harness } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import { groupMembers } from "../packages/server/src/services/group-members.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "group membership disclosure and complete paging",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    let http: Awaited<ReturnType<typeof createApp>>;
    let server: Awaited<ReturnType<typeof r.app.listen>>;
    let base: string;
    beforeAll(async () => {
      r = await harness();
      await r.db("UserProfile").insert([
        {
          id: 2,
          name: "User manager",
          profile: 'NPJ1:{"mgmUsers":true,"mgmGroups":true}',
        },
        { id: 3, name: "Group manager", profile: 'NPJ1:{"mgmGroups":1}' },
        { id: 4, name: "Reader", profile: "NPJ1:{}" },
      ]);
      await r.db("UserGroup").insert([
        { id: 2, name: "Primary" },
        { id: 3, name: "Additional" },
        { id: 4, name: "Empty" },
        ...Array.from({ length: 1001 }, (_, index) => ({
          id: 100 + index,
          name: `Catalogue ${String(index).padStart(4, "0")}`,
        })),
        { id: 5000, name: "ZZ hidden beyond catalogue limit" },
      ]);
      const user = (
        id: number,
        name: string,
        userGroupId: number,
        userProfileId = 4,
      ) => ({
        id,
        name,
        login: `member${String(id).padStart(4, "0")}`,
        userGroupId,
        userProfileId,
        pass: Buffer.from("synthetic unused hash"),
        hashSalt: Buffer.from("synthetic salt"),
      });
      await r
        .db("User")
        .insert([
          user(10, "A manager", 1, 2),
          user(11, "A group manager", 1, 3),
          { ...user(12, "A account admin", 1), isAdminAcc: 1 },
          user(13, "A reader", 1),
          user(14, "A hidden group", 5000),
        ]);
      for (let start = 0; start < 1002; start += 200)
        await r.db("User").insert(
          Array.from({ length: Math.min(200, 1002 - start) }, (_, index) => ({
            ...user(100 + start + index, "Shared member", 2),
            isDisabled: start + index === 0 ? 1 : 0,
          })),
        );
      await r.db("UserToUserGroup").insert([
        { userId: 100, userGroupId: 2 },
        { userId: 100, userGroupId: 3 },
        { userId: 100, userGroupId: 5000 },
        { userId: 101, userGroupId: 3 },
      ]);
      http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      server = await http.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test listener");
      base = `http://127.0.0.1:${address.port}/api/v1`;
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await http?.close();
      await r?.dispose();
    });
    const request = async (path: string, actor?: number, pending = false) => {
      let raw = "";
      if (actor) {
        const issued = await r.auth.issue(
          {
            cookies: {
              get: () => undefined,
              set: (_key: string, value: string) => {
                raw = value;
              },
            },
          } as unknown as Context,
          await r.auth.user(actor),
          !pending,
        );
        if (pending)
          await r
            .db("nodepass_sessions")
            .where({ id: issued.session.id })
            .update({ complete: 0 });
      }
      const response = await fetch(`${base}/${path}`, {
        headers: raw ? { cookie: `nodepass=${raw}` } : {},
      });
      return { status: response.status, value: await response.json() };
    };
    it("pages all primary members beyond the catalogue limit with deterministic ties and disabled users", async () => {
      const params = {
        ...(await r.params()),
        query: { membership: "primary" },
      };
      const first = await groupMembers(r.db, 2, params);
      expect(first).toMatchObject({ total: 1002, limit: 25, skip: 0 });
      expect(first.data).toHaveLength(25);
      expect(first.data[0]).toEqual({
        id: 100,
        name: "Shared member",
        login: "member0100",
      });
      expect(
        await groupMembers(r.db, 2, {
          ...params,
          query: { membership: "primary", skip: "1000", limit: "100" },
        }),
      ).toEqual({
        total: 1002,
        skip: 1000,
        limit: 100,
        data: [
          { id: 1100, name: "Shared member", login: "member1100" },
          { id: 1101, name: "Shared member", login: "member1101" },
        ],
      });
      expect(
        (
          await groupMembers(r.db, 2, {
            ...params,
            query: { membership: "primary", skip: 2000 },
          })
        ).data,
      ).toEqual([]);
    });
    it("separates primary and additional memberships, including empty groups", async () => {
      const params = await r.params(10);
      expect(
        (
          await groupMembers(r.db, 2, {
            ...params,
            query: { membership: "additional" },
          })
        ).total,
      ).toBe(0);
      const additional = await groupMembers(r.db, 3, {
        ...params,
        query: { membership: "additional", limit: 1 },
      });
      expect(additional).toMatchObject({ total: 2, limit: 1 });
      expect(additional.data.map((user) => user.id)).toEqual([100]);
      expect(
        (
          await groupMembers(r.db, 3, {
            ...params,
            query: { membership: "additional", limit: 1, skip: 1 },
          })
        ).data.map((user) => user.id),
      ).toEqual([101]);
      expect(
        (
          await groupMembers(r.db, 4, {
            ...params,
            query: { membership: "primary" },
          })
        ).total,
      ).toBe(0);
    });
    it("exposes group references only to user managers and resolves names outside the group catalogue limit", async () => {
      const users = new Catalogue(r.db, "users", r.auth);
      for (const actor of [1, 10]) {
        const params = await r.params(actor);
        expect(await users.get(100, params)).toMatchObject({
          primaryGroup: { id: 2, name: "Primary" },
          additionalGroups: [
            { id: 3, name: "Additional" },
            { id: 5000, name: "ZZ hidden beyond catalogue limit" },
          ],
        });
        expect(
          (await users.find(params)).find((row) => row.id === 14),
        ).toMatchObject({
          primaryGroup: { id: 5000, name: "ZZ hidden beyond catalogue limit" },
          additionalGroups: [],
        });
      }
      for (const actor of [11, 12, 13]) {
        const params = await r.params(actor);
        expect(Object.keys(await users.get(100, params)).sort()).toEqual([
          "id",
          "login",
          "name",
        ]);
        expect(Object.keys((await users.find(params))[0]!).sort()).toEqual([
          "id",
          "login",
          "name",
        ]);
      }
      await expect(
        users.patch(
          100,
          { name: "Rejected", primaryGroup: { id: 1, name: "Admin" } },
          await r.params(),
        ),
      ).rejects.toThrow("Unknown field");
    });
    it("enforces authentication and user management rights on HTTP before looking up groups", async () => {
      expect(
        (await request("groups/2/members?membership=primary")).status,
      ).toBe(401);
      expect(
        (await request("groups/2/members?membership=primary", 10, true)).status,
      ).toBe(403);
      for (const actor of [11, 12, 13]) {
        expect(
          (await request("groups/2/members?membership=primary", actor)).status,
        ).toBe(403);
        expect(
          (await request("groups/60000/members?membership=primary", actor))
            .status,
        ).toBe(403);
      }
      for (const actor of [1, 10]) {
        const result = await request(
          "groups/3/members?membership=additional",
          actor,
        );
        expect(result.status).toBe(200);
        expect(result.value.data).toEqual([
          { id: 100, name: "Shared member", login: "member0100" },
          { id: 101, name: "Shared member", login: "member0101" },
        ]);
        expect(
          (await request("groups/60000/members?membership=primary", actor))
            .status,
        ).toBe(404);
      }
      await expect(groupMembers(r.db, 2, {})).rejects.toThrow("Authentication");
      await expect(
        groupMembers(r.db, "invalid", {
          ...(await r.params()),
          query: { membership: "primary" },
        }),
      ).rejects.toThrow("integer");
    });
    it.each([
      "",
      "membership=other",
      "membership=primary&unknown=1",
      "membership=primary&membership=additional",
      "membership=primary&limit=0",
      "membership=primary&limit=101",
      "membership=primary&limit=1.5",
      "membership=primary&limit=abc",
      "membership=primary&limit=1&limit=2",
      "membership=primary&skip=-1",
      "membership=primary&skip=1e3",
      "membership=primary&skip=9007199254740992",
    ])("rejects malformed query %s", async (query) => {
      expect((await request(`groups/2/members?${query}`, 10)).status).toBe(400);
    });
    it("documents the new read-only endpoint and authorized group metadata", async () => {
      const result = await request("openapi.json", 1);
      expect(result.status).toBe(200);
      expect(
        result.value.paths["/api/v1/groups/{id}/members"].get.parameters,
      ).toContainEqual(
        expect.objectContaining({ name: "membership", required: true }),
      );
      expect(
        result.value.components.schemas.UserSummary.properties,
      ).toHaveProperty("primaryGroup");
    });
  },
);
