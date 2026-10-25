import { BadRequest } from "@feathersjs/errors";
import type { Row } from "../db.js";
import { proxyMatcher } from "../security/proxy.js";
import { checkLegacyPattern } from "../security/regex.js";
const fields: Record<string, string[]> = {
  "account.private": ["privateUser", "privateGroup"],
  "account.permission": [
    "usersView",
    "usersEdit",
    "userGroupsView",
    "userGroupsEdit",
  ],
  "account.tag": ["tags"],
  "account.password": [
    "length",
    "useNumbers",
    "useLetters",
    "useSymbols",
    "useUpper",
    "useLower",
    "useImage",
    "expireTime",
    "score",
    "regex",
  ],
  "session.timeout": ["address", "mask", "timeout"],
};
export function sessionRange(value: Row): string {
  let address = String(value.address ?? "");
  if (value.mask) {
    const parts = String(value.mask).split(".");
    if (
      parts.length !== 4 ||
      parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255) ||
      address.includes("/")
    )
      throw new BadRequest("Invalid preset subnet mask");
    const bits = parts
      .map((p) => Number(p).toString(2).padStart(8, "0"))
      .join("");
    if (!/^1*0*$/.test(bits))
      throw new BadRequest("Invalid preset subnet mask");
    address += `/${bits.indexOf("0") === -1 ? 32 : bits.indexOf("0")}`;
  }
  proxyMatcher([address]);
  return address;
}
export async function validatePreset(type: string, value: Row): Promise<void> {
  if (
    !fields[type] ||
    Object.keys(value).some((k) => !fields[type]!.includes(k))
  )
    throw new BadRequest("Unsupported preset fields");
  const integer = (name: string, max: number, min = 0) => {
    if (
      value[name] !== undefined &&
      (!Number.isInteger(value[name]) || value[name] < min || value[name] > max)
    )
      throw new BadRequest(`Invalid preset ${name}`);
  };
  for (const flag of [
    "privateUser",
    "privateGroup",
    "useNumbers",
    "useLetters",
    "useSymbols",
    "useUpper",
    "useLower",
    "useImage",
  ])
    if (value[flag] !== undefined && ![true, false, 0, 1].includes(value[flag]))
      throw new BadRequest("Invalid preset flag");
  if (type === "account.password") {
    integer("length", 1000);
    integer("score", 4);
    integer("expireTime", 315360000);
    if (value.regex !== undefined) {
      if (typeof value.regex !== "string")
        throw new BadRequest("Invalid password pattern");
      await checkLegacyPattern(value.regex, "", true);
    }
  }
  if (type === "account.permission") {
    for (const name of fields[type]!) {
      if (value[name] === undefined) continue;
      const list = value[name];
      if (
        !list ||
        typeof list !== "object" ||
        Object.values(list).length > 100 ||
        Object.values(list).some(
          (id) =>
            !Number.isInteger(Number(id)) ||
            Number(id) < 1 ||
            Number(id) > 2147483647,
        )
      )
        throw new BadRequest("Invalid preset grants");
    }
  }
  if (type === "account.tag" && value.tags !== undefined) {
    if (
      !value.tags ||
      typeof value.tags !== "object" ||
      Object.values(value.tags).length > 30 ||
      Object.values(value.tags).some(
        (tag) => typeof tag !== "string" || !tag || tag.length > 45,
      )
    )
      throw new BadRequest("Invalid preset tags");
  }
  if (type === "session.timeout") {
    sessionRange(value);
    if (value.timeout === undefined)
      throw new BadRequest("Preset timeout required");
    integer("timeout", 3600, 60);
  }
}
