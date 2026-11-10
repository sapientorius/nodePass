import { NotAuthenticated } from "@feathersjs/errors";
import type { Database } from "../db.js";

export interface AuthState {
  revision: number;
  enrollmentRequired: boolean;
}
export const initialAuthState: AuthState = {
  revision: 0,
  enrollmentRequired: false,
};
export async function authState(
  db: Database,
  userId: number,
): Promise<AuthState> {
  const row = await db("nodepass_settings")
    .where({ id: `auth-state/${userId}` })
    .first();
  if (!row) return { ...initialAuthState };
  const state = JSON.parse(row.value);
  if (
    !state ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    typeof state.enrollmentRequired !== "boolean"
  )
    throw new NotAuthenticated("Invalid authentication state");
  return state;
}
/** Call inside a transaction to serialize factor changes, session issuance and resets. */
export async function lockAuthState(
  db: Database,
  userId: number,
): Promise<AuthState> {
  const id = `auth-state/${userId}`;
  await db("nodepass_settings")
    .insert({ id, value: JSON.stringify(initialAuthState) })
    .onConflict("id")
    .ignore();
  await db("nodepass_settings").where({ id }).forUpdate().first();
  return authState(db, userId);
}
export async function saveAuthState(
  db: Database,
  userId: number,
  state: AuthState,
): Promise<void> {
  await db("nodepass_settings")
    .where({ id: `auth-state/${userId}` })
    .update({ value: JSON.stringify(state) });
}
