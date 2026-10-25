import { createHash } from "node:crypto";
import { BadRequest, Forbidden, NotFound } from "@feathersjs/errors";
import {
  audit,
  getSetting,
  putSetting,
  type Database,
  type Row,
} from "../db.js";
import { actions } from "../compat/jsonrpc.js";
import { digest, token } from "../security/crypto.js";
import { checkStrength, hashPassword } from "../security/password.js";
import { mapData, type Auth } from "../security/auth.js";
import { identity, integer, type ServiceParams } from "./accounts.js";
import { matchingPresets } from "../compat/presets.js";
import { validatePreset } from "../compat/preset-validation.js";

export class Tokens {
  constructor(
    readonly db: Database,
    readonly auth: Auth,
  ) {}
  private manage(params: ServiceParams) {
    const id = identity(params);
    if (
      !id.user.isAdminApp &&
      id.user.profile.mgmApiTokens !== true &&
      id.user.profile.mgmApiTokens !== 1
    )
      throw new Forbidden("Token management permission required");
    return id;
  }
  async list(params: ServiceParams): Promise<Row[]> {
    const { user } = this.manage(params);
    const rows = await this.db("AuthToken")
      .modify((q) => {
        if (!user.isAdminApp) q.where({ userId: user.id });
      })
      .select("id", "userId", "actionId", "startDate");
    return Promise.all(
      rows.map(async (r: Row) => ({
        ...r,
        ...(await getSetting(this.db, `token/${r.id}`, {})),
        method:
          Object.entries(actions).find(([, id]) => id === r.actionId)?.[0] ??
          String(r.actionId),
      })),
    );
  }
  async create(data: Row, params: ServiceParams): Promise<Row> {
    const { user } = this.manage(params);
    this.auth.requireRecent(identity(params));
    if (
      Object.keys(data).some(
        (k) => !["userId", "methods", "password", "expiresAt"].includes(k),
      ) ||
      !Array.isArray(data.methods) ||
      !data.methods.length ||
      data.methods.length > 30 ||
      data.methods.some(
        (m) => typeof m !== "string" || !Object.hasOwn(actions, m),
      )
    )
      throw new BadRequest("Invalid token scopes");
    const userId = integer(data.userId ?? user.id);
    if (userId !== user.id && !user.isAdminApp)
      throw new Forbidden("Cannot issue tokens for another user");
    await this.auth.user(userId);
    const expiresAt = integer(
      data.expiresAt,
      Date.now() + 60000,
      Date.now() + 366 * 86400000,
    );
    const secret = data.methods.some((m: string) =>
      [4, 7, 8].includes(actions[m]!),
    );
    if (secret) checkStrength(data.password, await this.auth.policy());
    const hash = secret ? await hashPassword(data.password) : null,
      raw = token();
    await this.db.transaction(async (trx) => {
      for (const method of new Set<string>(data.methods)) {
        const [id] = await trx("AuthToken").insert({
          userId,
          token: `np1:${digest(raw)}`,
          actionId: actions[method],
          createdBy: user.id,
          startDate: Math.floor(Date.now() / 1000),
          hash,
          vault: null,
        });
        await putSetting(trx, `token/${id}`, { expiresAt });
      }
      await audit(trx, user.id, "token.create", userId);
    });
    return { token: raw, expiresAt };
  }
  async remove(id: number, params: ServiceParams): Promise<void> {
    const { user } = this.manage(params);
    this.auth.requireRecent(identity(params));
    const row = await this.db("AuthToken").where({ id }).first();
    if (!row || (!user.isAdminApp && row.userId !== user.id))
      throw new NotFound("Token not found");
    await this.db.transaction(async (trx) => {
      await trx("CustomFieldData")
        .where({ moduleId: 1001, itemId: id })
        .delete();
      await trx("AuthToken").where({ id }).delete();
      await trx("nodepass_settings")
        .where({ id: `token/${id}` })
        .delete();
      await audit(trx, user.id, "token.revoke", id);
    });
  }
}

