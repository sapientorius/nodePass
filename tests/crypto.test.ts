import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import {
  open,
  seal,
  encryptSecret,
  decryptSecret,
  equal,
} from "../packages/server/src/security/crypto.js";
import { decryptDefuse } from "../packages/server/src/compat/defuse.js";
import {
  verifyPassword,
  checkStrength,
  hashPassword,
} from "../packages/server/src/security/password.js";
describe("authenticated encryption", () => {
  it("binds ciphertext and wrapped keys to their record", () => {
    const key = randomBytes(32),
      value = encryptSecret("日本語\0secret", key, "Account/1/pass");
    expect(decryptSecret(value, key, "Account/1/pass")).toBe("日本語\0secret");
    expect(() => decryptSecret(value, key, "Account/2/pass")).toThrow();
    expect(() =>
      decryptSecret(value, randomBytes(32), "Account/1/pass"),
    ).toThrow();
  });
  it("rejects tampering, truncation, bad context and invalid keys", () => {
    const key = randomBytes(32),
      value = seal("secret", key, "test");
    for (let i = 0; i < value.length; i++) {
      const bad = Buffer.from(value);
      bad[i] = bad[i]! ^ 1;
      expect(() => open(bad, key, "test")).toThrow();
    }
    for (let i = 0; i < 32; i++)
      expect(() => open(value.subarray(0, i), key, "test")).toThrow();
    expect(() => seal("", key, "")).toThrow();
    expect(() => seal("", Buffer.alloc(0), "x")).toThrow();
    expect(equal("a", "aa")).toBe(false);
    expect(equal("a", "b")).toBe(false);
    expect(equal("a", "a")).toBe(true);
  });
});
describe("upstream PHP interoperability", () => {
  const document = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    attributeNamePrefix: "@",
  }).parse(
    readFileSync(
      new URL("fixtures/syspass-account-crypt.xml", import.meta.url),
      "utf8",
    ),
  );
  const tables = document.mysqldump.database.table_data as {
    "@name": string;
    row: Record<string, unknown> | Record<string, unknown>[];
  }[];
  function rows(name: string) {
    const t = tables.find((t) => t["@name"] === name)!;
    return Array.isArray(t.row) ? t.row : [t.row];
  }
  function fields(row: Record<string, unknown>) {
    return Object.fromEntries(
      (
        row.field as {
          "@name": string;
          "#text"?: string;
          "@xsi:type"?: string;
        }[]
      ).map((f) => [
        f["@name"],
        f["@xsi:type"] === "xs:hexBinary"
          ? Buffer.from(f["#text"] ?? "", "hex").toString()
          : (f["#text"] ?? ""),
      ]),
    );
  }
  it("decrypts an independently generated sysPass custom-field fixture", async () => {
    const row = fields(rows("CustomFieldData")[0]!);
    expect(
      (await decryptDefuse(row.data!, row.key!, "12345678900")).toString(),
    ).toBe("1234");
    await expect(decryptDefuse(row.data!, row.key!, "wrong")).rejects.toThrow();
    await expect(
      decryptDefuse(row.data!.slice(2), row.key!, "12345678900"),
    ).rejects.toThrow();
  });
  it("reads every account and history ciphertext from the original test dataset", async () => {
    for (const name of ["Account", "AccountHistory"])
      for (const source of rows(name)) {
        const row = fields(source);
        const clear = await decryptDefuse(row.pass!, row.key!, "12345678900");
        expect(clear.length).toBeGreaterThan(0);
      }
  });
  it("validates the PHP bcrypt hash", async () => {
    expect(
      await verifyPassword(
        "12345678900",
        "$2y$10$xtsuN2PUvgSH/0mrfBlsbOActVgCjYcqDqC6L3T9QraNxZC4RXGYa",
      ),
    ).toBe(true);
    expect(
      await verifyPassword(
        "incorrect",
        "$2y$10$xtsuN2PUvgSH/0mrfBlsbOActVgCjYcqDqC6L3T9QraNxZC4RXGYa",
      ),
    ).toBe(false);
  });
});
describe("new login passwords", () => {
  it("uses Argon2id and validates both positive and negative cases", async () => {
    const hash = await hashPassword("synthetic password 7Q!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword("synthetic password 7Q!", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("x", "bad")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(
      await verifyPassword(
        "x",
        "$argon2id$v=19$m=999999999,t=99,p=99$salt$hash",
      ),
    ).toBe(false);
  });
  it("enforces configured strength only when explicitly requested", () => {
    expect(() =>
      checkStrength("passwordpassword", { minLength: 15, minScore: 3 }),
    ).toThrow();
    expect(() =>
      checkStrength("violet meteor cascade unicycle 83!", {
        minLength: 15,
        minScore: 3,
      }),
    ).not.toThrow();
    expect(() =>
      checkStrength("x".repeat(129), { minLength: 15, minScore: 3 }),
    ).toThrow();
  });
});
