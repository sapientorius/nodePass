import { Forbidden, BadRequest } from "@feathersjs/errors";
import { audit, getSetting, type Database, type Row } from "../db.js";
import { verifyPassword } from "./password.js";
import { digest, token } from "./crypto.js";
import type { Vault } from "./vault.js";
/** Offline operator operation, deliberately not registered as an HTTP service. */
export async function emergencyRecovery(
  db: Database,
  vault: Vault,
  input: Row,
): Promise<string> {
  if (
    Object.keys(input).some(
      (k) => !["login", "password", "maintenance", "reason"].includes(k),
    ) ||
    input.maintenance !== true ||
    input.reason !== "factor-loss" ||
    typeof input.login !== "string" ||
    typeof input.password !== "string" ||
    input.password.length > 4096
  )
    throw new BadRequest("Explicit factor-loss maintenance input required");
  if (!vault.unlocked || !(await getSetting(db, "initialized", false)))
    throw new Forbidden("Initialized deployment key custody required");
  const user = await db("User").where({ login: input.login }).first();
  if (
    !user ||
    user.isDisabled ||
    !user.isAdminApp ||
    user.isLdap ||
    !(await verifyPassword(input.password, Buffer.from(user.pass).toString()))
  )
    throw new Forbidden("Valid local application administrator required");
  const code = token();
  await db.transaction(async (trx) => {
    await trx("nodepass_factors").insert({
      userId: user.id,
      kind: "recovery",
      name: "Operator recovery",
      data: digest(code),
      confirmed: 1,
      counter: 0,
    });
    await trx("nodepass_sessions").where({ userId: user.id }).delete();
    await audit(trx, user.id, "auth.emergency.recovery", user.id);
  });
  return code;
}