export const presetTypes = [
  "account.permission",
  "account.tag",
  "account.password",
  "account.private",
  "session.timeout",
];
export class Presets {
  constructor(readonly db: Database) {}
  private manage(params: ServiceParams) {
    const { user } = identity(params);
    if (
      !user.isAdminApp &&
      user.profile.mgmItemsPreset !== true &&
      user.profile.mgmItemsPreset !== 1
    )
      throw new Forbidden("Preset management permission required");
    return user;
  }
  async list(params: ServiceParams, all = false): Promise<Row[]> {
    const { user } = identity(params);
    if (all) this.manage(params);
    if (!all)
      return (await matchingPresets(this.db, user)).map((row) => ({
        ...row,
        hash: undefined,
      }));
    const rows = await this.db("ItemPreset")
      .orderBy("priority", "desc")
      .orderBy("id", "desc")
      .limit(1000);
    return rows.map((r: Row) => ({
      ...r,
      data: mapData(r.data),
      hash: undefined,
    }));
  }
  async save(
    id: number | undefined,
    data: Row,
    params: ServiceParams,
  ): Promise<Row> {
    const user = this.manage(params);
    if (
      Object.keys(data).some(
        (k) =>
          ![
            "type",
            "userId",
            "userGroupId",
            "userProfileId",
            "fixed",
            "priority",
            "data",
          ].includes(k),
      ) ||
      !presetTypes.includes(data.type) ||
      typeof data.fixed !== "boolean" ||
      !data.data ||
      typeof data.data !== "object" ||
      Array.isArray(data.data)
    )
      throw new BadRequest("Invalid preset");
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
    if (
      Object.keys(data.data).some((k) => !fields[data.type]!.includes(k)) ||
      Buffer.byteLength(JSON.stringify(data.data)) > 20000
    )
      throw new BadRequest("Invalid preset data");
    await validatePreset(data.type, data.data);
    if (data.type === "account.permission")
      for (const [field, table] of [
        ["usersView", "User"],
        ["usersEdit", "User"],
        ["userGroupsView", "UserGroup"],
        ["userGroupsEdit", "UserGroup"],
      ] as const) {
        const ids = [
          ...new Set(
            Object.values(data.data[field] ?? {}).map((value) =>
              integer(value),
            ),
          ),
        ];
        if (
          ids.length &&
          (await this.db(table).whereIn("id", ids)).length !== ids.length
        )
          throw new BadRequest("Unknown permission preset reference");
      }
    const columns: Row = {
      type: data.type,
      fixed: Number(data.fixed),
      priority: integer(data.priority, 0, 255),
      data: `NPJ1:${JSON.stringify(data.data)}`,
    };
    for (const [field, table] of [
      ["userId", "User"],
      ["userGroupId", "UserGroup"],
      ["userProfileId", "UserProfile"],
    ]) {
      columns[field!] = data[field!] === null ? null : integer(data[field!]);
      if (
        columns[field!] !== null &&
        !(await this.db(table!).where({ id: columns[field!] }).first())
      )
        throw new BadRequest("Unknown preset target");
    }
    columns.hash = createHash("sha1")
      .update(JSON.stringify({ ...columns, data: undefined }))
      .digest("hex");
    const target = await this.db.transaction(async (trx) => {
      let target = id;
      if (target) {
        if (!(await trx("ItemPreset").where({ id: target }).update(columns)))
          throw new NotFound("Preset not found");
      } else {
        [target] = await trx("ItemPreset").insert(columns);
      }
      await audit(trx, user.id, "preset.save", target);
      return target!;
    });
    return { id: target, ...data };
  }
  async remove(id: number, params: ServiceParams): Promise<void> {
    const user = this.manage(params);
    await this.db.transaction(async (trx) => {
      await trx("ItemPreset").where({ id }).delete();
      await audit(trx, user.id, "preset.delete", id);
    });
  }
}
