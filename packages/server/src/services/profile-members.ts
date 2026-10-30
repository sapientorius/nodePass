import { BadRequest, NotFound } from "@feathersjs/errors";
import type { MemberSummary, Page } from "@nodepass/contracts";
import type { Database } from "../db.js";
import { integer, type ServiceParams } from "./accounts.js";
import {
  assertMembersReadable,
  memberPagination,
  memberPage,
} from "./members.js";

export async function profileMembers(
  db: Database,
  id: unknown,
  params: ServiceParams,
): Promise<Page<MemberSummary>> {
  assertMembersReadable(params);
  const profileId = integer(id);
  const query = params.query ?? {};
  if (Object.keys(query).some((key) => !["limit", "skip"].includes(key)))
    throw new BadRequest("Invalid membership query");
  const pagination = memberPagination(query);
  if (!(await db("UserProfile").select("id").where({ id: profileId }).first()))
    throw new NotFound("Profile not found");
  return memberPage(
    db("User as u").where("u.userProfileId", profileId),
    pagination,
  );
}
