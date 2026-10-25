import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { Context } from "koa";
import { harness, testPassword } from "./harness.js";
import { jsonRpc, actions } from "../packages/server/src/compat/jsonrpc.js";
import { Tokens } from "../packages/server/src/services/management.js";
import type { Row } from "../packages/server/src/db.js";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "sysPass JSON-RPC method contracts",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      raw: string,
      accountId: number,
      tagId: number;
    const call = async (
      method: string,
      params: Row = {},
      request: Row = {},
    ) => {
      const ctx = {
        request: {
          body: {
            jsonrpc: "2.0",
            id: 1,
            method,
            params: { authToken: raw, tokenPass: testPassword, ...params },
            ...request,
          },
        },
        ip: "127.0.0.1",
      } as unknown as Context;
      await jsonRpc(ctx, r.auth, r.accounts);
      return ctx.body as Row;
    };
    beforeAll(async () => {
      r = await harness();
      raw = (
        await new Tokens(r.db, r.auth).create(
          {
            methods: Object.keys(actions),
            password: testPassword,
            expiresAt: Date.now() + 3600000,
          },
          await r.params(),
        )
      ).token;
    });
    afterAll(async () => {
      await r?.dispose();
    });
    it("preserves all catalogue CRUD method names and response envelopes", async () => {
      for (const type of ["category", "client", "tag", "userGroup"]) {
        const created = await call(type + "/create", {
          name: "RPC " + type,
          ...(type !== "tag" ? { description: "description" } : {}),
        });
        expect(created.error, JSON.stringify(created)).toBeUndefined();
        const id = created.result.itemId;
        expect(id).toBeGreaterThan(0);
        expect(created.result.resultCode).toBe(0);
        if (type === "tag") tagId = id;
        expect((await call(type + "/view", { id })).result.result.name).toBe(
          "RPC " + type,
        );
        expect(
          (await call(type + "/search", { text: "RPC" })).result.result.some(
            (row: Row) => row.id === id,
          ),
        ).toBe(true);
        expect((await call(type + "/search")).result.count).toBeGreaterThan(0);
        expect(
          (
            await call(type + "/edit", {
              id,
              name: "Edited " + type,
              ...(type !== "tag" ? { description: "changed" } : {}),
            })
          ).result.itemId,
        ).toBe(id);
        if (type !== "tag")
          expect((await call(type + "/delete", { id })).result.result.id).toBe(
            id,
          );
      }
    });
    it("creates, views, filters and edits accounts without exposing stored key material", async () => {
      const created = await call("account/create", {
        name: "RPC account",
        clientId: 1,
        categoryId: 1,
        userGroupId: 1,
        userId: 1,
        login: "rpc",
        url: "https://example.invalid",
        notes: "synthetic",
        pass: "rpc initial",
        tagsId: [tagId],
        private: 0,
        privateGroup: 0,
        expireDate: 1900000000,
        parentId: 0,
      });
      expect(created.error, JSON.stringify(created)).toBeUndefined();
      accountId = created.result.itemId;
      expect(created.result.result.pass).toBe("");
      expect(created.result.result.key).toBe("");
      expect(created.result.result.userGroupName).toBe("Administrators");
      const view = await call("account/view", { id: accountId });
      expect(view.result.result.userName).toBe("Test admin");
      expect(view.result.result.countView).toBe(1);
      const pass = await call("account/viewPass", { id: accountId });
      expect(pass.result.result).toEqual({ password: "rpc initial" });
      expect(pass.result.count).toBe(1);
      for (const order of [0, 1, 2, 3, 4, 5]) {
        const result = await call("account/search", {
          text: "RPC",
          categoryId: 1,
          clientId: 1,
          tagsId: [tagId],
          op: order % 2 ? "or" : "and",
          order,
          count: 10,
        });
        expect(result.error, JSON.stringify(result)).toBeUndefined();
        expect(result.result.result.map((a: Row) => a.id)).toContain(accountId);
        expect(result.result.result[0]).not.toHaveProperty("key");
      }
      expect(
        (
          await call("account/edit", {
            id: accountId,
            name: "Edited account",
            categoryId: 1,
            clientId: 1,
            login: "edited",
            notes: "changed",
            url: "",
            tagsId: [],
            private: 0,
            privateGroup: 0,
            expireDate: 1900000001,
            parentId: 0,
            userId: 1,
          })
        ).result.itemId,
      ).toBe(accountId);
      expect(
        (await call("account/edit", { id: accountId, notes: "minimal update" }))
          .result.result.notes,
      ).toBe("minimal update");
      expect(
        (
          await call("account/editPass", {
            id: accountId,
            pass: "updated rpc",
            expireDate: 2147483000,
          })
        ).result.resultMessage,
      ).toBe("Account password updated");
      expect(
        (await call("account/viewPass", { id: accountId })).result.result
          .password,
      ).toBe("updated rpc");
      expect(
        (await r.db("Account").where({ id: accountId }).first()).passDateChange,
      ).toBe(2147483000);
      for (const params of [{ tagsId: "bad" }, { tagsId: [99999] }])
        expect(
          (await call("account/edit", { id: accountId, ...params })).error.code,
        ).toBe(-32602);
      const minimal = await call("account/create", {
        name: "Minimal",
        categoryId: 1,
        clientId: 1,
        pass: "value",
      });
      expect(minimal.result.itemId).toBeGreaterThan(0);
      expect(
        (await call("account/delete", { id: minimal.result.itemId })).result
          .resultMessage,
      ).toBe("Account removed");
    });
    it("supports managed backups and password-protected XML exports", async () => {
      const exported = await call("config/export", { password: testPassword });
      expect(exported.error, JSON.stringify(exported)).toBeUndefined();
      expect(exported.result.result).toBe("backups");
      const files = await readdir(resolve(r.config.dataDir, "backups"));
      expect(
        await readFile(
          resolve(
            r.config.dataDir,
            "backups",
            files.find((f) => f.endsWith(".xml"))!,
          ),
          "utf8",
        ),
      ).toContain("<Encrypted");
      expect(
        (await call("config/export", { password: testPassword, path: "/etc" }))
          .error.code,
      ).toBe(-32602);
      const backup = await call("config/backup");
      expect((await call("config/backup", { path: "/etc" })).error.code).toBe(
        -32602,
      );
      expect(backup.result.result).toMatch(/^nodepass-.*\.npb$/);
    });
    it("uses literal legacy tokens and rejects invalid requests, credentials and disabled users", async () => {
      await r.db("AuthToken").insert({
        userId: 1,
        createdBy: 1,
        startDate: 1,
        actionId: 2,
        token: "synthetic-original-token",
      });
      expect(
        (
          await call("account/search", {
            authToken: "synthetic-original-token",
          })
        ).result.resultCode,
      ).toBe(0);
      for (const request of [
        { jsonrpc: "1.0" },
        { id: 1.5 },
        { params: [] },
        { params: null },
      ])
        expect((await call("account/search", {}, request)).error.code).toBe(
          -32602,
        );
      expect(
        (await call("account/viewPass", { id: accountId, tokenPass: "wrong" }))
          .error.code,
      ).toBe(-32603);
      expect(
        (await call("account/search", { authToken: "unknown" })).error.code,
      ).toBe(-32603);
      await r.db("User").where({ id: 1 }).update({ isDisabled: 1 });
      expect((await call("account/search")).error.code).toBe(-32603);
      await r.db("User").where({ id: 1 }).update({ isDisabled: 0, isLdap: 1 });
      const directory = vi.spyOn(r.auth, "directory").mockResolvedValue(false);
      expect((await call("account/search")).error.code).toBe(-32603);
      directory.mockRestore();
      await r
        .db("User")
        .where({ id: 1 })
        .update({ isLdap: 0, isAdminApp: 0, isAdminAcc: 0 });
      expect((await call("config/backup")).error.code).toBe(-32603);
      await r
        .db("User")
        .where({ id: 1 })
        .update({ isAdminApp: 1, isAdminAcc: 1 });
    });
  },
);
