import type { Database, Row } from "../db.js";
import type { Principal } from "../security/policy.js";
import { mapData } from "./data.js";
/** sysPass scopes are ORed, with priority plus user/group/profile specificity. */
export async function matchingPresets(
  db: Database,
  user: Principal,
): Promise<Row[]> {
  const owner = await db("User").where({ id: user.id }).first();
  const rows = await db("ItemPreset")
    .where((q) =>
      q
        .where("userId", user.id)
        .orWhereIn("userGroupId", [user.userGroupId, ...user.groups])
        .orWhere("userProfileId", owner.userProfileId)
        .orWhere((q) =>
          q
            .whereNull("userId")
            .whereNull("userGroupId")
            .whereNull("userProfileId"),
        ),
    )
    .orderByRaw(
      "CASE WHEN userId IS NOT NULL THEN priority + 3 WHEN userGroupId IS NOT NULL THEN priority + 2 WHEN userProfileId IS NOT NULL THEN priority + 1 ELSE priority END DESC",
    )
    .orderBy("id", "desc")
    .limit(1000);
  return rows.map((row: Row) => ({ ...row, data: mapData(row.data) }));
}
