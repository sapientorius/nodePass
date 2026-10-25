import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { harness, testPassword } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import { Tokens, Presets } from "../packages/server/src/services/management.js";
import {
  Transfer,
  parseImport,
} from "../packages/server/src/services/transfer.js";
import { Integrations } from "../packages/server/src/services/integrations.js";
import { jsonRpc } from "../packages/server/src/compat/jsonrpc.js";
import type { Context } from "koa";
import type { Row } from "../packages/server/src/db.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "real services and permission boundaries",
  () => {
    let r: Awaited<ReturnType<typeof harness>>, account: Row;
    const input = {
      name: "Service account",
      login: "robot",
      password: "synthetic secret",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
      tags: ["ops", "vault"],
    };
    beforeAll(async () => {
      r = await harness();
    });
    afterAll(async () => {
      await r?.dispose();
    });
    it("creates catalogues, validates fields and never returns user hashes", async () => {
      const p = await r.params();
      for (const name of ["categories", "clients", "tags", "groups"]) {
        const service = new Catalogue(r.db, name, r.auth),
          data = {
            name: `Test ${name}`,
            ...(name !== "tags" ? { description: "Description" } : {}),
          },
          created = await service.create(data, p);
        expect((await service.get(created.id, p)).name).toBe(data.name);
        expect(await service.find(p)).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: created.id })]),
        );
        await service.patch(
          created.id,
          { ...data, name: data.name + " edited" },
          p,
        );
        await expect(
          service.create({ ...data, pass: "injected" }, p),
        ).rejects.toThrow();
        await expect(
          service.find({ ...p, query: { unknown: 1 } }),
        ).rejects.toThrow();
        await expect(service.get(2147483000, p)).rejects.toThrow();
        await service.remove(created.id, p);
      }
      const profiles = new Catalogue(r.db, "profiles", r.auth),
        profile = await profiles.create(
          { name: "Readers", profile: { accView: true, accViewPass: false } },
          p,
        );
      const users = new Catalogue(r.db, "users", r.auth),
        user = await users.create(
          {
            name: "Reader",
            login: "reader",
            password: testPassword,
            userGroupId: 1,
            userProfileId: profile.id,
            groups: [1],
          },
          p,
        );
      expect(user).not.toHaveProperty("pass");
      expect(user).not.toHaveProperty("hashSalt");
      expect((await r.params(user.id)).identity!.user.groups).toEqual([1]);
      await expect(
        users.create(
          {
            name: "duplicate",
            login: "reader",
            password: testPassword,
            userGroupId: 1,
            userProfileId: profile.id,
          },
          p,
        ),
      ).rejects.toThrow("exists");
      const nonAdmin = await r.params(user.id);
      await expect(
        profiles.create(
          { name: "Escalation", profile: { accView: true } },
          nonAdmin,
        ),
      ).rejects.toThrow();
      expect(await users.get(1, nonAdmin)).not.toHaveProperty("email");
      expect(await profiles.get(1, nonAdmin)).not.toHaveProperty("profile");
      await expect(
        users.patch(
          1,
          {
            name: "Admin",
            login: "admin",
            userGroupId: 1,
            userProfileId: 1,
            isDisabled: true,
          },
          p,
        ),
      ).rejects.toThrow("last");
      await users.patch(
        user.id,
        {
          name: "Reader edited",
          login: "reader",
          userGroupId: 1,
          userProfileId: profile.id,
          isDisabled: false,
          isAdminApp: false,
          isAdminAcc: false,
          groups: [],
        },
        p,
      );
      await expect(users.remove(user.id, p)).rejects.toThrow();
      await expect(profiles.remove(profile.id, p)).rejects.toThrow();
      await expect(
        profiles.create({ name: "Bad", profile: { root: true } }, p),
      ).rejects.toThrow();
      await profiles.patch(
        profile.id,
        { name: "Readers", profile: { accView: true, accViewPass: true } },
        p,
      );
      const fields = new Catalogue(r.db, "fields", r.auth);
      const field = await fields.create(
        {
          name: "Encrypted key",
          help: "Key data",
          moduleId: 10,
          typeId: 2,
          isEncrypted: true,
          required: true,
          showInList: false,
        },
        p,
      );
      expect(field.id).toBeGreaterThan(0);
      await expect(fields.find(nonAdmin)).rejects.toThrow();
    });
    it("enforces scoped account access, optimistic concurrency and secret isolation", async () => {
      const p = await r.params();
      account = await r.accounts.create(input, p);
      expect(account.tags).toEqual(["ops", "vault"]);
      expect(account).not.toHaveProperty("pass");
      const reader = await r.db("User").where({ login: "reader" }).first(),
        rp = await r.params(reader.id);
      expect((await r.accounts.get(account.id, rp)).name).toBe(input.name);
      await expect(
        r.accounts.patch(account.id, { ...input, version: 1 }, rp),
      ).rejects.toThrow();
      for (const query of [
        { sort: "bad" },
        { direction: "sideways" },
        { direction: "" },
        { direction: ["asc", "desc"] },
        { direction: "desc; SELECT 1" },
        { search: 123 },
        { search: "x".repeat(201) },
        { tag: 123 },
        { limit: 101 },
        { skip: -1 },
        { pass: "leak" },
      ])
        await expect(r.accounts.find({ ...p, query })).rejects.toThrow();
      expect(
        (
          await r.accounts.find({
            ...p,
            query: {
              search: "Service",
              categoryId: 1,
              clientId: 1,
              tag: "ops",
              sort: "updated",
              limit: 1,
              skip: 0,
            },
          })
        ).total,
      ).toBe(1);
      await r.accounts.favorite(account.id, true, p);
      expect(
        (await r.accounts.find({ ...p, query: { favorite: "true" } })).total,
      ).toBe(1);
      await r.accounts.favorite(account.id, false, p);
      await expect(
        r.accounts.create({ ...input, userId: 999 }, p),
      ).rejects.toThrow();
      await expect(
        r.accounts.create({ ...input, categoryId: 99999 }, p),
      ).rejects.toThrow();
      await expect(
        r.accounts.create({ ...input, password: undefined }, p),
      ).rejects.toThrow();
      account = await r.accounts.patch(
        account.id,
        {
          ...input,
          name: "Changed",
          version: 1,
          password: "second secret",
          parentId: 0,
        },
        p,
      );
      await expect(
        r.accounts.patch(account.id, { ...input, version: 1 }, p),
      ).rejects.toThrow("changed");
      await expect(
        r.accounts.patch(
          account.id,
          { ...input, version: 2, parentId: account.id },
          p,
        ),
      ).rejects.toThrow("itself");
      expect((await r.accounts.secret(account.id, p)).password).toBe(
        "second secret",
      );
      const history = await r.accounts.history(account.id, p);
      expect(history[0]).not.toHaveProperty("pass");
      expect(
        (await r.accounts.historySecret(account.id, history[0]!.id, p))
          .password,
      ).toBe(input.password);
      account = await r.accounts.restore(account.id, history[0]!.id, 2, p);
      expect(account.name).toBe(input.name);
      expect((await r.accounts.secret(account.id, p)).password).toBe(
        input.password,
      );
      await expect(
        r.accounts.historySecret(account.id, 99999, p),
      ).rejects.toThrow();
      account = await r.accounts.changeSecret(account.id, "third secret", 3, p);
      await expect(
        r.accounts.changeSecret(account.id, "bad", 3, p),
      ).rejects.toThrow("changed");
      await r.accounts.setGrants(
        account.id,
        {
          users: [{ userId: reader.id, isEdit: false }],
          groups: [{ userGroupId: 1, isEdit: false }],
        },
        p,
      );
      expect((await r.accounts.grants(account.id, p)).users).toHaveLength(1);
      for (const data of [
        { users: [], groups: [], root: true },
        { users: [{ userId: 99999, isEdit: true }], groups: [] },
        { users: [], groups: [{ userGroupId: 99999, isEdit: true }] },
        { users: [{ userId: 1, isEdit: 1 }], groups: [] },
      ])
        await expect(
          r.accounts.setGrants(account.id, data, p),
        ).rejects.toThrow();
      const defs = await r.accounts.fields(account.id, p);
      expect(defs[0]!.value).toBe("");
      await r.accounts.setField(account.id, defs[0]!.id, "custom value", p);
      expect((await r.accounts.fields(account.id, p))[0]!.value).toBe("");
      expect(
        (await r.accounts.fieldSecret(account.id, defs[0]!.id, p)).value,
      ).toBe("custom value");
      const catalogue = new Catalogue(r.db, "fields", r.auth);
      const visible = await catalogue.create(
        {
          name: "Location",
          moduleId: 1,
          typeId: 1,
          isEncrypted: false,
          required: false,
          showInList: true,
        },
        p,
      );
      const hidden = await catalogue.create(
        {
          name: "Internal",
          moduleId: 1,
          typeId: 1,
          isEncrypted: false,
          required: false,
          showInList: false,
        },
        p,
      );
      await r.accounts.setField(account.id, visible.id, "Rack A", p);
      await r.accounts.setField(account.id, hidden.id, "Internal notes", p);
      await r
        .db("CustomFieldDefinition")
        .where({ id: defs[0]!.id })
        .update({ showInList: 1 });
      expect((await r.accounts.get(account.id, rp)).listFields).toEqual([
        { id: visible.id, name: "Location", value: "Rack A" },
      ]);
      expect(JSON.stringify(await r.accounts.find(rp))).not.toContain(
        "custom value",
      );
      expect(JSON.stringify(await r.accounts.find(rp))).not.toContain(
        "Internal notes",
      );
      await expect(
        r.accounts.setField(account.id, defs[0]!.id, "", p),
      ).rejects.toThrow();
      await expect(
        r.accounts.setField(account.id, 99999, "x", p),
      ).rejects.toThrow();
      await expect(
        r.accounts.fieldSecret(account.id, 99999, p),
      ).rejects.toThrow();
      const privateAccount = await r.accounts.create(
        { ...input, name: "Private", isPrivate: true },
        p,
      );
      expect((await r.accounts.find(rp)).data.map((a) => a.id)).not.toContain(
        privateAccount.id,
      );
      await expect(r.accounts.get(privateAccount.id, rp)).rejects.toThrow();
      await r.accounts.remove(privateAccount.id, p);
    });
    it("sorts matching accounts in both directions before pagination with stable ties", async () => {
      const p = await r.params(),
        rows = [] as Row[];
      try {
        for (const [index, name] of ["Charlie", "Alpha", "Bravo"].entries()) {
          const row = await r.accounts.create(
            {
              ...input,
              name,
              login: ["bravo", "charlie", "alpha"][index],
              url: `https://${["alpha", "bravo", "charlie"][index]}.example.invalid`,
              tags: ["sorting-check"],
            },
            p,
          );
          rows.push(row);
          await r
            .db("Account")
            .where({ id: row.id })
            .update({
              dateEdit: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
              passDateChange: 3000 - index,
            });
        }
        const expected: Record<string, number[]> = {
          name: [rows[1]!.id, rows[2]!.id, rows[0]!.id],
          login: [rows[2]!.id, rows[0]!.id, rows[1]!.id],
          url: rows.map((row) => row.id),
          expiry: rows.map((row) => row.id).reverse(),
          updated: rows.map((row) => row.id),
          category: rows.map((row) => row.id),
          client: rows.map((row) => row.id),
        };
        for (const [sort, ascending] of Object.entries(expected)) {
          for (const direction of ["asc", "desc"]) {
            const ids =
              direction === "asc" || ["category", "client"].includes(sort)
                ? ascending
                : [...ascending].reverse();
            const query = { tag: "sorting-check", sort, direction };
            const result = await r.accounts.find({ ...p, query });
            expect(
              result.data.map((row) => row.id),
              `${sort} ${direction}`,
            ).toEqual(ids);
            for (let skip = 0; skip < ids.length; skip++) {
              const page = await r.accounts.find({
                ...p,
                query: { ...query, limit: 1, skip },
              });
              expect(page.total).toBe(3);
              expect(page.data.map((row) => row.id)).toEqual([ids[skip]]);
            }
          }
        }
        for (const sort of ["name", "updated"]) {
          const result = await r.accounts.find({
            ...p,
            query: { tag: "sorting-check", sort },
          });
          expect(result.data.map((row) => row.id)).toEqual(
            sort === "updated"
              ? [...expected[sort]!].reverse()
              : expected[sort],
          );
        }
      } finally {
        for (const row of rows) await r.accounts.remove(row.id, p);
      }
    });
    it("encrypts attachments, validates MIME and consumes bounded public links atomically", async () => {
      const p = await r.params(),
        content = Buffer.from("a safe synthetic note"),
        file = await r.resources.upload(
          account.id,
          { name: "note.txt", content: content.toString("base64") },
          p,
        );
      expect(
        (await r.db("AccountFile").where({ id: file.id }).first()).content
          .length,
      ).toBe(0);
      expect((await r.resources.download(file.id, p)).content).toEqual(content);
      expect(await r.resources.files(account.id, p)).toHaveLength(1);
      for (const name of [
        "../../bad.txt",
        "script.html",
        "fake.pdf",
        "note.exe",
      ])
        await expect(
          r.resources.upload(
            account.id,
            { name, content: content.toString("base64") },
            p,
          ),
        ).rejects.toThrow();
      await expect(
        r.resources.upload(account.id, { name: "x.txt", content: "!bad!" }, p),
      ).rejects.toThrow();
      await expect(r.resources.download(99999, p)).rejects.toThrow();
      const link = await r.resources.share(
        account.id,
        { seconds: 60, views: 1 },
        p,
      );
      expect(await r.resources.links(account.id, p)).toHaveLength(1);
      await expect(r.resources.share(account.id, {}, p)).rejects.toThrow(
        "already",
      );
      const attempts = await Promise.allSettled([
        r.resources.reveal(link.hash),
        r.resources.reveal(link.hash),
      ]);
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          attempts.find(
            (a) => a.status === "fulfilled",
          ) as PromiseFulfilledResult<Row>
        ).value.password,
      ).toBe("third secret");
      expect(await r.resources.links(account.id, p)).toEqual([]);
      await expect(r.resources.reveal("invalid")).rejects.toThrow();
      await r.resources.revokeLink(link.id, p);
      await expect(r.resources.revokeLink(link.id, p)).rejects.toThrow();
      const expired = await r.resources.share(
        account.id,
        { views: 2, seconds: 60 },
        p,
      );
      await r
        .db("PublicLink")
        .where({ id: expired.id })
        .update({ dateExpire: 0 });
      await expect(r.resources.reveal(expired.hash)).rejects.toThrow();
      await r.resources.revokeLink(expired.id, p);
      await r.resources.deleteFile(file.id, p);
      await expect(r.resources.deleteFile(file.id, p)).rejects.toThrow();
    });
    it("hides inactive public links and replaces them without manual revocation", async () => {
      const p = await r.params(),
        row = await r.accounts.create({ ...input, name: "Share lifecycle" }, p),
        now = Math.floor(Date.now() / 1000),
        clock = vi.spyOn(Date, "now").mockReturnValue(now * 1000);
      try {
        for (const limits of [
          { dateExpire: now, maxCountViews: 3, countViews: 0 },
          { dateExpire: now - 1, maxCountViews: 0, countViews: 0 },
          { dateExpire: now + 60, maxCountViews: 1, countViews: 1 },
          { dateExpire: now + 60, maxCountViews: 1, countViews: 2 },
        ]) {
          const old = await r.resources.share(row.id, {}, p);
          await r.db("PublicLink").where({ id: old.id }).update(limits);
          expect(await r.resources.links(row.id, p)).toEqual([]);
          await expect(r.resources.reveal(old.hash)).rejects.toThrow(
            "Link unavailable",
          );
          const replacement = await r.resources.share(row.id, {}, p);
          expect(replacement.hash).not.toBe(old.hash);
          expect(await r.resources.links(row.id, p)).toMatchObject([
            { id: replacement.id, hash: replacement.hash, countViews: 0 },
          ]);
          expect(await r.db("PublicLink").where({ id: old.id })).toEqual([]);
          await expect(r.resources.reveal(old.hash)).rejects.toThrow(
            "Link unavailable",
          );
          expect((await r.resources.reveal(replacement.hash)).password).toBe(
            input.password,
          );
          await r.resources.revokeLink(replacement.id, p);
        }
        const unlimited = await r.resources.share(row.id, {}, p);
        await r.db("PublicLink").where({ id: unlimited.id }).update({
          maxCountViews: 0,
          countViews: 1000,
        });
        expect(await r.resources.links(row.id, p)).toHaveLength(1);
        await expect(r.resources.share(row.id, {}, p)).rejects.toThrow(
          "An active link already exists",
        );
        await r.db("PublicLink").where({ id: unlimited.id }).update({
          maxCountViews: 3,
          countViews: null,
        });
        expect(await r.resources.links(row.id, p)).toHaveLength(1);
        await expect(r.resources.share(row.id, {}, p)).rejects.toThrow(
          "An active link already exists",
        );
      } finally {
        clock.mockRestore();
        await r.accounts.remove(row.id, p);
      }
    });
    it("round-trips CSV, KeePass and authenticated sysPass XML and commits imports atomically", async () => {
      const p = await r.params(),
        transfer = new Transfer(r.db, r.auth, r.accounts);
      for (const format of ["csv", "keepass", "syspass"]) {
        const exported = await transfer.export(format, testPassword, true, p),
          entries = await parseImport(format, exported.content, testPassword);
        expect(entries[0]!.name).toBe(input.name);
        expect(entries[0]!.password).toBe("third secret");
        if (format === "syspass") {
          await expect(
            parseImport(format, exported.content, "wrong"),
          ).rejects.toThrow();
          expect(entries[0]!.tags).toEqual(["ops", "vault"]);
        }
      }
      await expect(transfer.export("csv", "", false, p)).rejects.toThrow();
      await expect(transfer.export("unknown", "", true, p)).rejects.toThrow();
      for (const [format, source] of [
        ["csv", "unknown,name\nx,y"],
        ["keepass", "<KeePassFile/>"],
        ["syspass", "<Root/>"],
        ["keepass", "<!DOCTYPE x><x/>"],
        ["csv", "name\n"],
        ["unsupported", "x"],
      ])
        await expect(parseImport(format!, source!)).rejects.toThrow();
      const entries = await parseImport(
        "csv",
        'name,login,password,notes\nImported,robot,secret,"Unicode 日本"',
      );
      await expect(
        transfer.commit(
          entries,
          { categoryId: 99999, clientId: 1, userGroupId: 1 },
          p,
        ),
      ).rejects.toThrow();
      expect(
        (await r.accounts.find({ ...p, query: { search: "Imported" } })).total,
      ).toBe(0);
      expect(
        await transfer.commit(
          entries,
          { categoryId: 1, clientId: 1, userGroupId: 1 },
          p,
        ),
      ).toEqual({ count: 1 });
    });
    it("issues expiring action-scoped tokens, preserves JSON-RPC shapes and denies scope escalation", async () => {
      const p = await r.params(),
        tokens = new Tokens(r.db, r.auth),
        issued = await tokens.create(
          {
            methods: ["account/search", "account/viewPass", "account/editPass"],
            password: testPassword,
            expiresAt: Date.now() + 3600000,
          },
          p,
        );
      expect((await tokens.list(p))[0]).not.toHaveProperty("token");
      const call = async (method: string, params: Row = {}) => {
        const ctx = {
          request: {
            body: {
              jsonrpc: "2.0",
              id: 1,
              method,
              params: { authToken: issued.token, ...params },
            },
          },
          ip: "127.0.0.1",
        } as unknown as Context;
        await jsonRpc(ctx, r.auth, r.accounts);
        return ctx.body as Row;
      };
      expect((await call("account/search")).result.count).toBeGreaterThan(0);
      expect(
        (
          await call("account/viewPass", {
            id: account.id,
            tokenPass: testPassword,
          })
        ).result.result.password,
      ).toBe("third secret");
      expect(
        (await call("account/viewPass", { id: account.id, tokenPass: "wrong" }))
          .error,
      ).toBeDefined();
      expect(
        (await call("account/delete", { id: account.id })).error,
      ).toBeDefined();
      expect((await call("unknown")).error.code).toBe(-32601);
      expect(
        (
          await call("account/editPass", {
            id: account.id,
            pass: "rpc value",
            tokenPass: testPassword,
          })
        ).result.resultCode,
      ).toBe(0);
      const rows = await tokens.list(p);
      await r
        .db("nodepass_settings")
        .where({ id: `token/${rows[0]!.id}` })
        .update({ value: JSON.stringify({ expiresAt: 1 }) });
      expect((await call("account/search")).error).toBeDefined();
      for (const row of rows) await tokens.remove(row.id, p);
      await expect(tokens.remove(99999, p)).rejects.toThrow();
      await expect(
        tokens.create(
          { methods: ["root/admin"], expiresAt: Date.now() + 3600000 },
          p,
        ),
      ).rejects.toThrow();
    });
    it("keeps integration credentials encrypted and rejects unsafe endpoints and fields", async () => {
      const service = new Integrations(r.db, r.vault, {});
      for (const name of ["smtp", "syslog", "wiki", "directory", "sso"]) {
        expect(await service.view(name)).toBeTypeOf("object");
      }
      await service.save(
        "smtp",
        { enabled: false, password: "synthetic smtp secret" },
        1,
      );
      expect(await service.view("smtp")).toHaveProperty(
        "passwordConfigured",
        true,
      );
      expect(JSON.stringify(await service.view("smtp"))).not.toContain(
        "synthetic smtp secret",
      );
      expect(
        await r.vault.configuration("integration/smtp", {}),
      ).toHaveProperty("password", "synthetic smtp secret");
      await service.mail("Ignored", "Disabled");
      await service.syslog("Ignored", null, null);
      for (const [name, data] of [
        ["unknown", {}],
        ["smtp", { root: true }],
        [
          "smtp",
          {
            enabled: true,
            host: "bad;host",
            port: 587,
            from: "test@example.org",
          },
        ],
        ["smtp", { recipients: "not mail" }],
        ["syslog", { enabled: true, host: "host", port: 70000 }],
        ["wiki", { enabled: true, url: "http://local.invalid" }],
        [
          "directory",
          {
            ldapEnabled: "1",
            ldapServer: "ldap://example.org",
            ldapTlsEnabled: "0",
          },
        ],
        ["sso", { enabled: true, secret: "short" }],
      ])
        await expect(
          service.save(name as string, data as Row, 1),
        ).rejects.toThrow();
      await expect(service.wiki("page", "")).rejects.toThrow();
      await expect(service.wiki("page", "test")).rejects.toThrow("disabled");
    });
    it("applies matching fixed presets without granting rights and retains snapshots after deletion", async () => {
      const p = await r.params(),
        presets = new Presets(r.db),
        preset = await presets.save(
          undefined,
          {
            type: "account.private",
            userId: 1,
            userGroupId: null,
            userProfileId: null,
            fixed: true,
            priority: 1,
            data: { privateUser: true, privateGroup: false },
          },
          p,
        );
      await expect(
        r.accounts.create({ ...input, isPrivate: false }, p),
      ).rejects.toThrow("preset");
      const row = await r.accounts.create({ ...input, name: "With preset" }, p);
      expect(
        (await r.db("Account").where({ id: row.id }).first()).isPrivate,
      ).toBe(1);
      expect((await presets.list(p)).length).toBe(1);
      await presets.save(
        preset.id,
        {
          type: "account.private",
          userId: 1,
          userGroupId: null,
          userProfileId: null,
          fixed: false,
          priority: 2,
          data: { privateUser: false },
        },
        p,
      );
      await presets.remove(preset.id, p);
      await r.accounts.remove(row.id, p);
      expect(
        await r
          .db("AccountHistory")
          .where({ accountId: row.id, isDeleted: 1 })
          .first(),
      ).toBeDefined();
      await expect(
        presets.save(undefined, { type: "unsafe", fixed: true, data: {} }, p),
      ).rejects.toThrow();
    });
  },
);
