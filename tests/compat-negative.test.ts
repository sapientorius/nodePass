import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseConfig } from "../packages/server/src/compat/config.js";
import { readPhp } from "../packages/server/src/compat/php.js";
import { decodeDump } from "../packages/server/src/migration/dump.js";
import { readAuthenticator } from "../packages/server/src/compat/authenticator.js";
import {
  encryptDefuse,
  decryptDefuse,
  unlockDefuse,
} from "../packages/server/src/compat/defuse.js";
import { serializePhp } from "./serialization.js";
import { fieldModule } from "../packages/server/src/compat/field-modules.js";
it("maps the 3.2.11 ActionsInterface IDs and preserves the documented pre-3.0 aliases", () => {
  for (const [id, canonical] of [
    [1, 1],
    [10, 1],
    [101, 101],
    [61, 101],
    [301, 301],
    [62, 301],
    [701, 701],
    [71, 701],
    [801, 801],
    [72, 801],
    [901, 901],
    [1001, 1001],
  ])
    expect(fieldModule(id!).id).toBe(canonical);
  expect(() => fieldModule(63)).toThrow("Unsupported");
});
const reference = JSON.parse(
  readFileSync(new URL("fixtures/reference.json", import.meta.url), "utf8"),
);
describe("legacy input limits and rejection contracts", () => {
  it("reads complete literal lists and rejects nested or malformed configuration structures", () => {
    expect(
      parseConfig(
        "<config><filesAllowedExts><item>PDF</item><item>TXT</item></filesAllowedExts><appVersion>3211.22070201</appVersion></config>",
      ).filesAllowedExts,
    ).toEqual(["PDF", "TXT"]);
    for (const source of [
      "<config><invalid-key>value</invalid-key></config>",
      "<config><list><item><nested/></item></list></config>",
      "<config><list><item>A</item><item><nested/></item></list></config>",
      "<config><unsupported><nested/></unsupported></config>",
      "<config>" + " ".repeat(1000001) + "</config>",
    ])
      expect(() => parseConfig(source)).toThrow();
  });
  it.each([
    "a:-1:{}",
    "a:10001:{}",
    'a:2:{s:1:"x";i:1;s:1:"x";i:2;}',
    "i:" + "1".repeat(201) + ";",
    "i:",
    "a:5001:{" +
      Array.from({ length: 5001 }, (_, i) => `i:${i};N;`).join("") +
      "}",
  ])("rejects impossible map/token sizes and aliases", (source) =>
    expect(() => readPhp(source)).toThrow(),
  );
  it.each(["not-hex", "0", "de00", "00".repeat(50)])(
    "rejects malformed Defuse key material %s",
    async (key) => {
      await expect(unlockDefuse(key, "password")).rejects.toThrow();
    },
  );
  it("rejects a wrong key header with valid checksum and unsupported ciphertext header", async () => {
    const b = Buffer.from(reference.secret.key, "hex");
    b[0] = 0;
    createHash("sha256")
      .update(b.subarray(0, -32))
      .digest()
      .copy(b, b.length - 32);
    await expect(
      unlockDefuse(b.toString("hex"), reference.master),
    ).rejects.toThrow("key");
    await expect(
      decryptDefuse("00".repeat(100), reference.secret.key, reference.master),
    ).rejects.toThrow("ciphertext");
    await expect(
      decryptDefuse("zz", reference.secret.key, reference.master),
    ).rejects.toThrow("encoding");
  });
  it("validates every official Authenticator field and retains explicitly disabled factors as disabled", async () => {
    const base = {
      userId: 1,
      twofaEnabled: 1,
      IV: "JBSWY3DPEHPK3PXP",
      recoveryCodes: ["synthetic-recovery-code"],
    };
    for (const patch of [
      { unexpected: true },
      { userId: 2 },
      { twofaEnabled: 2 },
      { IV: "invalid" },
      { IV: 123 },
      { recoveryCodes: ["short"] },
      { recoveryCodes: [123] },
      {
        recoveryCodes: Array.from(
          { length: 21 },
          () => "synthetic-recovery-code",
        ),
      },
    ]) {
      const data = await encryptDefuse(
        serializePhp({ ...base, ...patch }),
        "password",
      );
      await expect(
        readAuthenticator(
          Buffer.from(data.pass),
          Buffer.from(data.key),
          "password",
          1,
        ),
      ).rejects.toThrow();
    }
    const disabled = await encryptDefuse(
      serializePhp({
        userId: 1,
        twofaEnabled: false,
        IV: null,
        recoveryCodes: null,
      }),
      "password",
    );
    expect(
      await readAuthenticator(
        Buffer.from(disabled.pass),
        Buffer.from(disabled.key),
        "password",
        1,
      ),
    ).toEqual({ userId: 1, enabled: false, secret: "", recoveryCodes: [] });
  });
});
describe("restricted dump grammar", () => {
  const schema = { User: [{ name: "id" }, { name: "login" }] };
  it("accepts known metadata without ever interpreting its SQL", () => {
    const sql =
      "SET @x='quoted \\' and '' escape'; LOCK TABLES User WRITE; UNLOCK TABLES; USE `ignored`; DROP TABLE IF EXISTS User; DROP VIEW IF EXISTS account_data_v; CREATE TABLE User (`id` int, `login` varchar(50) DEFAULT 'x;''quote'); CREATE TABLE account_search_v (id int); INSERT INTO User (login,id) VALUES ('A',1); -- ending comment";
    expect(decodeDump(sql, schema)[0]!.rows).toEqual([{ login: "A", id: 1 }]);
    expect(decodeDump("--", schema)).toEqual([]);
    expect(decodeDump("SET @x=1", schema)).toEqual([]);
  });
  it("decodes SQL escaping, NULL, numbers and concatenated inserts", () => {
    const sql =
      "; INSERT INTO User VALUES (1,'a''b\\n\\r\\t\\b\\Z\\0\\q'); INSERT INTO User VALUES (NULL,-2.5);";
    expect(decodeDump(sql, schema)[0]!.rows).toEqual([
      { id: 1, login: "a'b\n\r\t\b\x1a\0q" },
      { id: null, login: -2.5 },
    ]);
  });
  it.each([
    "\0",
    "\ufffd",
    "/* unfinished",
    "/*!50003 CREATE TRIGGER unsafe BEFORE INSERT ON User FOR EACH ROW SET @x=1 */;",
    "/*M!100100 CREATE PROCEDURE unsafe() SELECT 1 */;",
    "CREATE TABLE constructor (id int);",
    "INSERT INTO __proto__ VALUES (1);",
    "DROP TABLE IF EXISTS Other;",
    "DROP VIEW IF EXISTS other_v;",
    "CREATE TABLE Other (id int);",
    "CREATE TABLE User (login varchar(5) DEFAULT 'unfinished);",
    "INSERT INTO User (unknown) VALUES (1);",
    "INSERT INTO User (id;login) VALUES (1,2);",
    "INSERT INTO User VALUES (1,'unfinished\\",
    "INSERT INTO User VALUES (" + "9".repeat(400) + ",NULL);",
  ])("rejects unsupported or ambiguous syntax %s", (source) =>
    expect(() => decodeDump(source, schema)).toThrow(),
  );
  it("bounds the total row count even with repeated inserts", () => {
    const rows = Array.from({ length: 200001 }, () => "(1,NULL)").join(",");
    expect(() =>
      decodeDump("INSERT INTO User VALUES " + rows + ";", schema),
    ).toThrow("row limit");
  });
});
