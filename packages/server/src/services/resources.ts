import { BadRequest, NotFound } from "@feathersjs/errors";
import { fileTypeFromBuffer } from "file-type";
import { audit, type Database, type Row } from "../db.js";
import { token } from "../security/crypto.js";
import {
  integer,
  identity,
  type Accounts,
  type ServiceParams,
} from "./accounts.js";
import type { Vault } from "../security/vault.js";
import { exact } from "../security/auth.js";
export class Resources {
  constructor(
    readonly db: Database,
    readonly accounts: Accounts,
    readonly vault: Vault,
  ) {}
  async files(accountId: number, params: ServiceParams): Promise<Row[]> {
    await this.accounts.access(accountId, params, "files");
    return this.db("AccountFile")
      .where({ accountId })
      .select("id", "name", "type", "size", "extension");
  }
  async upload(
    accountId: number,
    data: Row,
    params: ServiceParams,
  ): Promise<Row> {
    exact(data, ["name", "content"]);
    await this.accounts.access(accountId, params, "edit");
    await this.accounts.access(accountId, params, "files");
    if (
      typeof data.name !== "string" ||
      !data.name ||
      data.name.length > 100 ||
      /[\\/]/.test(data.name) ||
      Array.from(data.name as string).some((c) => c.charCodeAt(0) < 32) ||
      typeof data.content !== "string" ||
      data.content.length > 14_000_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data.content,
      )
    )
      throw new BadRequest("Invalid file");
    const content = Buffer.from(data.content, "base64");
    if (content.length === 0 || content.length > 10 * 1024 ** 2)
      throw new BadRequest("File exceeds 10 MiB");
    const type = await fileTypeFromBuffer(content);
    const extension = data.name.split(".").at(-1)?.toLowerCase() ?? "";
    const safe = new Set([
      "pdf",
      "jpg",
      "jpeg",
      "png",
      "gif",
      "txt",
      "csv",
      "odt",
      "ods",
      "docx",
      "xlsx",
      "zip",
      "bak",
    ]);
    if (!safe.has(extension))
      throw new BadRequest("File extension not allowed");
    if (
      type &&
      [
        "image/svg+xml",
        "text/html",
        "application/x-msdownload",
        "application/x-executable",
      ].includes(type.mime)
    )
      throw new BadRequest("Active file type not allowed");
    const expected: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      zip: "application/zip",
    };
    if (expected[extension] && type?.mime !== expected[extension])
      throw new BadRequest("File type does not match extension");
    const id = await this.db.transaction(async (trx) => {
      const [id] = await trx("AccountFile").insert({
        accountId,
        name: data.name,
        type: type?.mime ?? "application/octet-stream",
        size: content.length,
        extension,
        content: Buffer.alloc(0),
        thumb: null,
      });
      await trx("nodepass_attachments").insert({
        id,
        content: this.vault.wrap(content, `attachment/${id}`),
      });
      await audit(trx, identity(params).user.id, "file.upload", id);
      return id!;
    });
    return { id };
  }
  async download(
    id: number,
    params: ServiceParams,
  ): Promise<{ name: string; content: Buffer }> {
    const file = await this.db("AccountFile").where({ id }).first();
    if (!file) throw new NotFound("File not found");
    await this.accounts.access(file.accountId, params, "files");
    const encrypted = await this.db("nodepass_attachments")
      .where({ id })
      .first();
    if (!encrypted) throw new BadRequest("Unmigrated attachment");
    await audit(this.db, identity(params).user.id, "file.download", id);
    return {
      name: file.name,
      content: this.vault.unwrap(
        Buffer.from(encrypted.content),
        `attachment/${id}`,
      ),
    };
  }
  async deleteFile(id: number, params: ServiceParams): Promise<void> {
    const file = await this.db("AccountFile").where({ id }).first();
    if (!file) throw new NotFound("File not found");
    await this.accounts.access(file.accountId, params, "edit");
    await this.accounts.access(file.accountId, params, "files");
    await this.db.transaction(async (trx) => {
      await trx("nodepass_attachments").where({ id }).delete();
      await trx("AccountFile").where({ id }).delete();
      await audit(trx, identity(params).user.id, "file.delete", id);
    });
  }
  async share(
    accountId: number,
    data: Row,
    params: ServiceParams,
  ): Promise<Row> {
    exact(data, ["seconds", "views"]);
    await this.accounts.access(accountId, params, "share");
    const account = await this.accounts.get(accountId, params),
      secret = await this.accounts.secret(accountId, params);
    const ttl = integer(data.seconds ?? 3600, 60, 604800),
      maxCountViews = integer(data.views ?? 3, 1, 1000),
      hash = token();
    return this.db.transaction(async (trx) => {
      const existing = await trx("PublicLink")
          .where({ itemId: accountId })
          .forUpdate()
          .first(),
        now = Math.floor(Date.now() / 1000);
      if (
        existing &&
        existing.dateExpire > now &&
        (existing.maxCountViews === 0 ||
          existing.countViews < existing.maxCountViews)
      )
        throw new BadRequest("An active link already exists; revoke it first");
      if (existing) await trx("PublicLink").where({ id: existing.id }).delete();
      const [id] = await trx("PublicLink").insert({
        itemId: accountId,
        hash,
        data: Buffer.alloc(0),
        userId: identity(params).user.id,
        typeId: 1,
        dateAdd: now,
        dateExpire: now + ttl,
        maxCountViews,
        countViews: 0,
        totalCountViews: 0,
      });
      await trx("PublicLink")
        .where({ id })
        .update({
          data: this.vault.wrap(
            JSON.stringify({
              name: account.name,
              login: account.login,
              url: account.url,
              notes: account.notes,
              pass: secret.password,
            }),
            `public-link/${id}`,
          ),
        });
      await audit(trx, identity(params).user.id, "share.create", accountId);
      return { id: id!, hash, expiresAt: now + ttl, maxViews: maxCountViews };
    });
  }
  async links(accountId: number, params: ServiceParams): Promise<Row[]> {
    await this.accounts.access(accountId, params, "share");
    return this.db("PublicLink")
      .where({ itemId: accountId })
      .andWhere("dateExpire", ">", Math.floor(Date.now() / 1000))
      .andWhere((query) =>
        query
          .where("maxCountViews", 0)
          .orWhereRaw("COALESCE(??, 0) < ??", ["countViews", "maxCountViews"]),
      )
      .select("id", "hash", "dateExpire", "countViews", "maxCountViews")
      .then((rows) =>
        rows.map((row) => ({ ...row, hash: Buffer.from(row.hash).toString() })),
      );
  }
  async revokeLink(id: number, params: ServiceParams): Promise<void> {
    const link = await this.db("PublicLink").where({ id }).first();
    if (!link) throw new NotFound("Link not found");
    await this.accounts.access(link.itemId, params, "share");
    await this.db.transaction(async (trx) => {
      await trx("PublicLink").where({ id }).delete();
      await audit(trx, identity(params).user.id, "share.revoke", id);
    });
  }
  async reveal(hash: string): Promise<Row> {
    if (!/^[a-zA-Z0-9_-]{32,100}$/.test(hash))
      throw new NotFound("Link unavailable");
    return this.db.transaction(async (trx) => {
      const row = await trx("PublicLink").where({ hash }).forUpdate().first(),
        now = Math.floor(Date.now() / 1000);
      if (
        !row ||
        row.dateExpire <= now ||
        (row.maxCountViews > 0 && row.countViews >= row.maxCountViews)
      )
        throw new NotFound("Link unavailable");
      const value = JSON.parse(
        this.vault
          .unwrap(Buffer.from(row.data), `public-link/${row.id}`)
          .toString(),
      );
      await trx("PublicLink")
        .where({ id: row.id })
        .increment({ countViews: 1, totalCountViews: 1 });
      await audit(trx, null, "share.reveal", row.id);
      return {
        name: value.name,
        login: value.login,
        url: value.url,
        notes: value.notes,
        password: value.pass,
      };
    });
  }
}
