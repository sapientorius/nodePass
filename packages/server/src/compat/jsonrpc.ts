import type { Context } from "koa";
import { BadRequest, Forbidden } from "@feathersjs/errors";
import type { Auth } from "../security/auth.js";
import { body, text } from "../security/auth.js";
import {
  integer,
  type Accounts,
  type ServiceParams,
} from "../services/accounts.js";
import { Catalogue } from "../services/catalogue.js";
import { backup } from "../migration/backup.js";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyPassword } from "../security/password.js";
import { getSetting, type Row } from "../db.js";
import { digest } from "../security/crypto.js";
import { Transfer } from "../services/transfer.js";
export const actions: Record<string, number> = {
  "account/search": 2,
  "account/view": 3,
  "account/create": 4,
  "account/edit": 5,
  "account/delete": 6,
  "account/viewPass": 7,
  "account/editPass": 8,
  "category/search": 102,
  "category/view": 103,
  "category/create": 104,
  "category/edit": 105,
  "category/delete": 106,
  "tag/search": 202,
  "tag/view": 203,
  "tag/create": 204,
  "tag/edit": 205,
  "tag/delete": 206,
  "client/search": 302,
  "client/view": 303,
  "client/create": 304,
  "client/edit": 305,
  "client/delete": 306,
  "userGroup/search": 802,
  "userGroup/view": 803,
  "userGroup/create": 804,
  "userGroup/edit": 805,
  "userGroup/delete": 806,
  "config/backup": 1541,
  "config/export": 1561,
};
async function legacyAccount(
  accounts: Accounts,
  value: Row,
  search = false,
): Promise<Row> {
  const row = await accounts.db("Account").where({ id: value.id }).first(),
    owner = await accounts.db("User").where({ id: row.userId }).first(),
    editor = await accounts.db("User").where({ id: row.userEditId }).first(),
    files = await accounts
      .db("AccountFile")
      .where({ accountId: row.id })
      .count({ n: "*" })
      .first();
  const result: Row = {
    ...value,
    userEditId: row.userEditId,
    userGroupName: value.groupName,
    userName: owner?.name ?? "",
    userLogin: owner?.login ?? "",
    userEditName: editor?.name ?? "",
    userEditLogin: editor?.login ?? "",
    countView: row.countView,
    countDecrypt: row.countDecrypt,
    num_files: Number(files?.n ?? 0),
    publicLinkHash: "",
  };
  delete result.permissions;
  delete result.version;
  delete result.favorite;
  delete result.groupName;
  if (!search) {
    result.pass = "";
    result.key = "";
  }
  return result;
}
export async function jsonRpc(
  ctx: Context,
  auth: Auth,
  accounts: Accounts,
  managedBackups?: import("../services/backups.js").Backups,
): Promise<void> {
  let id: unknown = null;
  try {
    const request = body(ctx);
    id = request.id;
    if (
      !(request.jsonrpc === "2.0" || request.jsonrpc === 2) ||
      !Number.isInteger(id) ||
      !request.params ||
      typeof request.params !== "object" ||
      Array.isArray(request.params)
    )
      throw new BadRequest("Invalid request");
    const method = text(request, "method", 100),
      actionId = Object.hasOwn(actions, method) ? actions[method] : undefined;
    if (!actionId) {
      ctx.body = {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found", data: null },
      };
      return;
    }
    await auth.limit("rpc/ip", ctx.ip, 100);
    const p = request.params as Row;
    const raw = text(p, "authToken", 255);
    const row = await auth
      .db("AuthToken")
      .where({ actionId })
      .whereIn("token", [raw, `np1:${digest(raw)}`])
      .first();
    if (!row) throw new Forbidden("Access denied");
    const metadata = await getSetting<Row>(auth.db, `token/${row.id}`, {});
    if (metadata.expiresAt && Number(metadata.expiresAt) < Date.now())
      throw new Forbidden("Access denied");
    const user = await auth.user(row.userId);
    if (user.isLdap && !(await auth.directory(user)))
      throw new Forbidden("Access denied");
    if (
      [4, 7, 8].includes(actionId) &&
      (!row.hash ||
        !(await verifyPassword(
          text(p, "tokenPass", 4096),
          Buffer.from(row.hash).toString(),
        )))
    )
      throw new Forbidden("Access denied");
    const now = Date.now();
    const params: ServiceParams = {
      identity: {
        user,
        session: {
          id: "api",
          userId: user.id,
          csrf: "",
          complete: 1,
          verifiedAt: now,
          createdAt: now,
          lastSeen: now,
        },
      },
    };
    const [type, operation] = method.split("/");
    let result: unknown,
      itemId = 0,
      message: string | null = null;
    if (type === "account") {
      if (operation === "search") {
        const query: Row = {};
        if (p.text) query.search = p.text;
        if (p.categoryId) query.categoryId = p.categoryId;
        if (p.clientId) query.clientId = p.clientId;
        if (p.tagsId !== undefined) query.tagIds = p.tagsId;
        if (p.op !== undefined) query.op = p.op;
        if (p.order !== undefined) {
          const sort = ["name", "name", "category", "login", "url", "client"][
            integer(p.order, 0, 5)
          ];
          query.sort = sort;
        }
        query.limit = p.count ? integer(p.count, 1, 100) : 50;
        result = await Promise.all(
          (await accounts.find({ ...params, query })).data.map((row) =>
            legacyAccount(accounts, row, true),
          ),
        );
      } else {
        itemId = operation === "create" ? 0 : integer(p.id);
        if (operation === "view") {
          result = await accounts.get(itemId, params);
          await accounts
            .db("Account")
            .where({ id: itemId })
            .increment("countView", 1);
        } else if (operation === "viewPass")
          result = await accounts.secret(itemId, params);
        else if (operation === "delete") {
          result = await legacyAccount(
            accounts,
            await accounts.get(itemId, params),
          );
          await accounts.remove(itemId, params);
          message = "Account removed";
        } else if (operation === "editPass") {
          const current = await accounts.get(itemId, params);
          result = await accounts.changeSecret(
            itemId,
            text(p, "pass", 1900),
            current.version,
            params,
            p.expireDate !== undefined
              ? integer(p.expireDate, 0, 2147483647)
              : undefined,
          );
          message = "Account password updated";
        } else {
          const current =
            operation === "create" ? null : await accounts.get(itemId, params);
          const value: Row = {
            name: p.name ?? current?.name,
            categoryId: p.categoryId ?? current?.categoryId,
            clientId: p.clientId ?? current?.clientId,
            userGroupId:
              p.userGroupId ?? current?.userGroupId ?? user.userGroupId,
          };
          for (const key of ["login", "url", "notes", "parentId"])
            if (p[key] !== undefined) value[key] = p[key];
          if (p.pass !== undefined) value.password = p.pass;
          if (p.tagsId !== undefined) {
            if (!Array.isArray(p.tagsId) || p.tagsId.length > 30)
              throw new BadRequest("Invalid tags");
            const ids = p.tagsId.map((v) => integer(v)),
              tags = await auth
                .db("Tag")
                .whereIn("id", ids)
                .select("id", "name");
            if (tags.length !== new Set(ids).size)
              throw new BadRequest("Unknown tag");
            value.tags = tags.map((t) => t.name);
          }
          if (p.expireDate !== undefined) value.passDateChange = p.expireDate;
          if (p.private !== undefined) value.isPrivate = !!p.private;
          if (p.privateGroup !== undefined)
            value.isPrivateGroup = !!p.privateGroup;
          if (current) value.version = current.version;
          result = current
            ? await accounts.patch(
                itemId,
                value,
                params,
                p.userId !== undefined ? integer(p.userId) : undefined,
              )
            : await accounts.create(
                value,
                params,
                p.userId !== undefined ? integer(p.userId) : undefined,
              );
          itemId = (result as Row).id;
          message = current ? "Account updated" : "Account created";
        }
        if (operation !== "viewPass" && operation !== "delete")
          result = await legacyAccount(accounts, result as Row);
      }
    } else if (type === "config") {
      if (!user.isAdminApp)
        throw new Forbidden("Application administrator required");
      if (operation === "export") {
        const exported = await new Transfer(auth.db, auth, accounts).export(
          "syspass",
          text(p, "password", 4096),
          false,
          params,
        );
        if (p.path !== undefined && p.path !== "backups")
          throw new BadRequest(
            "Only the managed backup directory is supported",
          );
        const directory = resolve(auth.config.dataDir, "backups");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          resolve(directory, `nodepass-export-${Date.now()}.xml`),
          exported.content,
          { flag: "wx", mode: 0o600 },
        );
        result = "backups";
        message = "Export process finished";
      } else {
        if (p.path !== undefined && p.path !== "backups")
          throw new BadRequest(
            "Only the managed backup directory is supported",
          );
        if (managedBackups) {
          const job = await managedBackups.create(user.id);
          await managedBackups.wait();
          const completed = await managedBackups.job(job.id);
          if (completed?.state !== "complete") throw new Error("Backup failed");
          result = completed.name;
        } else
          result = await backup(
            auth.db,
            resolve(auth.config.dataDir, "backups"),
            auth.config.deploymentKey,
            { legacy: auth.config.legacy },
          );
        message = "Backup process finished";
      }
    } else {
      const mapping: Record<string, string> = {
          category: "categories",
          client: "clients",
          tag: "tags",
          userGroup: "groups",
        },
        catalogue = new Catalogue(auth.db, mapping[type!]!, auth);
      if (operation === "search") {
        const rows = await catalogue.find(params);
        result =
          typeof p.text === "string"
            ? rows.filter((r) =>
                String(r.name).toLowerCase().includes(p.text.toLowerCase()),
              )
            : rows;
      } else {
        itemId = operation === "create" ? 0 : integer(p.id);
        if (operation === "view") result = await catalogue.get(itemId, params);
        else if (operation === "delete") {
          result = await catalogue.get(itemId, params);
          await catalogue.remove(itemId, params);
        } else {
          const value: Row = {
            name: p.name,
            ...(p.description !== undefined
              ? { description: p.description }
              : {}),
          };
          result =
            operation === "create"
              ? await catalogue.create(value, params)
              : await catalogue.patch(itemId, value, params);
          itemId = (result as Row).id;
        }
      }
    }
    ctx.body = {
      jsonrpc: "2.0",
      id,
      result: {
        itemId,
        result,
        resultCode: 0,
        resultMessage: message,
        count:
          method === "account/viewPass"
            ? 1
            : Array.isArray(result)
              ? result.length
              : null,
      },
    };
  } catch (error) {
    const code = (error as { code?: number }).code;
    ctx.body = {
      jsonrpc: "2.0",
      id,
      error: {
        code: code === 400 ? -32602 : -32603,
        message: code === 400 ? "Invalid parameters" : "Access denied",
        data: null,
      },
    };
  }
}
