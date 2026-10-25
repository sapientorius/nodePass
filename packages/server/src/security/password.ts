import argon2 from "argon2";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import type { SecurityPolicy } from "@nodepass/contracts";
import { BadRequest, TooManyRequests } from "@feathersjs/errors";
zxcvbnOptions.setOptions({
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...english.dictionary },
  translations: english.translations,
});
let pending = 0;
export async function bounded<T>(job: () => Promise<T>): Promise<T> {
  if (pending >= 4)
    throw new TooManyRequests("Authentication capacity reached");
  pending++;
  try {
    return await job();
  } finally {
    pending--;
  }
}
export function checkStrength(
  password: string,
  policy: Pick<SecurityPolicy, "minLength" | "minScore">,
): void {
  if (typeof password !== "string") throw new BadRequest("Invalid password");
  const length = Array.from(password).length;
  if (
    length < policy.minLength ||
    length > 128 ||
    Buffer.byteLength(password) > 512 ||
    zxcvbn(password).score < policy.minScore
  )
    throw new BadRequest(
      "Password does not meet the configured strength policy",
    );
}
export const hashPassword = (password: string): Promise<string> =>
  bounded(() =>
    argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    }),
  );
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (Buffer.byteLength(password) > 4096 || !hash) return false;
  return bounded(async () => {
    if (hash.startsWith("$argon2id$")) {
      // Bound attacker-controlled cost parameters, including imported hashes.
      const params = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
      if (
        !params ||
        Number(params[1]) > 262144 ||
        Number(params[2]) > 10 ||
        Number(params[3]) > 8
      )
        return false;
      try {
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    }
    if (!/^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(hash))
      return false;
    // Match SP\Core\Crypt\Hash: mb_strlen, then SHA-256 hex, then bcrypt's 72-byte cap.
    const value =
      Array.from(password).length > 72
        ? createHash("sha256").update(password).digest("hex")
        : password;
    return bcrypt.compare(value, hash.replace(/^\$2y\$/, "$2b$"));
  });
}
