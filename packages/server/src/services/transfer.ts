import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { createHash, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { BadRequest, Forbidden } from "@feathersjs/errors";
import { decryptDefuse, encryptDefuse } from "../compat/defuse.js";
import { equal } from "../security/crypto.js";
import { checkStrength } from "../security/password.js";
import { audit, type Database, type Row } from "../db.js";
import { Accounts, integer, identity, type ServiceParams } from "./accounts.js";
import type { Auth } from "../security/auth.js";
export interface ImportEntry {
  name: string;
  login: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  client: string;
  tags: string[];
}
const array = (v: any): any[] =>
  v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v];
const value = (v: any): string =>
  typeof v === "object" && v !== null
    ? String(v["#text"] ?? "")
    : String(v ?? "");
function xml(source: string): Row {
  if (
    Buffer.byteLength(source) > 10 * 1024 ** 2 ||
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    XMLValidator.validate(source) !== true
  )
    throw new BadRequest("Invalid XML");
  return new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: true,
  }).parse(source) as Row;
}
export async function parseImport(
  format: string,
  source: string,
  password = "",
): Promise<ImportEntry[]> {
  if (Buffer.byteLength(source) > 10 * 1024 ** 2)
    throw new BadRequest("Import exceeds 10 MiB");
  let result: ImportEntry[] = [];
  if (format === "csv") {
    const rows = parse(source, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      max_record_size: 100000,
      relax_column_count: false,
    }) as Row[];
    result = rows.map((r) => {
      if (
        Object.keys(r).some(
          (k) =>
            ![
              "name",
              "login",
              "password",
              "url",
              "notes",
              "category",
              "client",
              "tags",
            ].includes(k),
        )
      )
        throw new BadRequest("Unknown CSV column");
      return {
        name: r.name,
        login: r.login ?? "",
        password: r.password ?? "",
        url: r.url ?? "",
        notes: r.notes ?? "",
        category: r.category ?? "",
        client: r.client ?? "",
        tags: r.tags ? r.tags.split(";") : [],
      };
    });
  } else if (format === "keepass") {
    const document = xml(source);
    if (!document.KeePassFile?.Root?.Group)
      throw new BadRequest("Expected KeePass XML");
    const walk = (groups: Row[], depth: number): void => {
      if (depth > 20) throw new BadRequest("XML nesting exceeds limit");
      for (const group of groups) {
        for (const entry of array(group.Entry)) {
          const data = Object.fromEntries(
            array(entry.String).map((s: Row) => [value(s.Key), value(s.Value)]),
          );
          result.push({
            name: data.Title ?? "",
            login: data.UserName ?? "",
            password: data.Password ?? "",
            url: data.URL ?? "",
            notes: data.Notes ?? "",
            category: value(group.Name),
            client: "",
            tags: value(entry.Tags).split(";").filter(Boolean),
          });
        }
        walk(array(group.Group), depth + 1);
      }
    };
    walk(array(document.KeePassFile.Root.Group), 0);
  } else if (format === "syspass") {
    const document = xml(source),
      root = document.Root;
    if (!root?.Meta || !/^3/.test(value(root.Meta.Version)))
      throw new BadRequest("Expected sysPass 3 XML");
    if (root.Encrypted) {
      if (!password) throw new BadRequest("Export password required");
      if (
        root.Encrypted["@_hash"] &&
        !(await bcrypt.compare(
          password,
          String(root.Encrypted["@_hash"]).replace("$2y$", "$2b$"),
        ))
      )
        throw new BadRequest("Wrong export password");
      const sections: string[] = [];
      for (const chunk of array(root.Encrypted.Data)) {
        const clear = await decryptDefuse(
            Buffer.from(value(chunk), "base64").toString(),
            String(chunk["@_key"]),
            password,
          ),
          section = xml(clear.toString());
        sections.push(clear.toString());
        for (const [key, item] of Object.entries(section)) {
          if (
            !["Accounts", "Categories", "Clients", "Tags"].includes(key) ||
            root[key] !== undefined
          )
            throw new BadRequest("Unexpected encrypted XML section");
          root[key] = item;
        }
      }
      if (root.Meta.Hash) {
        const hash = createHash("sha1").update(sections.join("")).digest("hex");
        if (
          !equal(value(root.Meta.Hash), hash) ||
          !equal(
            String(root.Meta.Hash["@_sign"]),
            createHmac("sha256", password).update(hash).digest("hex"),
          )
        )
          throw new BadRequest("XML integrity check failed");
      }
    }
    const categories = new Map(
        array(root.Categories?.Category).map((r) => [
          String(r["@_id"]),
          value(r.name),
        ]),
      ),
      clients = new Map(
        array(root.Clients?.Client).map((r) => [
          String(r["@_id"]),
          value(r.name),
        ]),
      ),
      tags = new Map(
        array(root.Tags?.Tag).map((r) => [String(r["@_id"]), value(r.name)]),
      );
    for (const row of array(root.Accounts?.Account)) {
      const encoded = value(row.pass),
        key = value(row.key);
      const clear = key
        ? (await decryptDefuse(encoded, key, password)).toString()
        : encoded;
      result.push({
        name: value(row.name),
        login: value(row.login),
        password: clear,
        url: value(row.url),
        notes: value(row.notes),
        category: categories.get(value(row.categoryId)) ?? "",
        client: clients.get(value(row.clientId)) ?? "",
        tags: array(row.tags?.tag)
          .map((t) => tags.get(String(t["@_id"])) ?? "")
          .filter(Boolean),
      });
    }
  } else throw new BadRequest("Unsupported import format");
  if (!result.length || result.length > 1000)
    throw new BadRequest("Import must contain 1 to 1000 accounts");
  for (const row of result) {
    if (
      typeof row.name !== "string" ||
      !row.name ||
      row.name.length > 100 ||
      row.login.length > 50 ||
      row.url.length > 255 ||
      row.notes.length > 30000 ||
      Buffer.byteLength(row.password) > 1900 ||
      row.tags.length > 30 ||
      row.tags.some((t) => !t || t.length > 45) ||
      row.category.length > 50 ||
      row.client.length > 100
    )
      throw new BadRequest(
        "An import entry exceeds the supported field limits",
      );
  }
  return result;
}
export class Transfer {
  constructor(
    readonly db: Database,
    readonly auth: Auth,
    readonly accounts: Accounts,
  ) {}
  async commit(
    entries: ImportEntry[],
    target: { categoryId: number; clientId: number; userGroupId: number },
    params: ServiceParams,
  ): Promise<{ count: number }> {
    const { user } = identity(params);
    if (!user.isAdminApp && !user.profile.configImport)
      throw new Forbidden("Import permission required");
    await this.db.transaction(async (trx) => {
      const accounts = new Accounts(trx, this.accounts.vault);
      for (const entry of entries) {
        await accounts.create(
          {
            name: entry.name,
            login: entry.login,
            password: entry.password,
            url: entry.url,
            notes: entry.notes,
            categoryId: integer(target.categoryId),
            clientId: integer(target.clientId),
            userGroupId: integer(target.userGroupId),
            tags: entry.tags,
          },
          params,
        );
      }
      await audit(trx, user.id, "accounts.import", entries.length);
    });
    return { count: entries.length };
  }
  async export(
    format: string,
    password: string,
    cleartext: boolean,
    params: ServiceParams,
  ): Promise<{ content: string; type: string; filename: string }> {
    const { user } = identity(params);
    if (!user.isAdminApp && !user.profile.configBackup)
      throw new Forbidden("Export permission required");
    if (format === "syspass") checkStrength(password, await this.auth.policy());
    else if (!cleartext)
      throw new BadRequest("Explicit plaintext export confirmation required");
    const rows: Row[] = [];
    let skip = 0;
    while (true) {
      const page = await this.accounts.find({
        ...params,
        query: { limit: 100, skip },
      });
      for (const account of page.data) {
        if (!account.permissions.secret)
          throw new Forbidden(
            "Password access is required for every exported account",
          );
        const secret = await this.accounts.secret(account.id, params);
        rows.push({ ...account, password: secret.password });
      }
      skip += page.data.length;
      if (skip >= page.total) break;
      if (skip >= 10000) throw new BadRequest("Export exceeds 10000 accounts");
    }
    let content: string, type: string, filename: string;
    if (format === "csv") {
      content = stringify(
        rows.map((r) => ({
          name: r.name,
          login: r.login,
          password: r.password,
          url: r.url,
          notes: r.notes,
          category: r.categoryName,
          client: r.clientName,
          tags: r.tags.join(";"),
        })),
        { header: true, escape_formulas: true },
      );
      type = "text/csv";
      filename = "nodepass.csv";
    } else if (format === "keepass") {
      const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
      content = builder.build({
        KeePassFile: {
          Meta: { Generator: "nodePass" },
          Root: {
            Group: {
              Name: "nodePass",
              Entry: rows.map((r) => ({
                String: [
                  ["Title", r.name],
                  ["UserName", r.login],
                  ["Password", r.password],
                  ["URL", r.url],
                  ["Notes", r.notes],
                ].map(([Key, Value]) => ({ Key, Value: Value ?? "" })),
              })),
            },
          },
        },
      });
      type = "application/xml";
      filename = "nodepass-keepass.xml";
    } else if (format === "syspass") {
      const builder = new XMLBuilder({
          ignoreAttributes: false,
          format: false,
        }),
        categories = await this.db("Category")
          .whereIn(
            "id",
            rows.map((r) => r.categoryId),
          )
          .select("id", "name", "description"),
        clients = await this.db("Client")
          .whereIn(
            "id",
            rows.map((r) => r.clientId),
          )
          .select("id", "name", "description"),
        tags = await this.db("Tag")
          .whereIn("name", [...new Set(rows.flatMap((r) => r.tags))])
          .select("id", "name"),
        convert = (r: Row) => ({
          "@_id": r.id,
          ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id")),
        });
      const accounts = [];
      for (const row of rows) {
        const encrypted = await encryptDefuse(row.password, password);
        accounts.push({
          "@_id": row.id,
          name: row.name,
          clientId: row.clientId,
          categoryId: row.categoryId,
          login: row.login ?? "",
          url: row.url ?? "",
          notes: row.notes ?? "",
          pass: encrypted.pass,
          key: encrypted.key,
          tags: {
            tag: tags
              .filter((t) => row.tags.includes(t.name))
              .map((t) => ({ "@_id": t.id })),
          },
        });
      }
      const sections = [
          builder.build({ Categories: { Category: categories.map(convert) } }),
          builder.build({ Clients: { Client: clients.map(convert) } }),
          builder.build({ Tags: { Tag: tags.map(convert) } }),
          builder.build({ Accounts: { Account: accounts } }),
        ],
        chunks = [];
      for (const section of sections) {
        const encrypted = await encryptDefuse(section, password);
        chunks.push({
          "@_key": encrypted.key,
          "#text": Buffer.from(encrypted.pass).toString("base64"),
        });
      }
      const hash = createHash("sha1").update(sections.join("")).digest("hex");
      content = builder.build({
        Root: {
          Meta: {
            Generator: "sysPass",
            Version: "3211.22070201",
            Hash: {
              "@_sign": createHmac("sha256", password)
                .update(hash)
                .digest("hex"),
              "#text": hash,
            },
          },
          Encrypted: {
            "@_hash": await bcrypt.hash(password, 12),
            Data: chunks,
          },
        },
      });
      type = "application/xml";
      filename = "nodepass-syspass.xml";
    } else throw new BadRequest("Unsupported export format");
    await audit(this.db, user.id, "accounts.export", rows.length);
    return { content, type, filename };
  }
}
