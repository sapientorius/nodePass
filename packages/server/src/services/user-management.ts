import { Forbidden, NotAuthenticated } from "@feathersjs/errors";
import type { UserManagement } from "@nodepass/contracts";
import type { Database, Row } from "../db.js";
import { Auth } from "../security/auth.js";
import type { Principal } from "../security/policy.js";
import { identity, type ServiceParams } from "./accounts.js";

export const enabled = (value: unknown): boolean =>
  value === true || value === 1;
export function userManagement(
  user: Principal,
  target: Row,
  profile: Record<string, unknown>,
): UserManagement {
  const reason = user.isAdminApp
    ? undefined
    : !enabled(user.profile.mgmUsers)
      ? "permission"
      : user.id === target.id
        ? "self"
        : target.isAdminApp || target.isAdminAcc
          ? "administrator"
          : [target.userGroupId, ...target.groups].some(
                (group) =>
                  group !== user.userGroupId && !user.groups.includes(group),
              )
            ? "groups"
            : Object.entries(profile).some(
                  ([key, value]) =>
                    enabled(value) && !enabled(user.profile[key]),
                )
              ? "profile"
              : undefined;
  return {
    canEdit: reason === undefined,
    canResetPassword:
      reason === undefined &&
      (!!user.isAdminApp || enabled(user.profile.mgmUsersResetPassword)),
    ...(reason ? { reason } : {}),
  };
}
export function assertUserEditable(management: UserManagement): void {
  const messages = {
    permission: "Management permission required",
    self: "Administrator required for privilege changes",
    administrator: "Administrator required",
    groups: "Cannot manage a user in another group",
    profile: "Cannot manage a user with greater permissions",
  };
  if (management.reason) throw new Forbidden(messages[management.reason]);
}

/** Every user/profile writer takes this lock before reading authorization state. */
export async function lockUserManagement(db: Database): Promise<void> {
  const id = "user-management-lock";
  await db("nodepass_settings")
    .insert({ id, value: "null" })
    .onConflict("id")
    .ignore();
  await db("nodepass_settings").where({ id }).forUpdate().first();
}
export async function managementParams(
  db: Database,
  auth: Auth,
  params: ServiceParams,
): Promise<ServiceParams> {
  const previous = identity(params);
  const session = await db("nodepass_sessions")
    .where({ id: previous.session.id, userId: previous.user.id })
    .forUpdate()
    .first();
  const currentAuth = new Auth(db, auth.config, auth.vault);
  const policy = await currentAuth.policy();
  const now = Date.now();
  if (
    !session ||
    !session.complete ||
    now - Number(session.lastSeen) > policy.sessionIdleSeconds * 1000 ||
    now - Number(session.createdAt) > policy.sessionAbsoluteSeconds * 1000
  )
    throw new NotAuthenticated("Session expired");
  const user = await currentAuth.user(previous.user.id);
  const factor = await db("nodepass_factors")
    .where({ userId: user.id, confirmed: 1 })
    .first();
  if (
    !Number(session.verifiedAt) &&
    (factor ||
      policy.mfa === "everyone" ||
      (policy.mfa === "admins" && (user.isAdminApp || user.isAdminAcc)))
  )
    throw new Forbidden("Complete multi-factor authentication", {
      code: "MFA_REQUIRED",
    });
  return { ...params, identity: { user, session } };
}
