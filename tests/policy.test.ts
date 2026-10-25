import { describe, it, expect } from "vitest";
import {
  can,
  type Principal,
  type AccountAction,
} from "../packages/server/src/security/policy.js";
const user: Principal = {
  id: 1,
  userGroupId: 10,
  groups: [11],
  isAdminApp: 0,
  isAdminAcc: 0,
  isDisabled: 0,
  profile: {
    accView: true,
    accViewPass: true,
    accEdit: true,
    accAdd: true,
    accDelete: true,
    accPermission: true,
    accFiles: true,
    accViewHistory: true,
    accPublicLinks: true,
    accEditPass: true,
  },
};
const base = { userId: 2, userGroupId: 20 };
describe("independent authorization truth table", () => {
  it.each([
    ["no relation", {}, false, false],
    ["owner", { userId: 1 }, true, true],
    ["main group", { userGroupId: 10 }, true, true],
    ["secondary membership", { userGroupId: 11 }, true, true],
    ["direct read", { users: [{ userId: 1, isEdit: 0 }] }, true, false],
    ["direct edit", { users: [{ userId: 1, isEdit: 1 }] }, true, true],
    ["group read", { groups: [{ userGroupId: 10, isEdit: 0 }] }, true, false],
    [
      "unrelated group",
      { groups: [{ userGroupId: 99, isEdit: 1 }] },
      false,
      false,
    ],
    [
      "private",
      { userId: 2, isPrivate: 1, groups: [{ userGroupId: 10, isEdit: 1 }] },
      false,
      false,
    ],
  ] as const)("%s", (_name, patch, view, edit) => {
    const account = { ...base, ...patch };
    expect(can(user, "view", account)).toBe(view);
    expect(can(user, "secret", account)).toBe(view);
    expect(can(user, "edit", account)).toBe(edit);
    expect(can(user, "delete", account)).toBe(edit);
  });
  it("denies disabled users and missing profile capabilities", () => {
    for (const action of [
      "view",
      "secret",
      "create",
      "edit",
      "editSecret",
      "delete",
      "history",
      "files",
      "share",
      "permissions",
    ] as AccountAction[]) {
      expect(
        can({ ...user, isDisabled: 1 }, action, { ...base, userId: 1 }),
      ).toBe(false);
      expect(
        can({ ...user, profile: {} }, action, { ...base, userId: 1 }),
      ).toBe(false);
    }
    expect(can(user, "view")).toBe(false);
    expect(can(user, "create")).toBe(true);
  });
  it("does not broaden secondary-group grants without the setting", () => {
    const account = { ...base, groups: [{ userGroupId: 11, isEdit: 1 }] };
    expect(can(user, "view", account)).toBe(false);
    expect(can(user, "view", account, true)).toBe(true);
    expect(can({ ...user, isAdminApp: 1 }, "view", base)).toBe(true);
    expect(
      can({ ...user, isAdminApp: 1 }, "view", { ...base, isPrivate: 1 }),
    ).toBe(false);
  });
  it("constrains private groups independently of ownership or administrator status", () => {
    expect(can(user, "view", { ...base, isPrivateGroup: 1 })).toBe(false);
    expect(
      can(user, "view", { ...base, userGroupId: 10, isPrivateGroup: 1 }),
    ).toBe(true);
    expect(
      can(user, "view", { ...base, userGroupId: 11, isPrivateGroup: 1 }),
    ).toBe(true);
    expect(
      can({ ...user, isAdminApp: 1 }, "view", { ...base, isPrivateGroup: 1 }),
    ).toBe(false);
  });
});
