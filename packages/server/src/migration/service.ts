import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { BadRequest, Forbidden } from "@feathersjs/errors";
import type { Config } from "../config.js";
import {
  audit,
  createBaseline,
  getSetting,
  migrate,
  putSetting,
  resource,
  withLock,
  validateRelations,
  sidecarTables,
  type Database,
  type Row,
} from "../db.js";
import { backup, readBackup } from "./backup.js";
import { decodeDump } from "./dump.js";
import {
  SetupInputError,
  SetupAccessError,
  setupAdminMessages,
  setupFailure,
} from "./errors.js";
import { parseConfig, type LegacyConfig } from "../compat/config.js";
import { decryptDefuse } from "../compat/defuse.js";
import { phpMap } from "../compat/php.js";
import { equal, seal, open } from "../security/crypto.js";
import {
  checkStrength,
  hashPassword,
  verifyPassword,
} from "../security/password.js";
import { defaultPolicy } from "@nodepass/contracts";
import {
  readAuthenticator,
  type LegacyFactor,
} from "../compat/authenticator.js";
import { digest } from "../security/crypto.js";
import type { Vault } from "../security/vault.js";
import { mapData } from "../security/auth.js";
import { validatePreset } from "../compat/preset-validation.js";
import { fieldModule } from "../compat/field-modules.js";

