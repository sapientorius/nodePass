import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { harness, testPassword } from "./harness.js";
import { Catalogue } from "../packages/server/src/services/catalogue.js";
import { Presets } from "../packages/server/src/services/management.js";
import { matchingPresets } from "../packages/server/src/compat/presets.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "delegated management and effective presets on real storage",
  () => {
    let r: Awaited<ReturnType<typeof harness>>,
      users: Catalogue,
      presets: Presets,
      readerId: number,
      managerId: number,
      readerProfile: number,
      foreignProfile: number;
    beforeAll(async () => {
      r = await harness();
      users = new Catalogue(r.db, "users", r.auth);
      presets = new Presets(r.db);
      const p = await r.params(),
        profiles = new Catalogue(r.db, "profiles", r.auth);
      readerProfile = (
        await profiles.create(
          { name: "Scoped reader", profile: { accView: true } },
          p,
        )
      ).id;
      foreignProfile = (
        await profiles.create(
          {
            name: "Greater permissions",
            profile: { accView: true, configBackup: true },
          },
          p,
        )
      ).id;
      const managerProfile = (
        await profiles.create(
          {
            name: "Scoped manager",
            profile: {
              mgmUsers: true,
              mgmUsersResetPassword: true,
              accView: true,
            },
          },
          p,
        )
      ).id;
      readerId = (
        await users.create(
          {
            name: "Reader",
            login: "reader",
            userGroupId: 1,
            userProfileId: readerProfile,
            password: testPassword,
            groups: [],
          },
          p,
        )
      ).id;
      managerId = (
        await users.create(
          {
            name: "Manager",
            login: "manager",
            userGroupId: 1,
            userProfileId: managerProfile,
            password: testPassword,
          },
          p,
        )
      ).id;
      await r.db("UserGroup").insert({ id: 2, name: "Foreign group" });
    });
    afterAll(async () => {
      await r?.dispose();
    });
    it("allows a manager to create a scoped user, while rejecting privilege and group escalation", async () => {
      const manager = await r.params(managerId),
        data = {
          name: "Delegated user",
          login: "delegated",
          userGroupId: 1,
          userProfileId: readerProfile,
          password: testPassword,
          groups: [1],
        };
      const created = await users.create(data, manager);
      expect(created.groups).toEqual([1]);
      expect(created).not.toHaveProperty("pass");
      for (const patch of [
        { isAdminApp: true },
        { isAdminAcc: false },
        { userProfileId: foreignProfile },
        { userGroupId: 2 },
        { groups: [2] },
      ])
        await expect(
          users.create({ ...data, login: "escalate", ...patch }, manager),
        ).rejects.toThrow();
      await expect(
        users.patch(1, { ...data, login: "admin" }, manager),
      ).rejects.toThrow("Administrator");
      await expect(
        users.patch(managerId, { ...data, login: "manager" }, manager),
      ).rejects.toThrow("privilege");
      await users.patch(
        readerId,
        { ...data, login: "reader", groups: [] },
        manager,
      );
      expect((await users.get(readerId, manager)).name).toBe("Delegated user");
      const root = await r.params();
      await users.patch(
        readerId,
        { ...data, login: "reader", userProfileId: foreignProfile },
        root,
      );
      await expect(
        users.patch(readerId, { ...data, login: "reader" }, manager),
      ).rejects.toThrow("greater");
      await users.patch(
        readerId,
        {
          ...data,
          login: "reader",
          userProfileId: readerProfile,
          userGroupId: 2,
        },
        root,
      );
      await expect(
        users.patch(readerId, { ...data, login: "reader" }, manager),
      ).rejects.toThrow("another group");
      await users.patch(
        readerId,
        { ...data, login: "reader", userProfileId: readerProfile },
        root,
      );
      await expect(
        new Catalogue(r.db, "categories", r.auth).create(
          { name: "No permission" },
          {
            ...manager,
            identity: {
              ...manager.identity!,
              user: {
                ...manager.identity!.user,
                profile: { mgmCategories: "true" },
              },
            },
          },
        ),
      ).rejects.toThrow("permission");
      const clients = new Catalogue(r.db, "clients", r.auth);
      await expect(
        clients.create({ name: "Invalid flag", isGlobal: "yes" }, root),
      ).rejects.toThrow("global");
      expect(
        (await clients.create({ name: "Shared client", isGlobal: true }, root))
          .isGlobal,
      ).toBe(1);
    });
    it("uses OR scopes and sysPass priority plus specificity, including secondary groups", async () => {
      const root = await r.params(),
        base = {
          type: "account.tag",
          fixed: false,
          priority: 1,
          userId: null,
          userGroupId: null,
          userProfileId: null,
          data: { tags: ["global"] },
        };
      const global = await presets.save(undefined, base, root);
      await r
        .db("UserToUserGroup")
        .insert({ userId: readerId, userGroupId: 2 });
      const grouped = await presets.save(
        undefined,
        { ...base, userGroupId: 2, data: { tags: ["secondary"] } },
        root,
      );
      const specific = await presets
        .save(
          undefined,
          { ...base, userId: readerId, userGroupId: 99999 },
          root,
        )
        .catch(() => undefined);
      expect(specific).toBeUndefined();
      const scoped = await presets.save(
        undefined,
        {
          ...base,
          userId: managerId,
          userProfileId: readerProfile,
          priority: 5,
          data: { tags: ["profile-or-user"] },
        },
        root,
      );
      const matching = await matchingPresets(
        r.db,
        (await r.params(readerId)).identity!.user,
      );
      expect(matching.map((p) => p.id)).toEqual([
        scoped.id,
        grouped.id,
        global.id,
      ]);
      expect(
        (await presets.list(await r.params(readerId))).map((p) => p.id),
      ).toEqual(matching.map((p) => p.id));
      await expect(
        presets.list(await r.params(readerId), true),
      ).rejects.toThrow("permission");
      await expect(
        presets.save(
          undefined,
          { ...base, type: "account.permission", data: { usersView: [99999] } },
          root,
        ),
      ).rejects.toThrow("reference");
      await r.db("ItemPreset").delete();
    });
    it("applies fixed privacy, permissions, tags and password patterns without bypass through later edits", async () => {
      const p = await r.params(),
        base = {
          fixed: true,
          priority: 10,
          userId: 1,
          userGroupId: null,
          userProfileId: null,
        };
      for (const [type, data] of [
        ["account.private", { privateUser: false, privateGroup: false }],
        [
          "account.permission",
          {
            usersView: [readerId],
            usersEdit: [],
            userGroupsView: [2],
            userGroupsEdit: [],
          },
        ],
        ["account.tag", { tags: ["mandatory"] }],
        [
          "account.password",
          {
            length: 12,
            useLetters: true,
            useLower: true,
            useUpper: true,
            useNumbers: true,
            useSymbols: true,
            regex: "^Saffron",
            expireTime: 3600,
          },
        ],
      ])
        await presets.save(undefined, { ...base, type, data }, p);
      const input = {
        name: "Preset account",
        categoryId: 1,
        clientId: 1,
        userGroupId: 1,
        password: "SaffronViolin83!",
      };
      for (const password of [
        "short",
        "saffronviolin83!",
        "SAFFRONVIOLIN83!",
        "SaffronViolin!!",
        "SaffronViolin83",
        "AnotherViolin83!",
      ])
        await expect(
          r.accounts.create({ ...input, password }, p),
        ).rejects.toThrow("preset");
      await expect(
        r.accounts.create({ ...input, isPrivate: true }, p),
      ).rejects.toThrow("privacy");
      const account = await r.accounts.create(input, p);
      expect(account.tags).toEqual(["mandatory"]);
      expect(account.passDateChange).toBeGreaterThan(Date.now() / 1000 + 3500);
      expect((await r.accounts.grants(account.id, p)).users).toEqual([
        { userId: readerId, isEdit: 0 },
      ]);
      await expect(
        r.accounts.setGrants(account.id, { users: [], groups: [] }, p),
      ).rejects.toThrow("fixed");
      await r.accounts.setGrants(
        account.id,
        {
          users: [{ userId: readerId, isEdit: false }],
          groups: [{ userGroupId: 2, isEdit: false }],
        },
        p,
      );
      await expect(
        r.accounts.changeSecret(account.id, "bad", account.version, p),
      ).rejects.toThrow("preset");
    });
  },
);
