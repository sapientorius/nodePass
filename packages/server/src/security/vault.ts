import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, open, seal } from "./crypto.js";
import { decryptDefuse } from "../compat/defuse.js";
import type { Database } from "../db.js";
export class Vault {
  private kek?: Buffer;
  private legacyMaster?: string;
  constructor(
    private db: Database,
    private deploymentKey: Buffer,
  ) {}
  get unlocked(): boolean {
    return this.kek !== undefined;
  }
  async configuration<T>(id: string, fallback: T): Promise<T> {
    const row = await this.db("nodepass_keyring").where({ id }).first();
    return row
      ? (JSON.parse(
          open(
            Buffer.from(row.value),
            this.deploymentKey,
            `keyring/${id}`,
          ).toString(),
        ) as T)
      : fallback;
  }
  async saveConfiguration(id: string, value: unknown): Promise<void> {
    if (id === "vault" || id.length > 80)
      throw new Error("Invalid configuration key");
    await this.db("nodepass_keyring")
      .insert({
        id,
        value: seal(JSON.stringify(value), this.deploymentKey, `keyring/${id}`),
      })
      .onConflict("id")
      .merge();
  }
  async load(): Promise<void> {
    const row = await this.db("nodepass_keyring")
      .where({ id: "vault" })
      .first();
    if (!row) return;
    const data = JSON.parse(
      open(
        Buffer.from(row.value),
        this.deploymentKey,
        "keyring/vault",
      ).toString(),
    ) as { key: string; legacyMaster?: string };
    this.kek = Buffer.from(data.key, "base64");
    this.legacyMaster = data.legacyMaster;
    if (this.kek.length !== 32) throw new Error("Invalid vault key");
  }
  async initialize(master?: string): Promise<void> {
    if (await this.db("nodepass_keyring").where({ id: "vault" }).first())
      throw new Error("Vault already initialized");
    this.kek = randomBytes(32);
    this.legacyMaster = master;
    await this.persist();
  }
  private async persist(): Promise<void> {
    if (!this.kek) throw new Error("Vault locked");
    const value = seal(
      JSON.stringify({
        key: this.kek.toString("base64"),
        legacyMaster: this.legacyMaster,
      }),
      this.deploymentKey,
      "keyring/vault",
    );
    await this.db("nodepass_keyring")
      .insert({ id: "vault", value })
      .onConflict("id")
      .merge();
  }
  encrypt(value: string, context: string): { pass: Buffer; key: Buffer } {
    if (!this.kek) throw new Error("Vault locked");
    return encryptSecret(value, this.kek, context);
  }
  async decrypt(
    pass: Buffer | string,
    key: Buffer | string,
    context: string,
  ): Promise<string> {
    if (!this.kek) throw new Error("Vault locked");
    const b = Buffer.from(pass);
    if (b.subarray(0, 4).toString() === "NP1\0")
      return decryptSecret(
        { pass: b, key: Buffer.from(key) },
        this.kek,
        context,
      );
    if (!this.legacyMaster) throw new Error("Legacy key unavailable");
    return (
      await decryptDefuse(
        b.toString(),
        Buffer.from(key).toString(),
        this.legacyMaster,
      )
    ).toString();
  }
  wrap(value: string | Buffer, context: string): Buffer {
    if (!this.kek) throw new Error("Vault locked");
    return seal(value, this.kek, context);
  }
  unwrap(value: Buffer, context: string): Buffer {
    if (!this.kek) throw new Error("Vault locked");
    return open(value, this.kek, context);
  }
  async rewrapDeployment(newKey: Buffer): Promise<void> {
    if (newKey.length !== 32) throw new Error("Invalid deployment key");
    await this.db.transaction(async (trx) => {
      const rows = await trx("nodepass_keyring").forUpdate();
      for (const row of rows) {
        const clear = open(
          Buffer.from(row.value),
          this.deploymentKey,
          `keyring/${row.id}`,
        );
        try {
          await trx("nodepass_keyring")
            .where({ id: row.id })
            .update({ value: seal(clear, newKey, `keyring/${row.id}`) });
        } finally {
          clear.fill(0);
        }
      }
    });
    this.deploymentKey = newKey;
  }
  destroy(): void {
    this.kek?.fill(0);
    this.kek = undefined;
    this.legacyMaster = undefined;
  }
}