export class Migration {
  onProgress?: (step: string) => void;
  constructor(
    readonly db: Database,
    readonly vault: Vault,
    readonly config: Config,
  ) {}
  async status(): Promise<{
    installed: boolean;
    legacy: boolean;
    ready: boolean;
  }> {
    const legacy = await this.db.schema.hasTable("User"),
      installed = await this.db.schema.hasTable("nodepass_settings");
    const ready =
      installed && (await getSetting(this.db, "initialized", false));
    return { installed, legacy, ready };
  }
  authorize(value: string): void {
    if (!equal(value, this.config.setupToken))
      throw new Forbidden("Invalid setup token");
  }
  async preflight(
    _configuration: LegacyConfig = this.config.legacy,
  ): Promise<Row> {
    const expected = JSON.parse(
      await readFile(resource("schema.json"), "utf8"),
    ) as Record<string, { name: string; type: string }[]>;
    const [tablesMetadata] = await this.db.raw(
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()",
    );
    for (const table of tablesMetadata as Row[]) {
      if (
        table.kind === "VIEW" &&
        ["account_data_v", "account_search_v"].includes(table.name)
      )
        continue;
      if (
        !Object.hasOwn(expected, table.name) &&
        !sidecarTables.includes(table.name)
      )
        throw new BadRequest("Unknown database table", { table: table.name });
      if (
        table.engine !== "InnoDB" ||
        !/^utf8(?:mb[34])?_/.test(table.collation ?? "")
      )
        throw new BadRequest("Unsupported table engine or character encoding", {
          table: table.name,
        });
    }
    const [rows] = await this.db.raw(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
    );
    const differences: string[] = [];
    for (const [table, columns] of Object.entries(expected))
      for (const column of columns) {
        const actual = (rows as Row[]).find(
          (r) => r.tableName === table && r.columnName === column.name,
        );
        const canonical = (s: string) =>
          s
            .toLowerCase()
            .replace(/\b(tinyint|smallint|mediumint|bigint|int)\(\d+\)/g, "$1");
        if (!actual || canonical(actual.columnType) !== canonical(column.type))
          differences.push(`${table}.${column.name}`);
      }
    if (differences.length)
      throw new BadRequest("Unsupported sysPass schema", {
        columns: differences,
      });
    for (const row of rows as Row[]) {
      if (
        expected[row.tableName] &&
        !expected[row.tableName]!.some((c) => c.name === row.columnName)
      )
        throw new BadRequest(
          `Unknown legacy column ${row.tableName}.${row.columnName}`,
        );
    }
    await validateRelations(this.db);
    const [references] = await this.db.raw(
      "SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS parent,REFERENCED_COLUMN_NAME AS parentColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL",
    );
    const source = await readFile(resource("schema.sql"), "utf8");
    for (const statement of source.split(";")) {
      const table = /CREATE TABLE\s+`(\w+)`/.exec(statement)?.[1];
      if (!table) continue;
      for (const reference of statement.matchAll(
        /FOREIGN KEY\s*\(`(\w+)`\)\s*REFERENCES\s*`(\w+)`\s*\(`(\w+)`\)/g,
      )) {
        if (
          !(references as Row[]).some(
            (row) =>
              row.tableName === table &&
              row.columnName === reference[1] &&
              row.parent === reference[2] &&
              row.parentColumn === reference[3],
          )
        )
          throw new BadRequest("Unsupported schema foreign-key relation", {
            table,
          });
      }
    }
    for (const definition of await this.db("CustomFieldDefinition")) {
      let module;
      try {
        module = fieldModule(definition.moduleId);
      } catch {
        throw new BadRequest("Unsupported custom-field module", {
          id: definition.id,
        });
      }
      const mismatch = await this.db("CustomFieldData")
        .where({ definitionId: definition.id })
        .whereNotIn("moduleId", module.aliases)
        .first();
      if (mismatch)
        throw new BadRequest("Custom-field module mismatch", {
          id: mismatch.id,
        });
      const orphan = await this.db("CustomFieldData as d")
        .leftJoin(module.table + " as target", "target.id", "d.itemId")
        .where("d.definitionId", definition.id)
        .whereNull("target.id")
        .select("d.id")
        .first();
      if (orphan)
        throw new BadRequest("Custom-field target is missing", {
          id: orphan.id,
        });
      const duplicate = await this.db("CustomFieldData")
        .where({ definitionId: definition.id })
        .groupBy("itemId")
        .havingRaw("COUNT(*)>1")
        .min({ id: "id" })
        .first();
      if (duplicate)
        throw new BadRequest("Duplicate custom-field values", {
          id: duplicate.id,
        });
    }
    // Version labels in config.xml can differ from the installed release.
    // Compatibility is determined by the actual schema and data, not these labels.
    const [versions] = await this.db.raw("SELECT VERSION() AS version");
    const version = String(versions[0].version);
    const supported = /MariaDB/i.test(version)
      ? /^(10\.11|11\.4|11\.8)\./.test(version)
      : /^8\.4\./.test(version);
    if (!supported)
      throw new BadRequest(
        "Unsupported database server; use MariaDB 10.11/11.4/11.8 or MySQL 8.4",
      );
    const tables: Record<string, number> = {};
    for (const table of Object.keys(expected)) {
      const row = await this.db(table).count({ n: "*" }).first();
      tables[table] = Number(row?.n ?? 0);
    }
    const plugins = await this.db("Plugin").select(
      "name",
      "versionLevel",
      "enabled",
    );
    for (const preset of await this.db("ItemPreset").select(
      "id",
      "type",
      "data",
    )) {
      try {
        await validatePreset(preset.type, mapData(preset.data));
      } catch {
        throw new BadRequest("Unsupported preset; migration stopped", {
          id: preset.id,
        });
      }
    }
    return {
      version,
      tables,
      plugins,
      warnings: [
        "Migration has only been tested with sysPass 3.2.11. Version metadata is informational; database structure and encrypted data are still verified.",
      ],
      changes: [
        "Additional nodepass_ tables",
        "Encrypted attachment storage",
        "Server-managed vault key",
        "Removal of obsolete per-user master-password copies",
      ],
    };
  }
  async fresh(data: {
    login: string;
    name: string;
    password: string;
    token: string;
  }): Promise<void> {
    this.authorize(data.token);
    checkStrength(data.password, defaultPolicy);
    if (
      !/^[\p{L}\p{N}_.@-]{1,50}$/u.test(data.login) ||
      !data.name ||
      data.name.length > 80
    )
      throw new BadRequest("Invalid administrator");
    await withLock(this.db, async () => {
      if ((await this.status()).ready)
        throw new BadRequest("Instance already initialized");
      await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      const context = `fresh/${digest(`${this.config.database.host}/${this.config.database.database}`)}`,
        path = resolve(this.config.dataDir, `${digest(context)}.setup`);
      const previous = await readFile(path).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      let hash: string;
      if (previous) {
        const state = JSON.parse(
          open(previous, this.config.deploymentKey, context).toString(),
        );
        if (
          state.login !== data.login ||
          state.name !== data.name ||
          !(await verifyPassword(data.password, state.hash))
        )
          throw new Forbidden("Original setup identity required to resume");
        hash = state.hash;
      } else {
        const [tables] = await this.db.raw("SHOW TABLES");
        if (tables.length) throw new BadRequest("Database is not empty");
        hash = await hashPassword(data.password);
        await writeFile(
          path,
          seal(
            JSON.stringify({ login: data.login, name: data.name, hash }),
            this.config.deploymentKey,
            context,
          ),
          { flag: "wx", mode: 0o600 },
        );
      }
      await createBaseline(this.db, !!previous);
      await migrate(this.db, true);
      if (!this.vault.unlocked) await this.vault.load();
      if (!this.vault.unlocked) await this.vault.initialize();
      await this.db.transaction(async (trx) => {
        const [group] = await trx("UserGroup").insert({
          name: "Administrators",
          description: "nodePass administrators",
        });
        const [profile] = await trx("UserProfile").insert({
          name: "Administrator",
          profile: "NPJ1:{}",
        });
        await trx("User").insert({
          name: data.name,
          login: data.login,
          pass: hash,
          userGroupId: group,
          userProfileId: profile,
          hashSalt: randomBytes(32),
          isAdminApp: 1,
          isAdminAcc: 1,
          isDisabled: 0,
          isLdap: 0,
        });
        const itemHash = createHash("sha1").update("General").digest("hex");
        await trx("Category").insert({ name: "General", hash: itemHash });
        await trx("Client").insert({ name: "General", hash: itemHash });
        await trx("CustomFieldType").insert(
          [
            "text",
            "password",
            "date",
            "number",
            "email",
            "telephone",
            "url",
            "color",
            "wiki",
            "textarea",
          ].map((name, i) => ({ id: i + 1, name, text: name })),
        );
        await putSetting(trx, "security", defaultPolicy);
        await putSetting(trx, "initialized", true);
        await audit(trx, null, "setup.fresh");
      });
      await unlink(path);
    });
  }
  async takeover(data: {
    login: string;
    password: string;
    masterPassword: string;
    token: string;
    configuration?: string;
    maintenance: boolean;
  }): Promise<{ backup: string }> {
    this.authorize(data.token);
    if ((await this.status()).ready)
      throw new BadRequest("Instance already initialized");
    if ((await this.status()).installed && !this.vault.unlocked)
      await this.vault.load();
    if (data.maintenance !== true)
      throw new BadRequest("Stop sysPass before migration");
    this.onProgress?.("configuration");
    const configuration = data.configuration
      ? parseConfig(data.configuration)
      : this.config.legacy;
    this.onProgress?.("preflight");
    const before = await this.preflight(configuration);
    this.onProgress?.("confirm");
    const admins = await this.db("User").where({ login: data.login }).limit(2);
    const rejectAdmin = (reason: keyof typeof setupAdminMessages): never => {
      throw new SetupAccessError(
        "SETUP_ADMIN_REQUIRED",
        setupAdminMessages[reason],
        { reason },
      );
    };
    if (admins.length !== 1)
      rejectAdmin(admins.length ? "ambiguous" : "not_found");
    const admin = admins[0]!;
    if (admin.isDisabled) rejectAdmin("disabled");
    if (!admin.isAdminApp) rejectAdmin("not_application_admin");
    if (admin.isLdap) rejectAdmin("external_auth");
    if (
      !(await verifyPassword(data.password, Buffer.from(admin.pass).toString()))
    )
      rejectAdmin("password_rejected");
    const master = await this.db("Config")
      .where({ parameter: "masterPwd" })
      .first();
    if (
      !master ||
      !(await verifyPassword(
        data.masterPassword,
        Buffer.from(master.value).toString(),
      ))
    )
      throw new Forbidden("Invalid master password");
    for (const row of await this.db("UserProfile").select("id", "profile")) {
      try {
        mapData(row.profile);
      } catch {
        throw new BadRequest(`Invalid profile data: ${row.id}`);
      }
    }
    for (const row of await this.db("User").select("id", "preferences")) {
      try {
        mapData(row.preferences);
      } catch {
        throw new BadRequest(`Invalid preferences: ${row.id}`);
      }
    }
    // Validate every secret before writing anything, including historical entries with older keys.
    for (const table of ["Account", "AccountHistory", "CustomFieldData"]) {
      let last = 0;
      while (true) {
        const rows = await this.db(table)
          .where("id", ">", last)
          .orderBy("id")
          .limit(100);
        if (!rows.length) break;
        for (const row of rows) {
          last = row.id;
          const ciphertext = table === "CustomFieldData" ? row.data : row.pass;
          if (
            !row.key ||
            !Buffer.from(row.key).length ||
            !ciphertext ||
            !Buffer.from(ciphertext).length
          ) {
            const definition =
              table === "CustomFieldData"
                ? await this.db("CustomFieldDefinition")
                    .where({ id: row.definitionId })
                    .first()
                : undefined;
            if (table !== "CustomFieldData" || definition?.isEncrypted)
              throw new BadRequest(
                `Missing encrypted secret: ${table}/${row.id}`,
              );
            continue;
          }
          try {
            await decryptDefuse(
              Buffer.from(ciphertext).toString(),
              Buffer.from(row.key).toString(),
              data.masterPassword,
            );
          } catch {
            throw new BadRequest(
              "Secret cannot be decrypted; migration stopped",
              { table, id: row.id },
            );
          }
        }
      }
    }
    const links = await this.db("PublicLink").select("*");
    // Validate public vaults before the first write; unsupported records never become empty links.
    for (const link of links) {
      try {
        await this.publicVault(link, configuration);
      } catch (error) {
        if (error instanceof BadRequest) throw error;
        throw new BadRequest("Public-link vault cannot be decrypted", {
          id: link.id,
        });
      }
    }
    // Do not disable old MFA silently when its secret cannot be independently verified.
    const pluginData = await this.db("PluginData").where({
        name: "Authenticator",
      }),
      factors: LegacyFactor[] = [];
    for (const row of pluginData) {
      try {
        const factor = await readAuthenticator(
          Buffer.from(row.data),
          Buffer.from(row.key),
          data.masterPassword,
          row.itemId,
        );
        if (!(await this.db("User").where({ id: factor.userId }).first()))
          throw new Error("Unknown user");
        factors.push(factor);
      } catch {
        throw new BadRequest(
          "Unsupported Authenticator data; migration stopped without disabling MFA",
          { userId: row.itemId },
        );
      }
    }
    let saved = "";
    this.onProgress?.("backups");
    await withLock(this.db, async () => {
      if ((await this.status()).ready)
        throw new BadRequest("Instance already initialized");
      const statePath = resolve(
        this.config.dataDir,
        `migration-${digest(`${this.config.database.host}/${this.config.database.database}`).slice(0, 24)}.json`,
      );
      const state = await readFile(statePath, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      if (state) {
        const marker = JSON.parse(state);
        if (
          typeof marker.backup !== "string" ||
          !/^nodepass-[\d]+-[\w-]{8}\.npb$/.test(marker.backup)
        )
          throw new Error("Invalid migration checkpoint");
        saved = marker.backup;
        await readBackup(
          resolve(this.config.dataDir, "backups", saved),
          this.config.deploymentKey,
          resolve(this.config.dataDir, "restore"),
          () => {},
        );
      } else {
        saved = await backup(
          this.db,
          resolve(this.config.dataDir, "backups"),
          this.config.deploymentKey,
          configuration,
        );
        await writeFile(statePath, JSON.stringify({ backup: saved }), {
          flag: "wx",
          mode: 0o600,
        });
      }
      await migrate(this.db, true);
      if (!this.vault.unlocked) {
        if (await this.db("nodepass_keyring").where({ id: "vault" }).first())
          await this.vault.load();
        else await this.vault.initialize(data.masterPassword);
      }
      // Resume safe: modern rows are recognizable and not rewritten on restart.
      this.onProgress?.("files");
      let last = 0;
      while (true) {
        const files = await this.db("AccountFile")
          .where("id", ">", last)
          .orderBy("id")
          .limit(1);
        if (!files.length) break;
        for (const file of files) {
          last = file.id;
          const exists = await this.db("nodepass_attachments")
            .where({ id: file.id })
            .first();
          if (exists) {
            this.vault.unwrap(
              Buffer.from(exists.content),
              `attachment/${file.id}`,
            );
            continue;
          }
          const value = this.vault.wrap(
            Buffer.from(file.content),
            `attachment/${file.id}`,
          );
          if (
            !equal(
              this.vault.unwrap(value, `attachment/${file.id}`),
              Buffer.from(file.content),
            )
          )
            throw new Error("Attachment verification failed");
          await this.db.transaction(async (trx) => {
            await trx("nodepass_attachments").insert({
              id: file.id,
              content: value,
              thumb: file.thumb?.length
                ? this.vault.wrap(
                    Buffer.from(file.thumb),
                    `attachment-thumb/${file.id}`,
                  )
                : null,
            });
            await trx("AccountFile")
              .where({ id: file.id })
              .update({ content: Buffer.alloc(0), thumb: null });
          });
        }
      }
      for (const link of links) {
        this.onProgress?.("shares");
        if (Buffer.from(link.data).subarray(0, 4).toString() === "NP1\0")
          continue;
        const value = await this.publicVault(link, configuration);
        await this.db("PublicLink")
          .where({ id: link.id })
          .update({
            data: this.vault.wrap(
              JSON.stringify(value),
              `public-link/${link.id}`,
            ),
          });
      }
      await this.db.transaction(async (trx) => {
        await validateRelations(trx);
        for (const [table, count] of Object.entries(before.tables)) {
          const actual = await trx(table).count({ n: "*" }).first();
          if (Number(actual!.n) !== count)
            throw new BadRequest(
              "Row count changed during migration; keep sysPass stopped",
              { table },
            );
        }
        for (const factor of factors) {
          if (!factor.enabled) continue;
          const exists = await trx("nodepass_factors")
            .where({ userId: factor.userId, kind: "totp", confirmed: 1 })
            .first();
          if (!exists) {
            await trx("nodepass_factors").insert({
              userId: factor.userId,
              kind: "totp",
              name: "Authenticator",
              data: this.vault
                .wrap(factor.secret, `totp/${factor.userId}`)
                .toString("base64"),
              confirmed: 1,
              counter: 0,
            });
            for (const code of factor.recoveryCodes)
              await trx("nodepass_factors").insert({
                userId: factor.userId,
                kind: "recovery",
                name: "Recovery",
                data: digest(code),
                confirmed: 1,
                counter: 0,
              });
          }
        }
        await trx("nodepass_keyring")
          .insert({
            id: "legacy-config",
            value: seal(
              JSON.stringify(configuration),
              this.config.deploymentKey,
              "keyring/legacy-config",
            ),
          })
          .onConflict("id")
          .merge();
        await trx("User").update({ mPass: null, mKey: null });
        await trx("AuthToken").update({ vault: null });
        // Remove obsolete duplicate MFA secrets only after their replacements are persisted.
        await trx("PluginData").where({ name: "Authenticator" }).delete();
        await putSetting(
          trx,
          "fullGroupAccess",
          configuration.accountFullGroupAccess === "1",
        );
        await putSetting(trx, "security", defaultPolicy);
        await putSetting(trx, "initialized", true);
        await putSetting(trx, "migrationBackup", saved);
        await audit(trx, admin.id, "setup.migrate");
      });
    });
    return { backup: saved };
  }
  private async publicVault(
    link: Row,
    configuration: LegacyConfig,
  ): Promise<unknown> {
    if (!link.data)
      throw new BadRequest("Missing public-link data", { id: link.id });
    if (Buffer.from(link.data).subarray(0, 4).toString() === "NP1\0")
      return JSON.parse(
        this.vault
          .unwrap(Buffer.from(link.data), `public-link/${link.id}`)
          .toString(),
      );
    const salt = String(configuration.passwordSalt ?? "");
    if (!salt)
      throw new BadRequest("Missing public-link salt; migration stopped", {
        id: link.id,
      });
    const password = createHash("sha1")
        .update(salt + Buffer.from(link.hash).toString())
        .digest("hex"),
      outer = phpMap(link.data);
    if (typeof outer.data !== "string" || typeof outer.key !== "string")
      throw new BadRequest("Invalid public-link vault", { id: link.id });
    return phpMap(await decryptDefuse(outer.data, outer.key, password));
  }
  async importDump(source: string, configuration?: string): Promise<void> {
    this.onProgress?.("configuration");
    if (configuration !== undefined) parseConfig(configuration);
    this.onProgress?.("target");
    if ((await this.status()).legacy)
      throw new BadRequest(
        "Dump import requires an empty, separate target database",
      );
    const schema = JSON.parse(
      await readFile(resource("schema.json"), "utf8"),
    ) as Record<string, { name: string; type: string }[]>;
    this.onProgress?.("decode");
    const data = decodeDump(source, schema);
    if (!data.some((table) => table.rows.length))
      throw new SetupInputError(
        "DUMP_EMPTY",
        "The SQL dump contains no supported INSERT data. Export the complete database, including its data.",
      );
    this.onProgress?.("schema");
    await createBaseline(this.db);
    this.onProgress?.("data");
    await this.db.transaction(async (trx) => {
      await trx.raw("SET FOREIGN_KEY_CHECKS=0");
      try {
        for (const table of data)
          for (let i = 0; i < table.rows.length; i += 100) {
            try {
              await trx(table.table).insert(table.rows.slice(i, i + 100));
            } catch (error) {
              // Driver errors include full SQL and bound secrets. Keep only a safe category.
              const failure = setupFailure(error);
              throw new SetupInputError(failure.code, failure.message, {
                table: table.table,
                row: i + 1,
              });
            }
          }
        this.onProgress?.("relations");
        await validateRelations(trx);
      } finally {
        await trx.raw("SET FOREIGN_KEY_CHECKS=1");
      }
    });
    // A full preflight and identity/key verification are still mandatory before activation.
  }
}
