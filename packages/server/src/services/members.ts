import { BadRequest, Forbidden } from "@feathersjs/errors";
import type { MemberSummary, Page } from "@nodepass/contracts";
import type { Database } from "../db.js";
import { identity, type ServiceParams } from "./accounts.js";
import { enabled } from "./user-management.js";

export function assertMembersReadable(params: ServiceParams): void {
  const { user } = identity(params);
  if (!user.isAdminApp && !enabled(user.profile.mgmUsers))
    throw new Forbidden("User management permission required");
}
export function memberPagination(query: Record<string, unknown>): {
  limit: number;
  skip: number;
} {
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
  return {
    limit: pageNumber(query.limit, 25, 1, 100),
    skip: pageNumber(query.skip, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
export async function memberPage(
  members: ReturnType<Database>,
  pagination: { limit: number; skip: number },
): Promise<Page<MemberSummary>> {
  const count = await members.clone().count({ total: "u.id" }).first();
  const data = await members
    .select("u.id", "u.name", "u.login")
    .orderBy("u.name")
    .orderBy("u.login")
    .orderBy("u.id")
    .limit(pagination.limit)
    .offset(pagination.skip);
  return { total: Number(count?.total ?? 0), ...pagination, data };
}
