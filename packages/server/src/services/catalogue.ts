import { fieldModules } from "../compat/field-modules.js";
import { BadRequest, Forbidden, NotFound } from "@feathersjs/errors";
import type { Id } from "@feathersjs/feathers";
import { createHash, randomBytes } from "node:crypto";
import { audit, type Database, type Row } from "../db.js";
import { identity, integer, type ServiceParams } from "./accounts.js";
import { checkStrength, hashPassword } from "../security/password.js";
import { mapData, type Auth } from "../security/auth.js";
const tables: Record<
  string,
  { table: string; permission: string; fields: string[]; maxName: number }
> = {
  categories: {
    table: "Category",
    permission: "mgmCategories",
    fields: ["name", "description"],
    maxName: 50,
  },
  clients: {
    table: "Client",
    permission: "mgmCustomers",
    fields: ["name", "description", "isGlobal"],
    maxName: 100,
  },
  tags: { table: "Tag", permission: "mgmTags", fields: ["name"], maxName: 45 },
  groups: {
    table: "UserGroup",
    permission: "mgmGroups",
    fields: ["name", "description"],
    maxName: 50,
  },
  users: {
    table: "User",
    permission: "mgmUsers",
    fields: [
      "name",
      "login",
      "email",
      "notes",
      "userGroupId",
      "userProfileId",
      "isDisabled",
      "isAdminApp",
      "isAdminAcc",
      "password",
      "groups",
    ],
    maxName: 80,
  },
  profiles: {
    table: "UserProfile",
    permission: "mgmProfiles",
    fields: ["name", "profile"],
    maxName: 45,
  },
  fields: {
    table: "CustomFieldDefinition",
    permission: "mgmCustomFields",
    fields: [
      "name",
      "help",
      "moduleId",
      "required",
      "showInList",
      "typeId",
      "isEncrypted",
    ],
    maxName: 100,
  },
};
const enabled = (value: unknown): boolean => value === true || value === 1;
const permissionFlags = [
  "accView",
  "accViewPass",
  "accViewHistory",
  "accEdit",
  "accEditPass",
  "accAdd",
  "accDelete",
  "accFiles",
  "accPrivate",
  "accPrivateGroup",
  "accPermission",
  "accPublicLinks",
  "accGlobalSearch",
  "configGeneral",
  "configEncryption",
  "configBackup",
  "configImport",
  "mgmUsers",
  "mgmGroups",
  "mgmProfiles",
  "mgmCategories",
  "mgmCustomers",
  "mgmApiTokens",
  "mgmPublicLinks",
  "mgmAccounts",
  "mgmTags",
  "mgmFiles",
  "mgmItemsPreset",
  "evl",
  "mgmCustomFields",
];
export class Catalogue {
  readonly definition;
  constructor(
    readonly db: Database,
    readonly name: string,
    readonly auth: Auth,
  ) {
    const d = Object.hasOwn(tables, name) ? tables[name] : undefined;
    if (!d) throw new Error("Unknown catalogue");
    this.definition = d;
  }
  private manage(params: ServiceParams): void {
    const { user } = identity(params);
    if (!user.isAdminApp && !enabled(user.profile[this.definition.permission]))
      throw new Forbidden("Management permission required");
  }
  private async editableUser(id: number, params: ServiceParams): Promise<void> {
    const { user } = identity(params);
    if (user.isAdminApp) return;
    if (id === user.id)
      throw new Forbidden("Administrator required for privilege changes");
    const target = id
      ? await this.db("User").where({ id: id }).first()
      : undefined;
    if (target && (target.isAdminApp || target.isAdminAcc))
      throw new Forbidden("Administrator required");
    if (target) {
      const memberships = await this.db("UserToUserGroup").where({
        userId: target.id,
      });
      if (
        [target.userGroupId, ...memberships.map((m) => m.userGroupId)].some(
          (group) => group !== user.userGroupId && !user.groups.includes(group),
        )
      )
        throw new Forbidden("Cannot manage a user in another group");
    }
    const targetProfile = target
      ? mapData(
          (
            await this.db("UserProfile")
              .where({ id: target.userProfileId })
              .first()
          ).profile,
        )
      : {};
    if (
      Object.entries(targetProfile).some(
        ([key, value]) => enabled(value) && !enabled(user.profile[key]),
      )
    )
      throw new Forbidden("Cannot manage a user with greater permissions");
  }
  async fieldAccess(
    id: number,
    params: ServiceParams,
    write = false,
  ): Promise<void> {
    this.manage(params);
    await this.get(id, params);
    if (write && this.name === "users") await this.editableUser(id, params);
    if (write && this.name === "profiles" && !identity(params).user.isAdminApp)
      throw new Forbidden("Application administrator required");
  }
  private present(row: Row, params: ServiceParams): Row {
    const { user } = identity(params),
      admin =
        user.isAdminApp || enabled(user.profile[this.definition.permission]);
    if (this.name === "users")
      return Object.fromEntries(
        [
          "id",
          "name",
          "login",
          ...(admin
            ? [
                "email",
                "notes",
                "userGroupId",
                "userProfileId",
                "isDisabled",
                "isAdminApp",
                "isAdminAcc",
                "isLdap",
                "groups",
              ]
            : []),
        ].map((k) => [k, row[k]]),
      );
    if (this.name === "profiles")
      return {
        id: row.id,
        name: row.name,
        ...(admin ? { profile: mapData(row.profile) } : {}),
      };
    return Object.fromEntries(
      ["id", ...this.definition.fields].map((k) => [k, row[k]]),
    );
  }
  async find(params: ServiceParams = {}): Promise<Row[]> {
    identity(params);
    if (this.name === "fields") this.manage(params);
    const q = params.query ?? {};
    if (Object.keys(q).length) throw new BadRequest("Query not supported");
    const rows = await this.db(this.definition.table)
      .select("*")
      .orderBy("name")
      .limit(1000);
    if (this.name === "users" && rows.length) {
      const memberships = await this.db("UserToUserGroup").whereIn(
        "userId",
        rows.map((r) => r.id),
      );
      for (const row of rows)
        row.groups = memberships
          .filter((m) => m.userId === row.id)
          .map((m) => m.userGroupId);
    }
    return rows.map((r) => this.present(r, params));
  }
  async get(id: Id, params: ServiceParams = {}): Promise<Row> {
    identity(params);
    const row = await this.db(this.definition.table)
      .where({ id: integer(id) })
      .first();
    if (!row) throw new NotFound("Item not found");
    if (this.name === "users")
      row.groups = (
        await this.db("UserToUserGroup").where({ userId: row.id })
      ).map((m) => m.userGroupId);
    return this.present(row, params);
  }
  private async input(
    raw: unknown,
    params: ServiceParams,
    existingId?: number,
  ): Promise<Row> {
    this.manage(params);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new BadRequest("Invalid item");
    const data = { ...raw } as Row;
    if (Object.keys(data).some((k) => !this.definition.fields.includes(k)))
      throw new BadRequest("Unknown field");
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > this.definition.maxName
    )
      throw new BadRequest("Invalid name");
    for (const key of ["description", "notes", "help", "email"])
      if (
        data[key] !== undefined &&
        (typeof data[key] !== "string" ||
          data[key].length >
            (key === "notes" ? 10000 : key === "email" ? 80 : 255))
      )
        throw new BadRequest(`Invalid ${key}`);
    const { user } = identity(params);
    if (this.name === "users") {
      if (
        typeof data.login !== "string" ||
        !/^[\p{L}\p{N}_.@-]{1,50}$/u.test(data.login)
      )
        throw new BadRequest("Invalid login");
      if (!user.isAdminApp) {
        if (
          data.isAdminApp !== undefined ||
          data.isAdminAcc !== undefined ||
          existingId === user.id
        )
          throw new Forbidden("Administrator required for privilege changes");
        await this.editableUser(existingId ?? 0, params);
      }
      for (const field of ["userGroupId", "userProfileId"]) {
        data[field] = integer(data[field]);
        if (
          !(await this.db(field === "userGroupId" ? "UserGroup" : "UserProfile")
            .where({ id: data[field] })
            .first())
        )
          throw new BadRequest("Unknown group or profile");
      }
      if (!user.isAdminApp) {
        const profile = mapData(
          (
            await this.db("UserProfile")
              .where({ id: data.userProfileId })
              .first()
          ).profile,
        );
        if (
          Object.entries(profile).some(
            ([key, value]) => enabled(value) && !enabled(user.profile[key]),
          )
        )
          throw new Forbidden("Cannot grant greater profile permissions");
        const groups = [
          data.userGroupId,
          ...(Array.isArray(data.groups) ? data.groups : []),
        ].map((v) => integer(v));
        if (
          groups.some(
            (group) =>
              group !== user.userGroupId && !user.groups.includes(group),
          )
        )
          throw new Forbidden("Cannot grant access to another group");
      }
      if (data.password !== undefined) {
        if (typeof data.password !== "string")
          throw new BadRequest("Invalid password");
        checkStrength(data.password, await this.auth.policy());
        data.pass = await hashPassword(data.password);
        delete data.password;
      } else if (!existingId) throw new BadRequest("Password required");
      if (
        await this.db("User")
          .where({ login: data.login })
          .modify((q) => {
            if (existingId) q.whereNot("id", existingId);
          })
          .first()
      )
        throw new BadRequest("Login already exists");
      if (data.groups !== undefined) {
        if (!Array.isArray(data.groups) || data.groups.length > 100)
          throw new BadRequest("Invalid groups");
        data.groups = data.groups.map((v) => integer(v));
        const found = await this.db("UserGroup").whereIn("id", data.groups);
        if (found.length !== new Set(data.groups).size)
          throw new BadRequest("Unknown group");
      }
      for (const flag of ["isDisabled", "isAdminApp", "isAdminAcc"])
        if (data[flag] !== undefined) {
          if (typeof data[flag] !== "boolean")
            throw new BadRequest("Invalid flag");
          data[flag] = Number(data[flag]);
        }
      if (!existingId) data.hashSalt = randomBytes(32);
    }
    if (this.name === "profiles") {
      if (!user.isAdminApp)
        throw new Forbidden(
          "Application administrator required for profile changes",
        );
      if (
        !data.profile ||
        typeof data.profile !== "object" ||
        Array.isArray(data.profile) ||
        Object.entries(data.profile).some(
          ([k, v]) => !permissionFlags.includes(k) || typeof v !== "boolean",
        )
      )
        throw new BadRequest("Invalid profile");
      data.profile = `NPJ1:${JSON.stringify(data.profile)}`;
    }
    if (["categories", "clients", "tags"].includes(this.name))
      data.hash = createHash("sha1").update(data.name).digest("hex");
    if (this.name === "clients" && data.isGlobal !== undefined) {
      if (typeof data.isGlobal !== "boolean")
        throw new BadRequest("Invalid global flag");
      data.isGlobal = Number(data.isGlobal);
    }
    if (this.name === "fields") {
      for (const key of ["moduleId", "typeId"]) data[key] = integer(data[key]);
      if (
        !(await this.db("CustomFieldType").where({ id: data.typeId }).first())
      )
        throw new BadRequest("Unknown field type");
      if (
        !Object.values(fieldModules).some((module) =>
          module.aliases.includes(data.moduleId),
        )
      )
        throw new BadRequest("Invalid module");
      for (const key of ["required", "showInList", "isEncrypted"])
        if (data[key] !== undefined) {
          if (typeof data[key] !== "boolean")
            throw new BadRequest("Invalid flag");
          data[key] = Number(data[key]);
        }
      if (existingId) {
        const previous = await this.db("CustomFieldDefinition")
          .where({ id: existingId })
          .first();
        if (
          previous &&
          ["moduleId", "typeId", "isEncrypted"].some(
            (key) => data[key] !== undefined && data[key] !== previous[key],
          ) &&
          (await this.db("CustomFieldData")
            .where({ definitionId: existingId })
            .first())
        )
          throw new BadRequest(
            "Cannot change the storage format of a populated field",
          );
      }
    }
    return data;
  }
  async create(raw: unknown, params: ServiceParams = {}): Promise<Row> {
    const data = await this.input(raw, params);
    const { groups, ...row } = data;
    const [id] = await this.db.transaction(async (trx) => {
      const [id] = await trx(this.definition.table).insert(row);
      if (groups)
        for (const group of groups)
          await trx("UserToUserGroup").insert({
            userId: id,
            userGroupId: group,
          });
      await audit(trx, identity(params).user.id, `${this.name}.create`, id);
      return [id];
    });
    return this.get(id!, params);
  }
  async patch(id: Id, raw: unknown, params: ServiceParams = {}): Promise<Row> {
    const target = integer(id),
      data = await this.input(raw, params, target),
      { groups, ...row } = data;
    await this.db.transaction(async (trx) => {
      if (this.name === "fields") {
        const previous = await trx("CustomFieldDefinition")
          .where({ id: target })
          .forUpdate()
          .first();
        if (
          previous &&
          ["moduleId", "typeId", "isEncrypted"].some(
            (key) => data[key] !== undefined && data[key] !== previous[key],
          ) &&
          (await trx("CustomFieldData").where({ definitionId: target }).first())
        )
          throw new BadRequest(
            "Cannot change the storage format of a populated field",
          );
      }
      if (this.name === "users") {
        const admins = await trx("User")
          .where({ isAdminApp: 1, isDisabled: 0 })
          .forUpdate();
        if (
          admins.length === 1 &&
          admins[0].id === target &&
          (data.isDisabled === 1 || data.isAdminApp === 0)
        )
          throw new Forbidden(
            "Cannot disable the last application administrator",
          );
      }
      const count = await trx(this.definition.table)
        .where({ id: target })
        .update(row);
      if (!count) throw new NotFound("Item not found");
      if (groups) {
        await trx("UserToUserGroup").where({ userId: target }).delete();
        for (const group of groups)
          await trx("UserToUserGroup").insert({
            userId: target,
            userGroupId: group,
          });
      }
      if (this.name === "users")
        await trx("nodepass_sessions").where({ userId: target }).delete();
      if (this.name === "profiles") {
        const users = await trx("User").where({ userProfileId: target });
        if (users.length)
          await trx("nodepass_sessions")
            .whereIn(
              "userId",
              users.map((u) => u.id),
            )
            .delete();
      }
      await audit(trx, identity(params).user.id, `${this.name}.edit`, target);
    });
    return this.get(target, params);
  }
  async remove(id: Id, params: ServiceParams = {}): Promise<{ id: number }> {
    this.manage(params);
    const target = integer(id);
    if (["users", "profiles"].includes(this.name))
      throw new BadRequest(
        "Disable users and retain their history; referenced profiles cannot be deleted here",
      );
    await this.db.transaction(async (trx) => {
      const module = Object.values(fieldModules).find(
        (module) => module.catalogue === this.name,
      );
      if (module)
        await trx("CustomFieldData")
          .whereIn("moduleId", module.aliases)
          .where({ itemId: target })
          .delete();
      await trx(this.definition.table).where({ id: target }).delete();
      await audit(trx, identity(params).user.id, `${this.name}.delete`, target);
    });
    return { id: target };
  }
}
