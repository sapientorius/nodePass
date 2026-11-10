import { Forbidden, NotFound } from "@feathersjs/errors";
import { audit, type Database } from "../db.js";
import { Auth } from "../security/auth.js";
import { lockAuthState, saveAuthState } from "../security/auth-state.js";
import { identity, type ServiceParams } from "./accounts.js";
import { lockUserManagement, managementParams } from "./user-management.js";

export async function resetTotp(
  db: Database,
  auth: Auth,
  target: number,
  params: ServiceParams,
): Promise<void> {
  await db.transaction(async (trx) => {
    await lockUserManagement(trx);
    // Lock the target before the actor session, as sign-in can rotate a cookie
    // belonging to another user. This keeps that lock order consistent.
    const state = await lockAuthState(trx, target);
    const current = await managementParams(trx, auth, params);
    const actor = identity(current);
    if (!actor.user.isAdminApp)
      throw new Forbidden("Application administrator required");
    if (actor.user.id === target)
      throw new Forbidden("Cannot reset your own authenticator");
    auth.requireRecent(actor);
    if (!(await trx("User").where({ id: target }).forUpdate().first()))
      throw new NotFound("User not found");
    const passkey = await trx("nodepass_factors")
      .where({ userId: target, kind: "passkey", confirmed: 1 })
      .first();
    if (!Number.isSafeInteger(state.revision + 1))
      throw new Forbidden("Authentication revision exhausted");
    await saveAuthState(trx, target, {
      revision: state.revision + 1,
      enrollmentRequired: !passkey,
    });
    await trx("nodepass_factors")
      .where({ userId: target })
      .whereIn("kind", ["totp", "recovery"])
      .delete();
    await trx("nodepass_sessions").where({ userId: target }).delete();
    await trx("nodepass_challenges").where({ userId: target }).delete();
    await audit(trx, actor.user.id, "users.totp.reset", target);
  });
}
