import { BadRequest, Forbidden, NotFound } from "@feathersjs/errors";
import type { GroupMember, Page } from "@nodepass/contracts";
import type { Database } from "../db.js";
import { identity, integer, type ServiceParams } from "./accounts.js";
import { enabled } from "./user-management.js";

/** Memberships disclose the same user metadata as the user management view. */
export async function groupMembers(
  db: Database,
  id: unknown,
  params: ServiceParams,
): Promise<Page<GroupMember>> {
  const { user } = identity(params);
  if (!user.isAdminApp && !enabled(user.profile.mgmUsers))
    throw new Forbidden("User management permission required");
  const groupId = integer(id);
  const query = params.query ?? {};
  if (
    Object.keys(query).some(
      (key) => !["membership", "limit", "skip"].includes(key),
    ) ||
    !["primary", "additional"].includes(query.membership)
  )
    throw new BadRequest("Invalid membership query");
  const pageNumber = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) => {
    if (value === undefined) return fallback;
    if (
      !["string", "number"].includes(typeof value) ||
      !/^(0|[1-9]\d*)$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new BadRequest("Invalid membership pagination");
    return Number(value);
  };
  const limit = pageNumber(query.limit, 25, 1, 100);
  const skip = pageNumber(query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!(await db("UserGroup").select("id").where({ id: groupId }).first()))
    throw new NotFound("Group not found");
  const members = db("User as u");
  if (query.membership === "primary") members.where("u.userGroupId", groupId);
  else
    members
      .whereNot("u.userGroupId", groupId)
      .whereExists(
        db("UserToUserGroup as m")
          .select(db.raw("1"))
          .where("m.userId", db.ref("u.id"))
          .where("m.userGroupId", groupId),
      );
  const count = await members.clone().count({ total: "u.id" }).first();
  const data = await members
    .select("u.id", "u.name", "u.login")
    .orderBy("u.name")
    .orderBy("u.login")
    .orderBy("u.id")
    .limit(limit)
    .offset(skip);
  return { total: Number(count?.total ?? 0), limit, skip, data };
}
