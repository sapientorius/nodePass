export interface Principal {
  id: number;
  userGroupId: number;
  isAdminApp: number;
  isAdminAcc: number;
  isDisabled: number;
  groups: number[];
  profile: Record<string, unknown>;
}
export interface ProtectedAccount {
  userId: number;
  userGroupId: number;
  isPrivate?: number;
  isPrivateGroup?: number;
  otherUserEdit?: number;
  otherUserGroupEdit?: number;
  users?: { userId: number; isEdit: number }[];
  groups?: { userGroupId: number; isEdit: number }[];
}
export type AccountAction =
  | "view"
  | "secret"
  | "create"
  | "edit"
  | "editSecret"
  | "delete"
  | "history"
  | "files"
  | "share"
  | "permissions";
const profileFlags: Record<AccountAction, string> = {
  view: "accView",
  secret: "accViewPass",
  create: "accAdd",
  edit: "accEdit",
  editSecret: "accEditPass",
  delete: "accDelete",
  history: "accViewHistory",
  files: "accFiles",
  share: "accPublicLinks",
  permissions: "accPermission",
};
export const isAdmin = (user: Principal): boolean =>
  user.isAdminApp === 1 || user.isAdminAcc === 1;
export function can(
  user: Principal,
  action: AccountAction,
  account?: ProtectedAccount,
  fullGroupAccess = false,
): boolean {
  if (user.isDisabled === 1) return false;
  if (!(
    isAdmin(user) ||
    user.profile[profileFlags[action]] === true ||
    user.profile[profileFlags[action]] === 1
  ))
    return false;
  if (action === "create") return true;
  if (!account) return false;
  // Private flags always constrain even application administrators, matching search privacy semantics.
  if (account.isPrivate === 1 && account.userId !== user.id) return false;
  if (
    account.isPrivateGroup === 1 &&
    account.userGroupId !== user.userGroupId &&
    !user.groups.includes(account.userGroupId)
  )
    return false;
  let view = false,
    edit = false;
  if (
    isAdmin(user) ||
    account.userId === user.id ||
    account.userGroupId === user.userGroupId
  )
    view = edit = true;
  else {
    const direct = account.users?.find((v) => v.userId === user.id);
    if (direct) {
      view = true;
      edit = direct.isEdit === 1;
    } else if (user.groups.includes(account.userGroupId)) view = edit = true;
    else {
      const group = account.groups?.find(
        (v) =>
          v.userGroupId === user.userGroupId ||
          (fullGroupAccess && user.groups.includes(v.userGroupId)),
      );
      if (group) {
        view = true;
        edit = group.isEdit === 1;
      }
    }
  }
  return ["edit", "editSecret", "delete", "permissions", "share"].includes(
    action,
  )
    ? edit
    : view;
}
