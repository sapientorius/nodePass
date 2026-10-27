import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, testPassword } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import type { ServiceParams } from "../packages/server/src/services/accounts.js";
import type { Context } from "koa";
import { once } from "node:events";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "private account list filter",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    const owners: { params: ServiceParams; ids: number[] }[] = [];
    const input = {
      name: "Private filter fixture",
      password: "synthetic private filter secret",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
      tags: ["private-filter"],
    };
    beforeAll(async () => {
      r = await harness();
      const p = await r.params();
      const profile = await new Catalogue(r.db, "profiles", r.auth).create(
        {
          name: "Private filter permissions",
          profile: { accView: true, accAdd: true, accPrivate: true },
        },
        p,
      );
      const reader = await new Catalogue(r.db, "users", r.auth).create(
        {
          name: "Private filter reader",
          login: "private-filter-reader",
          password: testPassword,
          userGroupId: 1,
          userProfileId: profile.id,
        },
        p,
      );
      for (const params of [p, await r.params(reader.id)]) {
        const ids: number[] = [];
        for (const name of ["A private", "Z private"])
          ids.push(
            (
              await r.accounts.create(
                { ...input, name, isPrivate: true },
                params,
              )
            ).id,
          );
        owners.push({ params, ids });
      }
      await r.accounts.create({ ...input, name: "B shared" }, p);
      await r.accounts.create(
        { ...input, name: "C group private", isPrivateGroup: true },
        p,
      );
      await r.accounts.favorite(owners[0]!.ids[1]!, true, p);
    });
    afterAll(async () => {
      await r?.dispose();
    });

    it("restricts totals and pages to the current owner's private accounts, including administrators", async () => {
      for (const { params, ids } of owners) {
        for (let skip = 0; skip <= ids.length; skip++) {
          const result = await r.accounts.find({
            ...params,
            query: { privateOnly: "true", limit: 1, skip },
          });
          expect(result.total).toBe(2);
          expect(result.data.map((row) => row.id)).toEqual(
            ids.slice(skip, skip + 1),
          );
          expect(JSON.stringify(result)).not.toContain(input.password);
        }
        for (const query of [{}, { privateOnly: "false" }])
          expect((await r.accounts.find({ ...params, query })).total).toBe(4);
      }
    });

    it("combines privacy with search, catalogues, tags, favorites and sorting, even with OR filters", async () => {
      const { params, ids } = owners[0]!;
      for (const op of ["and", "or"]) {
        const result = await r.accounts.find({
          ...params,
          query: {
            privateOnly: "true",
            search: "private",
            categoryId: 1,
            clientId: 1,
            tag: "private-filter",
            op,
            sort: "name",
            direction: "desc",
          },
        });
        expect(result.total).toBe(2);
        expect(result.data.map((row) => row.id)).toEqual([...ids].reverse());
      }
      const favorites = await r.accounts.find({
        ...params,
        query: { privateOnly: "true", favorite: "true" },
      });
      expect(favorites.total).toBe(1);
      expect(favorites.data[0]!.id).toBe(ids[1]);
      expect(
        (
          await r.accounts.find({
            ...params,
            query: { privateOnly: "true", search: "B shared" },
          })
        ).total,
      ).toBe(0);
    });

    it("rejects malformed privacy filters", async () => {
      for (const privateOnly of [
        true,
        false,
        1,
        "1",
        "",
        "TRUE",
        ["true"],
        { value: "true" },
      ])
        await expect(
          r.accounts.find({ ...owners[0]!.params, query: { privateOnly } }),
        ).rejects.toThrow("Invalid private account filter");
    });

    it("accepts the filter over authenticated HTTP and rejects invalid values", async () => {
      const http = await createApp(r.config, undefined, {
        updateFetch: offlineUpdates,
      });
      const server = await http.app.listen(0, "127.0.0.1");
      if (!server.listening) await once(server, "listening");
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("Missing test listener");
        const base = `http://127.0.0.1:${address.port}/api/v1/accounts`;
        let cookie = "";
        await http.auth.issue(
          {
            cookies: {
              get: () => undefined,
              set: (_name: string, value: string) => {
                cookie = `nodepass=${value}`;
              },
            },
          } as unknown as Context,
          owners[1]!.params.identity!.user,
          true,
        );
        const response = await fetch(
          `${base}?privateOnly=true&limit=1&skip=1`,
          {
            headers: { cookie },
          },
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.total).toBe(2);
        expect(body.data.map((row: { id: number }) => row.id)).toEqual([
          owners[1]!.ids[1],
        ]);
        expect(
          (await fetch(`${base}?privateOnly=1`, { headers: { cookie } }))
            .status,
        ).toBe(400);
        expect((await fetch(`${base}?privateOnly=true`)).status).toBe(401);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
        await http.close();
      }
    });
  },
);
