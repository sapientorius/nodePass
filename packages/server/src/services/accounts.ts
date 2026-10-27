import { Fields } from "./fields.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "@feathersjs/errors";
import type { Id, Params } from "@feathersjs/feathers";
import { Ajv } from "@feathersjs/schema";
import { getValidator } from "@feathersjs/typebox";
import {
  accountInput,
  type AccountInput,
  type Account,
  type Page,
} from "@nodepass/contracts";
import { createHash } from "node:crypto";
import { audit, getSetting, type Database, type Row } from "../db.js";
import {
  can,
  hasAccountCapability,
  isAdmin,
  type AccountAction,
} from "../security/policy.js";
import type { RequestIdentity } from "../security/auth.js";
import { matchingPresets } from "../compat/presets.js";
import { checkLegacyPattern } from "../security/regex.js";
import type { Vault } from "../security/vault.js";
export type ServiceParams = Params & { identity?: RequestIdentity };
const validate = getValidator(accountInput, new Ajv({ allErrors: false }));
const flags: AccountAction[] = [
  "view",
  "secret",
  "edit",
  "editSecret",
  "delete",
  "history",
  "files",
  "share",
  "permissions",
];
const publicFields = [
  "id",
  "name",
  "login",
  "url",
  "notes",
  "categoryId",
  "clientId",
  "userGroupId",
  "userId",
  "isPrivate",
  "isPrivateGroup",
  "otherUserEdit",
  "otherUserGroupEdit",
  "parentId",
  "passDate",
  "passDateChange",
  "dateEdit",
  "dateAdd",
];
export function identity(params: ServiceParams): RequestIdentity {
  if (!params.identity || !params.identity.session.complete)
    throw new Forbidden("Authentication required");
  return params.identity;
}
export function integer(value: unknown, min = 1, max = 2147483647): number {
  const n =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max)
    throw new BadRequest("Invalid integer");
  return n;
}
export class Accounts {
  constructor(
    readonly db: Database,
    readonly vault: Vault,
  ) {}
  async fullGroup(): Promise<boolean> {
    return (await getSetting(this.db, "fullGroupAccess", false)) === true;
  }
  private async restrict(
    query: ReturnType<Database>,
    params: ServiceParams,
    alias: "a" | "h",
  ): Promise<void> {
    const { user } = identity(params),
      ownGroups = [user.userGroupId, ...user.groups],
      accountColumn = alias === "a" ? "a.id" : "h.accountId";
    query.where((b) =>
      b
        .where(`${alias}.isPrivate`, 0)
        .orWhereNull(`${alias}.isPrivate`)
        .orWhere(`${alias}.userId`, user.id),
    );
    query.where((b) =>
      b
        .where(`${alias}.isPrivateGroup`, 0)
        .orWhereNull(`${alias}.isPrivateGroup`)
        .orWhere(`${alias}.userGroupId`, user.userGroupId),
    );
    if (!isAdmin(user)) {
      const shareGroups = (await this.fullGroup())
        ? ownGroups
        : [user.userGroupId];
      query.where((b) =>
        b
          .where(`${alias}.userId`, user.id)
          .orWhereIn(`${alias}.userGroupId`, ownGroups)
          .orWhereExists(
            this.db("AccountToUser as au")
              .select(this.db.raw("1"))
              .whereRaw("?? = ??", ["au.accountId", accountColumn])
              .where("au.userId", user.id),
          )
          .orWhereExists(
            this.db("AccountToUserGroup as ag")
              .select(this.db.raw("1"))
              .whereRaw("?? = ??", ["ag.accountId", accountColumn])
              .whereIn("ag.userGroupId", shareGroups),
          ),
      );
    }
  }
  private async defaults(
    data: AccountInput,
    params: ServiceParams,
    creating: boolean,
  ): Promise<{ users: Row[]; groups: Row[]; fixed: boolean }> {
    const { user } = identity(params);
    const presets = await matchingPresets(this.db, user);
    const seen = new Set<string>(),
      grants: { users: Row[]; groups: Row[]; fixed: boolean } = {
        users: [],
        groups: [],
        fixed: false,
      };
    for (const preset of presets) {
      if (seen.has(preset.type)) continue;
      seen.add(preset.type);
      const value = preset.data,
        fixed = !!preset.fixed;
      if (preset.type === "account.private" && (creating || fixed)) {
        for (const [k, source] of [
          ["isPrivate", "privateUser"],
          ["isPrivateGroup", "privateGroup"],
        ] as const) {
          const flag = !!value[source];
          if (fixed && data[k] !== undefined && data[k] !== flag)
            throw new Forbidden("A fixed privacy preset applies");
          if (data[k] === undefined) data[k] = flag;
        }
      }
      if (
        preset.type === "account.password" &&
        data.password !== undefined &&
        fixed
      ) {
        const password = data.password;
        if (
          Array.from(password).length < Number(value.length ?? 0) ||
          (value.useLetters && !/[a-zA-Z]/.test(password)) ||
          (value.useLetters && value.useLower && !/[a-z]/.test(password)) ||
          (value.useLetters && value.useUpper && !/[A-Z]/.test(password)) ||
          (value.useNumbers && !/[0-9]/.test(password)) ||
          (value.useSymbols && !/[^a-zA-Z0-9\s]/.test(password)) ||
          (value.regex &&
            !(await checkLegacyPattern(String(value.regex), password)))
        )
          throw new BadRequest("Password does not match the account preset");
        if (Number(value.expireTime) > 0 && (creating || fixed))
          data.passDateChange =
            Math.floor(Date.now() / 1000) +
            Math.min(315360000, Number(value.expireTime));
      }
      if (preset.type === "account.tag" && (creating || fixed)) {
        const tags = Array.isArray(value.tags)
          ? value.tags
          : Object.values((value.tags ?? {}) as Record<string, unknown>);
        data.tags = [...new Set([...(data.tags ?? []), ...tags.map(String)])];
      }
      if (preset.type === "account.permission" && (creating || fixed)) {
        grants.fixed = fixed;
        for (const [kind, view, edit, idKey] of [
          ["users", "usersView", "usersEdit", "userId"],
          ["groups", "userGroupsView", "userGroupsEdit", "userGroupId"],
        ] as const) {
          const v = Object.values((value[view] ?? {}) as object).map((i) =>
              integer(i),
            ),
            e = Object.values((value[edit] ?? {}) as object).map((i) =>
              integer(i),
            );
          grants[kind] = [...new Set([...v, ...e])].map((id) => ({
            [idKey]: id,
            isEdit: Number(e.includes(id)),
          }));
        }
      }
    }
    return grants;
  }
  async access(
    id: Id,
    params: ServiceParams,
    action: AccountAction = "view",
    db = this.db,
  ): Promise<Row> {
    const { user } = identity(params);
    const row = await db("Account")
      .where({ id: integer(id) })
      .first();
    if (!row) throw new NotFound("Account not found");
    row.users = await db("AccountToUser")
      .where({ accountId: row.id })
      .select("userId", "isEdit");
    row.groups = await db("AccountToUserGroup")
      .where({ accountId: row.id })
      .select("userGroupId", "isEdit");
    if (
      !can(
        user,
        action,
        row as Parameters<typeof can>[2],
        await this.fullGroup(),
      )
    )
      throw new NotFound("Account not found");
    return row;
  }
  private async present(row: Row, params: ServiceParams): Promise<Account> {
    const { user } = identity(params),
      full = await this.fullGroup();
    const safe = Object.fromEntries(publicFields.map((key) => [key, row[key]]));
    const version = await this.db("nodepass_versions")
      .where({ entity: "Account", entityId: row.id })
      .first();
    const category = await this.db("Category")
        .where({ id: row.categoryId })
        .first(),
      client = await this.db("Client").where({ id: row.clientId }).first(),
      group = await this.db("UserGroup").where({ id: row.userGroupId }).first();
    const tags = await this.db("AccountToTag as at")
      .join("Tag as t", "t.id", "at.tagId")
      .where("at.accountId", row.id)
      .select("t.name");
    const favorite = await this.db("AccountToFavorite")
      .where({ accountId: row.id, userId: user.id })
      .first();
    return {
      ...safe,
      version: Number(version?.version ?? 0),
      categoryName: category?.name ?? "",
      clientName: client?.name ?? "",
      groupName: group?.name ?? "",
      favorite: !!favorite,
      tags: tags.map((t) => t.name),
      listFields: (await this.fields(row.id, params))
        .filter(
          (field) => field.showInList && !field.isEncrypted && field.value,
        )
        .map((field) => ({
          id: field.id,
          name: field.name,
          value: field.value,
        })),
      permissions: Object.fromEntries(
        flags.map((a) => [
          a,
          can(user, a, row as Parameters<typeof can>[2], full),
        ]),
      ),
    } as unknown as Account;
  }
  async find(params: ServiceParams = {}): Promise<Page<Account>> {
    const { user } = identity(params),
      q = params.query ?? {};
    if (
      Object.keys(q).some(
        (k) =>
          ![
            "search",
            "categoryId",
            "clientId",
            "favorite",
            "privateOnly",
            "tag",
            "limit",
            "skip",
            "sort",
            "direction",
            "tagIds",
            "op",
          ].includes(k),
      )
    )
      throw new BadRequest("Unknown query");
    const limit = q.limit === undefined ? 50 : integer(q.limit, 1, 100),
      skip = q.skip === undefined ? 0 : integer(q.skip, 0, 1000000);
    const base = this.db("Account as a")
      .join("Category as c", "c.id", "a.categoryId")
      .join("Client as cl", "cl.id", "a.clientId")
      .select("a.id");
    if (!hasAccountCapability(user, "view"))
      return { total: 0, limit, skip, data: [] };
    await this.restrict(base, params, "a");
    if (
      q.privateOnly !== undefined &&
      !["true", "false"].includes(q.privateOnly)
    )
      throw new BadRequest("Invalid private account filter");
    if (q.privateOnly === "true")
      base.where({ "a.isPrivate": 1, "a.userId": user.id });
    if (q.op !== undefined && !["and", "or"].includes(q.op))
      throw new BadRequest("Invalid filter operator");
    const filters: ((builder: ReturnType<Database>) => void)[] = [];
    if (q.search !== undefined) {
      if (typeof q.search !== "string" || q.search.length > 200)
        throw new BadRequest("Invalid search");
      const term = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filters.push((b) =>
        b.where((b) =>
          b
            .where("a.name", "like", term)
            .orWhere("a.login", "like", term)
            .orWhere("a.notes", "like", term),
        ),
      );
    }
    if (q.categoryId) {
      const id = integer(q.categoryId);
      filters.push((b) => {
        b.where("a.categoryId", id);
      });
    }
    if (q.clientId) {
      const id = integer(q.clientId);
      filters.push((b) => {
        b.where("a.clientId", id);
      });
    }
    if (q.favorite === "true")
      base.whereExists(
        this.db("AccountToFavorite as f")
          .select(this.db.raw("1"))
          .whereRaw("f.accountId = a.id")
          .where("f.userId", user.id),
      );
    if (q.tag) {
      if (typeof q.tag !== "string" || q.tag.length > 45)
        throw new BadRequest("Invalid tag");
      filters.push((b) =>
        b.whereExists(
          this.db("AccountToTag as at")
            .join("Tag as t", "t.id", "at.tagId")
            .select(this.db.raw("1"))
            .whereRaw("at.accountId=a.id")
            .where("t.name", q.tag),
        ),
      );
    }
    if (q.tagIds !== undefined) {
      if (!Array.isArray(q.tagIds) || q.tagIds.length > 30)
        throw new BadRequest("Invalid tag IDs");
      const ids = q.tagIds.map((v) => integer(v));
      filters.push((b) =>
        b.whereExists(
          this.db("AccountToTag as at")
            .select(this.db.raw("1"))
            .whereRaw("at.accountId=a.id")
            .whereIn("at.tagId", ids),
        ),
      );
    }
    if (filters.length)
      base.where((b) => {
        for (const filter of filters) {
          if (q.op === "or") b.orWhere((group) => filter(group));
          else b.andWhere((group) => filter(group));
        }
      });
    const count = await base.clone().clearSelect().count({ n: "a.id" }).first();
    const sorts: Record<string, string> = {
      name: "a.name",
      updated: "a.dateEdit",
      expiry: "a.passDateChange",
      login: "a.login",
      url: "a.url",
      category: "c.name",
      client: "cl.name",
    };
    if (q.sort && !Object.hasOwn(sorts, String(q.sort)))
      throw new BadRequest("Invalid sort");
    if (q.direction !== undefined && !["asc", "desc"].includes(q.direction))
      throw new BadRequest("Invalid sort direction");
    const rows = await base
      .orderBy(
        sorts[String(q.sort)] ?? "a.name",
        q.direction ?? (q.sort === "updated" ? "desc" : "asc"),
      )
      .orderBy("a.id")
      .limit(limit)
      .offset(skip);
    const data: Account[] = [];
    for (const row of rows) data.push(await this.get(row.id, params));
    return { total: Number(count?.n ?? 0), limit, skip, data };
  }
  async get(id: Id, params: ServiceParams = {}): Promise<Account> {
    return this.present(await this.access(id, params), params);
  }
  private async input(data: unknown): Promise<AccountInput> {
    try {
      const value = (await validate(data)) as AccountInput;
      if (
        value.password !== undefined &&
        Buffer.byteLength(value.password) > 1900
      )
        throw new Error("Password too long");
      return value;
    } catch {
      throw new BadRequest("Invalid account fields");
    }
  }
  private async references(
    data: AccountInput,
    user: RequestIdentity["user"],
    db: Database,
  ): Promise<void> {
    for (const [table, id] of [
      ["Category", data.categoryId],
      ["Client", data.clientId],
      ["UserGroup", data.userGroupId],
    ] as const)
      if (!(await db(table).where({ id }).first()))
        throw new BadRequest(`Unknown ${table}`);
    if (
      !user.isAdminApp &&
      !user.isAdminAcc &&
      data.userGroupId !== user.userGroupId &&
      !user.groups.includes(data.userGroupId)
    )
      throw new Forbidden("You cannot assign this group");
    if (
      data.isPrivate &&
      !user.isAdminApp &&
      !user.isAdminAcc &&
      !user.profile.accPrivate
    )
      throw new Forbidden("Private accounts are not permitted");
    if (
      data.isPrivateGroup &&
      !user.isAdminApp &&
      !user.isAdminAcc &&
      !user.profile.accPrivateGroup
    )
      throw new Forbidden("Private group accounts are not permitted");
    if (data.isPrivateGroup && data.userGroupId !== user.userGroupId)
      throw new BadRequest("Group-private accounts require your primary group");
  }
  private columns(data: AccountInput): Row {
    const { password: _, version: __, tags: ___, ...columns } = data;
    return Object.fromEntries(
      Object.entries(columns).map(([k, v]) => [
        k,
        typeof v === "boolean" ? Number(v) : v,
      ]),
    );
  }
  private async tags(
    db: Database,
    id: number,
    names?: string[],
  ): Promise<void> {
    if (!names) return;
    await db("AccountToTag").where({ accountId: id }).delete();
    for (const name of new Set(names)) {
      const hash = createHash("sha1").update(name).digest("hex");
      await db("Tag").insert({ name, hash }).onConflict("hash").ignore();
      const tag = await db("Tag").where({ hash }).first();
      await db("AccountToTag").insert({ accountId: id, tagId: tag.id });
    }
  }
  async create(
    raw: unknown,
    params: ServiceParams = {},
    ownerId?: number,
  ): Promise<Account> {
    const { user } = identity(params);
    if (!can(user, "create")) throw new Forbidden("Account creation denied");
    if (ownerId !== undefined && ownerId !== user.id && !user.isAdminApp)
      throw new Forbidden("Owner assignment requires an administrator");
    if (
      ownerId !== undefined &&
      !(await this.db("User")
        .where({ id: integer(ownerId), isDisabled: 0 })
        .first())
    )
      throw new BadRequest("Unknown owner");
    const data = await this.input(raw);
    if (data.password === undefined) throw new BadRequest("Password required");
    const grants = await this.defaults(data, params, true);
    if (ownerId !== undefined && ownerId !== user.id && data.isPrivate)
      throw new BadRequest("Cannot create a private account for another owner");
    await this.input(data);
    const id = await this.db.transaction(async (trx) => {
      await this.references(data, user, trx);
      if (data.parentId) await this.access(data.parentId, params, "view", trx);
      const [id] = await trx("Account").insert({
        ...this.columns(data),
        userId: ownerId ?? user.id,
        userEditId: user.id,
        pass: Buffer.alloc(0),
        key: Buffer.alloc(0),
        dateAdd: new Date(),
        dateEdit: new Date(),
        passDate: Math.floor(Date.now() / 1000),
      });
      await trx("Account")
        .where({ id })
        .update(this.vault.encrypt(data.password!, `Account/${id}/pass`));
      await trx("nodepass_versions").insert({
        entity: "Account",
        entityId: id,
        version: 1,
      });
      await this.tags(trx, id!, data.tags);
      if (grants.users.length)
        await trx("AccountToUser").insert(
          grants.users.map((g) => ({ ...g, accountId: id })),
        );
      if (grants.groups.length)
        await trx("AccountToUserGroup").insert(
          grants.groups.map((g) => ({ ...g, accountId: id })),
        );
      await audit(trx, user.id, "account.create", id);
      return id!;
    });
    return this.get(id, params);
  }
  private async snapshot(
    trx: Database,
    row: Row,
    userId: number,
    deleted = false,
  ): Promise<void> {
    const copy = Object.fromEntries(
      publicFields.filter((k) => k !== "id").map((k) => [k, row[k]]),
    );
    const [id] = await trx("AccountHistory").insert({
      ...copy,
      accountId: row.id,
      pass: Buffer.alloc(0),
      key: Buffer.alloc(0),
      notes: row.notes ?? "",
      userEditId: userId,
      isModify: deleted ? 0 : 1,
      isDeleted: deleted ? 1 : 0,
      mPassHash: "nodePass-v1",
    });
    const clear = await this.vault.decrypt(
      row.pass,
      row.key,
      `Account/${row.id}/pass`,
    );
    await trx("AccountHistory")
      .where({ id })
      .update(this.vault.encrypt(clear, `AccountHistory/${id}/pass`));
  }
  async patch(
    id: Id,
    raw: unknown,
    params: ServiceParams = {},
    ownerId?: number,
  ): Promise<Account> {
    const { user } = identity(params),
      data = await this.input(raw);
    if (data.version === undefined) throw new BadRequest("Version required");
    if (
      ownerId !== undefined &&
      (!user.isAdminApp ||
        !(await this.db("User")
          .where({ id: integer(ownerId), isDisabled: 0 })
          .first()))
    )
      throw new Forbidden(
        "Owner assignment requires an administrator and an active user",
      );
    await this.defaults(data, params, false);
    await this.input(data);
    await this.db.transaction(async (trx) => {
      await trx("Account")
        .where({ id: integer(id) })
        .forUpdate()
        .first();
      const row = await this.access(id, params, "edit", trx);
      const version = await trx("nodepass_versions")
        .where({ entity: "Account", entityId: row.id })
        .forUpdate()
        .first();
      if (Number(version?.version ?? 0) !== data.version)
        throw new Conflict("Account changed; reload before saving");
      if (data.password !== undefined)
        await this.access(id, params, "editSecret", trx);
      await this.references(
        {
          ...data,
          isPrivateGroup: data.isPrivateGroup ?? row.isPrivateGroup === 1,
        },
        user,
        trx,
      );
      if (data.parentId) {
        if (data.parentId === row.id)
          throw new BadRequest("Account cannot link itself");
        await this.access(data.parentId, params, "view", trx);
      }
      if (
        data.userGroupId !== row.userGroupId ||
        Number(data.isPrivate ?? !!row.isPrivate) !== row.isPrivate ||
        Number(data.isPrivateGroup ?? !!row.isPrivateGroup) !==
          row.isPrivateGroup
      )
        await this.access(id, params, "permissions", trx);
      await this.snapshot(trx, row, user.id);
      const changes = {
        ...this.columns(data),
        userEditId: user.id,
        ...(ownerId !== undefined ? { userId: ownerId } : {}),
        dateEdit: new Date(),
        ...(data.password !== undefined
          ? {
              ...this.vault.encrypt(data.password, `Account/${row.id}/pass`),
              passDate: Math.floor(Date.now() / 1000),
            }
          : {}),
      };
      await trx("Account").where({ id: row.id }).update(changes);
      await trx("nodepass_versions")
        .insert({
          entity: "Account",
          entityId: row.id,
          version: data.version + 1,
        })
        .onConflict(["entity", "entityId"])
        .merge();
      await this.tags(trx, row.id, data.tags);
      await audit(trx, user.id, "account.edit", row.id);
    });
    return this.get(id, params);
  }
  async remove(id: Id, params: ServiceParams = {}): Promise<{ id: number }> {
    const { user } = identity(params);
    await this.db.transaction(async (trx) => {
      await trx("Account")
        .where({ id: integer(id) })
        .forUpdate()
        .first();
      const row = await this.access(id, params, "delete", trx);
      await this.snapshot(trx, row, user.id, true);
      const attachments = await trx("AccountFile")
        .where({ accountId: row.id })
        .select("id");
      if (attachments.length)
        await trx("nodepass_attachments")
          .whereIn(
            "id",
            attachments.map((a) => a.id),
          )
          .delete();
      await trx("PublicLink").where({ itemId: row.id }).delete();
      await trx("CustomFieldData")
        .whereIn("moduleId", [1, 10])
        .where({ itemId: row.id })
        .delete();
      await trx("Account").where({ id: row.id }).delete();
      await audit(trx, user.id, "account.delete", row.id);
    });
    return { id: integer(id) };
  }
  async secret(id: Id, params: ServiceParams): Promise<{ password: string }> {
    const row = await this.access(id, params, "secret");
    const password = await this.vault.decrypt(
      row.pass,
      row.key,
      `Account/${row.id}/pass`,
    );
    await this.db.transaction(async (trx) => {
      await trx("Account").where({ id: row.id }).increment("countDecrypt", 1);
      await audit(trx, identity(params).user.id, "account.secret", row.id);
    });
    return { password };
  }
  async history(id: Id, params: ServiceParams): Promise<Row[]> {
    await this.access(id, params, "history");
    const query = this.db("AccountHistory as h").where(
      "h.accountId",
      integer(id),
    );
    await this.restrict(query, params, "h");
    return query
      .select(
        "id",
        "name",
        "login",
        "notes",
        "dateEdit",
        "userEditId",
        "isModify",
        "isDeleted",
      )
      .orderBy("id", "desc")
      .limit(100);
  }
  async historySecret(
    id: Id,
    historyId: number,
    params: ServiceParams,
  ): Promise<{ password: string }> {
    await this.access(id, params, "history");
    await this.access(id, params, "secret");
    const query = this.db("AccountHistory as h").where({
      "h.id": historyId,
      "h.accountId": integer(id),
    });
    await this.restrict(query, params, "h");
    const row = await query.first();
    if (!row) throw new NotFound("History not found");
    await audit(this.db, identity(params).user.id, "history.secret", historyId);
    return {
      password: await this.vault.decrypt(
        row.pass,
        row.key,
        `AccountHistory/${row.id}/pass`,
      ),
    };
  }
  async changeSecret(
    id: Id,
    password: string,
    version: number,
    params: ServiceParams,
    expiry?: number,
  ): Promise<Account> {
    if (typeof password !== "string" || Buffer.byteLength(password) > 1900)
      throw new BadRequest("Invalid password");
    const { user } = identity(params);
    const record = await this.get(id, params),
      data: AccountInput = {
        name: record.name,
        categoryId: record.categoryId,
        clientId: record.clientId,
        userGroupId: record.userGroupId,
        password,
        ...(expiry !== undefined
          ? { passDateChange: integer(expiry, 0, 2147483647) }
          : {}),
      };
    await this.defaults(data, params, false);
    await this.db.transaction(async (trx) => {
      await trx("Account")
        .where({ id: integer(id) })
        .forUpdate()
        .first();
      const row = await this.access(id, params, "editSecret", trx),
        current = await trx("nodepass_versions")
          .where({ entity: "Account", entityId: row.id })
          .forUpdate()
          .first();
      if (Number(current?.version ?? 0) !== version)
        throw new Conflict("Account changed");
      await this.snapshot(trx, row, user.id);
      await trx("Account")
        .where({ id: row.id })
        .update({
          ...this.vault.encrypt(password, `Account/${row.id}/pass`),
          ...(data.passDateChange !== undefined
            ? { passDateChange: data.passDateChange }
            : {}),
          passDate: Math.floor(Date.now() / 1000),
          dateEdit: new Date(),
          userEditId: user.id,
        });
      await trx("nodepass_versions")
        .insert({ entity: "Account", entityId: row.id, version: version + 1 })
        .onConflict(["entity", "entityId"])
        .merge();
      await audit(trx, user.id, "account.password.change", row.id);
    });
    return this.get(id, params);
  }
  async restore(
    id: Id,
    historyId: number,
    version: number,
    params: ServiceParams,
  ): Promise<Account> {
    await this.access(id, params, "edit");
    const { password } = await this.historySecret(id, historyId, params);
    const row = await this.db("AccountHistory")
      .where({ id: historyId, accountId: integer(id) })
      .first();
    const data: Row = { version, password };
    for (const k of [
      "name",
      "login",
      "url",
      "notes",
      "categoryId",
      "clientId",
      "userGroupId",
      "parentId",
      "passDateChange",
    ])
      if (row[k] !== null) data[k] = row[k];
    for (const k of [
      "isPrivate",
      "isPrivateGroup",
      "otherUserEdit",
      "otherUserGroupEdit",
    ])
      data[k] = !!row[k];
    return this.patch(id, data, params);
  }
  async grants(id: Id, params: ServiceParams): Promise<Row> {
    const row = await this.access(id, params, "permissions");
    return { users: row.users, groups: row.groups };
  }
  async setGrants(id: Id, data: Row, params: ServiceParams): Promise<void> {
    if (
      Object.keys(data).some((k) => !["users", "groups"].includes(k)) ||
      !Array.isArray(data.users) ||
      !Array.isArray(data.groups) ||
      data.users.length + data.groups.length > 200
    )
      throw new BadRequest("Invalid permissions");
    const users = data.users.map((r: Row) => {
        if (
          Object.keys(r).some((k) => !["userId", "isEdit"].includes(k)) ||
          typeof r.isEdit !== "boolean"
        )
          throw new BadRequest("Invalid user grant");
        return { userId: integer(r.userId), isEdit: Number(r.isEdit) };
      }),
      groups = data.groups.map((r: Row) => {
        if (
          Object.keys(r).some((k) => !["userGroupId", "isEdit"].includes(k)) ||
          typeof r.isEdit !== "boolean"
        )
          throw new BadRequest("Invalid group grant");
        return {
          userGroupId: integer(r.userGroupId),
          isEdit: Number(r.isEdit),
        };
      });
    await this.db.transaction(async (trx) => {
      await trx("Account")
        .where({ id: integer(id) })
        .forUpdate()
        .first();
      await this.access(id, params, "permissions", trx);
      const record = await this.get(id, params),
        required = await this.defaults(
          {
            name: record.name,
            categoryId: record.categoryId,
            clientId: record.clientId,
            userGroupId: record.userGroupId,
          },
          params,
          false,
        );
      if (required.fixed) {
        const normalized = (rows: Row[], key: string) =>
          JSON.stringify(
            rows
              .map((r) => [r[key], r.isEdit])
              .sort((a, b) => Number(a[0]) - Number(b[0])),
          );
        if (
          normalized(users, "userId") !==
            normalized(required.users, "userId") ||
          normalized(groups, "userGroupId") !==
            normalized(required.groups, "userGroupId")
        )
          throw new Forbidden("A fixed permission preset applies");
      }
      for (const row of users)
        if (
          !(await trx("User").where({ id: row.userId, isDisabled: 0 }).first())
        )
          throw new BadRequest("Unknown user");
      for (const row of groups)
        if (!(await trx("UserGroup").where({ id: row.userGroupId }).first()))
          throw new BadRequest("Unknown group");
      await trx("AccountToUser")
        .where({ accountId: integer(id) })
        .delete();
      await trx("AccountToUserGroup")
        .where({ accountId: integer(id) })
        .delete();
      if (users.length)
        await trx("AccountToUser").insert(
          users.map((r: Row) => ({ ...r, accountId: integer(id) })),
        );
      if (groups.length)
        await trx("AccountToUserGroup").insert(
          groups.map((r: Row) => ({ ...r, accountId: integer(id) })),
        );
      await audit(
        trx,
        identity(params).user.id,
        "account.permissions",
        integer(id),
      );
    });
  }
  private fieldStorage() {
    return new Fields(
      this.db,
      this.vault,
      async (_module, id, params, action) => {
        await this.access(id, params, action);
      },
    );
  }
  async fields(id: Id, params: ServiceParams): Promise<Row[]> {
    return this.fieldStorage().list(1, integer(id), params);
  }
  async fieldSecret(
    id: Id,
    definitionId: number,
    params: ServiceParams,
  ): Promise<{ value: string }> {
    return this.fieldStorage().reveal(1, integer(id), definitionId, params);
  }
  async setField(
    id: Id,
    definitionId: number,
    value: string,
    params: ServiceParams,
  ): Promise<void> {
    await this.fieldStorage().set(1, integer(id), definitionId, value, params);
  }
  async favorite(
    id: Id,
    enabled: boolean,
    params: ServiceParams,
  ): Promise<void> {
    await this.access(id, params);
    const where = { accountId: integer(id), userId: identity(params).user.id };
    if (enabled)
      await this.db("AccountToFavorite")
        .insert(where)
        .onConflict(["accountId", "userId"])
        .ignore();
    else await this.db("AccountToFavorite").where(where).delete();
  }
}
