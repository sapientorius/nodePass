import { BadRequest, NotFound, Conflict } from "@feathersjs/errors";
import { audit, type Database, type Row } from "../db.js";
import type { Vault } from "../security/vault.js";
import { fieldModule } from "../compat/field-modules.js";
import { identity, type ServiceParams } from "./accounts.js";
import { lockUserManagement } from "./user-management.js";
const hasKey = (row: Row | undefined): boolean =>
  !!row?.key && Buffer.from(row.key).length > 0;
function hasValue(row: Row | undefined): boolean {
  const data = Buffer.from(row?.data ?? "");
  if (!data.length) return false;
  if (!hasKey(row)) return true;
  // Presence metadata needs no decryption: both storage formats preserve length.
  // An empty NP1 value has only its 4-byte header, 12-byte nonce and 16-byte tag.
  if (data.subarray(0, 4).toString() === "NP1\0") return data.length !== 32;
  // Legacy Defuse v2 has 84 bytes of overhead and is stored as hexadecimal text.
  return !/^def50200[0-9a-f]{160}$/i.test(data.toString());
}
type FieldAction = "view" | "edit" | "secret" | "editSecret";
export class Fields {
  constructor(
    readonly db: Database,
    readonly vault: Vault,
    readonly authorize: (
      module: number,
      item: number,
      params: ServiceParams,
      action: FieldAction,
      db?: Database,
    ) => Promise<void>,
  ) {}
  async list(
    moduleId: number,
    itemId: number,
    params: ServiceParams,
  ): Promise<Row[]> {
    const module = fieldModule(moduleId);
    await this.authorize(module.id, itemId, params, "view");
    const definitions = await this.db("CustomFieldDefinition as d")
        .join("CustomFieldType as t", "t.id", "d.typeId")
        .whereIn("d.moduleId", module.aliases)
        .select("d.*", "t.name as typeName"),
      data = await this.db("CustomFieldData")
        .whereIn("moduleId", module.aliases)
        .where({ itemId });
    return definitions.map((def) => {
      const row = data.find((row) => row.definitionId === def.id),
        encrypted =
          !!def.isEncrypted || def.typeName === "password" || hasKey(row);
      return {
        id: def.id,
        name: def.name,
        help: def.help,
        required: !!def.required,
        showInList: !!def.showInList,
        isEncrypted: encrypted,
        hasValue: hasValue(row),
        typeId: def.typeId,
        typeName: def.typeName,
        value: !encrypted && row ? Buffer.from(row.data ?? "").toString() : "",
      };
    });
  }
  async reveal(
    moduleId: number,
    itemId: number,
    definitionId: number,
    params: ServiceParams,
  ): Promise<{ value: string }> {
    const module = fieldModule(moduleId);
    await this.authorize(module.id, itemId, params, "secret");
    const row = await this.db("CustomFieldData")
      .whereIn("moduleId", module.aliases)
      .where({ itemId, definitionId })
      .first();
    if (!row) throw new NotFound("Field not found");
    await audit(this.db, identity(params).user.id, "field.secret", row.id);
    return {
      value: hasKey(row)
        ? await this.vault.decrypt(
            row.data,
            row.key,
            `CustomFieldData/${row.id}/data`,
          )
        : Buffer.from(row.data ?? "").toString(),
    };
  }
  async set(
    moduleId: number,
    itemId: number,
    definitionId: number,
    value: string,
    params: ServiceParams,
  ): Promise<void> {
    const module = fieldModule(moduleId);
    await this.authorize(module.id, itemId, params, "edit");
    if (typeof value !== "string" || Buffer.byteLength(value) > 100000)
      throw new BadRequest("Invalid field value");
    const definition = await this.db("CustomFieldDefinition as d")
      .join("CustomFieldType as t", "t.id", "d.typeId")
      .whereIn("d.moduleId", module.aliases)
      .where("d.id", definitionId)
      .select("d.*", "t.name as typeName")
      .first();
    if (!definition) throw new NotFound("Field not found");
    const encrypt =
      !!definition.isEncrypted || definition.typeName === "password";
    if (encrypt) await this.authorize(module.id, itemId, params, "editSecret");
    if (definition.required && !value)
      throw new BadRequest("Field is required");
    if (value) {
      const type = definition.typeName;
      if (
        (type === "date" &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value)) ||
        (type === "number" &&
          !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) ||
        (type === "email" && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) ||
        (type === "color" && !/^#[0-9a-f]{6}$/i.test(value))
      )
        throw new BadRequest("Invalid typed field value");
      if (type === "url") {
        try {
          if (
            !["http:", "https:", "ftp:", "ssh:", "rdp:"].includes(
              new URL(value).protocol,
            )
          )
            throw new Error("scheme");
        } catch {
          throw new BadRequest("Invalid field URL");
        }
      }
    }
    await this.db.transaction(async (trx) => {
      if (["users", "profiles"].includes(module.catalogue)) {
        await lockUserManagement(trx);
        await this.authorize(module.id, itemId, params, "edit", trx);
        if (encrypt)
          await this.authorize(module.id, itemId, params, "editSecret", trx);
      }
      const current = await trx("CustomFieldDefinition")
        .where({ id: definitionId })
        .forUpdate()
        .first();
      if (
        !current ||
        ["moduleId", "typeId", "isEncrypted"].some(
          (key) => current[key] !== definition[key],
        )
      )
        throw new Conflict("Field definition changed; retry");
      await trx(module.table).where({ id: itemId }).forUpdate().first();
      let row = await trx("CustomFieldData")
        .whereIn("moduleId", module.aliases)
        .where({ itemId, definitionId })
        .first();
      if (hasKey(row) && !encrypt)
        await this.authorize(module.id, itemId, params, "editSecret", trx);
      if (!row) {
        const [id] = await trx("CustomFieldData").insert({
          moduleId: definition.moduleId,
          itemId,
          definitionId,
          data: Buffer.alloc(0),
          key: null,
        });
        row = { id };
      }
      const encrypted = encrypt
        ? this.vault.encrypt(value, `CustomFieldData/${row.id}/data`)
        : undefined;
      await trx("CustomFieldData")
        .where({ id: row.id })
        .update({
          data: encrypted?.pass ?? Buffer.from(value),
          key: encrypted?.key ?? null,
        });
      await audit(trx, identity(params).user.id, "field.edit", row.id);
    });
  }
}
