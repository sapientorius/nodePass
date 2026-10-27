import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedDatabase } from "./database.js";
import { seedLegacy, legacyReference } from "./legacy.js";
import { loadConfig } from "../packages/server/src/config.js";
import { database, getSetting } from "../packages/server/src/db.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { Migration } from "../packages/server/src/migration/service.js";
import { Accounts } from "../packages/server/src/services/accounts.js";

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "legacy account permission preservation",
  () => {
    it.each([false, true])(
      "preserves memberships, grants, roles, privacy and secondary-group access=%s through takeover and restart",
      async (fullGroupAccess) => {
        const isolated = await isolatedDatabase(loadConfig());
        const directory = await mkdtemp(
          join(tmpdir(), "nodepass-acl-migration-"),
        );
        const config = {
          ...isolated.config,
          dataDir: directory,
          legacy: {
            passwordSalt: legacyReference.publicLink.salt,
            accountFullGroupAccess: fullGroupAccess ? "1" : "0",
          },
        };
        const db = database(config);
        let vault = new Vault(db, config.deploymentKey);
        try {
          await seedLegacy(db);
          await db("UserToUserGroup").insert({ userId: 2, userGroupId: 1 });
          const permissionSnapshot = async () => ({
            users: await db("User")
              .select(
                "id",
                "userGroupId",
                "userProfileId",
                "isAdminApp",
                "isAdminAcc",
                "isDisabled",
              )
              .orderBy("id"),
            memberships: await db("UserToUserGroup")
              .select("userId", "userGroupId")
              .orderBy(["userId", "userGroupId"]),
            userGrants: await db("AccountToUser")
              .select("accountId", "userId", "isEdit")
              .orderBy(["accountId", "userId"]),
            groupGrants: await db("AccountToUserGroup")
              .select("accountId", "userGroupId", "isEdit")
              .orderBy(["accountId", "userGroupId"]),
            accounts: await db("Account")
              .select(
                "id",
                "userId",
                "userGroupId",
                "isPrivate",
                "isPrivateGroup",
              )
              .orderBy("id"),
          });
          const before = await permissionSnapshot();
          await new Migration(db, vault, config).takeover({
            login: "admin",
            password: "a".repeat(72),
            masterPassword: legacyReference.master,
            maintenance: true,
            token: config.setupToken,
          });
          expect(await permissionSnapshot()).toEqual(before);
          expect(await getSetting(db, "fullGroupAccess", null)).toBe(
            fullGroupAccess,
          );
          expect(await new Accounts(db, vault).fullGroup()).toBe(
            fullGroupAccess,
          );
          vault.destroy();
          vault = new Vault(db, config.deploymentKey);
          await vault.load();
          expect(await new Accounts(db, vault).fullGroup()).toBe(
            fullGroupAccess,
          );
          expect(await permissionSnapshot()).toEqual(before);
        } finally {
          vault.destroy();
          await db.destroy();
          await isolated.drop();
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
  },
);
