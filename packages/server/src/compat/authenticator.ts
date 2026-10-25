import { decryptDefuse } from "./defuse.js";
import { phpMap } from "./php.js";
export interface LegacyFactor {
  userId: number;
  enabled: boolean;
  secret: string;
  recoveryCodes: string[];
}
/** Official sysPass/plugin-Authenticator 2.2 AuthenticatorData, encrypted by PluginDataModel. */
export async function readAuthenticator(
  data: Buffer,
  key: Buffer,
  master: string,
  itemId: number,
): Promise<LegacyFactor> {
  const value = phpMap(
    await decryptDefuse(data.toString(), key.toString(), master),
  );
  const allowed = [
    "userId",
    "twofaEnabled",
    "date",
    "expireDays",
    "IV",
    "recoveryCodes",
    "lastRecoveryTime",
  ];
  if (
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    Number(value.userId) !== itemId ||
    ![0, 1, false, true].includes(value.twofaEnabled as number | boolean)
  )
    throw new Error("Unsupported Authenticator data");
  const enabled = Number(value.twofaEnabled) === 1,
    secret = typeof value.IV === "string" ? value.IV : "";
  if (enabled && !/^[A-Z2-7]{16,128}$/.test(secret))
    throw new Error("Invalid Authenticator secret");
  const codes =
    value.recoveryCodes && typeof value.recoveryCodes === "object"
      ? Object.values(value.recoveryCodes)
      : [];
  if (
    codes.some(
      (c) => typeof c !== "string" || c.length < 10 || c.length > 100,
    ) ||
    codes.length > 20
  )
    throw new Error("Invalid recovery codes");
  return { userId: itemId, enabled, secret, recoveryCodes: codes as string[] };
}
