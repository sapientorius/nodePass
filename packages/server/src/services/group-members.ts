import { BadRequest, NotFound } from "@feathersjs/errors";
import type { GroupMember, Page } from "@nodepass/contracts";
import type { Database } from "../db.js";
import { integer, type ServiceParams } from "./accounts.js";
import {
  assertMembersReadable,
  memberPagination,
  memberPage,
} from "./members.js";

/** Memberships disclose the same user metadata as the user management view. */
export async function groupMembers(
  db: Database,
  id: unknown,
  params: ServiceParams,
): Promise<Page<GroupMember>> {
  assertMembersReadable(params);
  const groupId = integer(id);
  const query = params.query ?? {};
  if (
    Object.keys(query).some(
      (key) => !["membership", "limit", "skip"].includes(key),
    ) ||
    !["primary", "additional"].includes(query.membership)
  )
    throw new BadRequest("Invalid membership query");
  const pagination = memberPagination(query);
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
  return memberPage(members, pagination);
}
