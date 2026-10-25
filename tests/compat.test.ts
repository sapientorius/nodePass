import { describe, it, expect } from "vitest";
import { readPhp, phpMap } from "../packages/server/src/compat/php.js";
import { parseConfig } from "../packages/server/src/compat/config.js";
import { decodeDump } from "../packages/server/src/migration/dump.js";
describe("PHP data reader", () => {
  it("reads data without instantiating classes", () => {
    expect(readPhp('a:2:{s:2:"id";i:3;s:4:"flag";b:1;}')).toEqual({
      id: 3,
      flag: true,
    });
    expect(readPhp('s:6:"日本";')).toBe("日本");
    expect(readPhp("N;")).toBe(null);
    expect(readPhp("d:1.5;")).toBe(1.5);
    expect(phpMap(null)).toEqual({});
  });
  it.each([
    'O:4:"Evil":0:{}',
    "R:1;",
    'a:1:{s:9:"__proto__";N;}',
    's:99:"x";',
    "a:2:{i:0;N;}",
    "b:2;",
    "i:1;garbage",
    "a:1:{N;N;}",
    "d:INF;",
    "i:9007199254740993;",
    's:1:"日";',
  ])("rejects unsafe or malformed serialization: %s", (value) =>
    expect(() => readPhp(value)).toThrow(),
  );
  it("enforces depth and length limits", () => {
    expect(() =>
      readPhp("a:1:{i:0;".repeat(30) + "N;" + "}".repeat(30)),
    ).toThrow();
    expect(() => readPhp("x".repeat(4000001))).toThrow();
    expect(() => phpMap("b:0;")).toThrow();
  });
});
describe("legacy configuration", () => {
  it("accepts XML and literal values", () =>
    expect(
      parseConfig(
        "<config><dbHost>db</dbHost><dbPort>3306</dbPort><filesAllowedExts><item>PDF</item></filesAllowedExts></config>",
      ),
    ).toEqual({ dbHost: "db", dbPort: "3306", filesAllowedExts: ["PDF"] }));
  it.each([
    '<!DOCTYPE config [<!ENTITY e SYSTEM "file:///etc/passwd">]><config/>',
    "<other/>",
    "<config>",
  ])("rejects unsafe config", (s) => expect(() => parseConfig(s)).toThrow());
  it.each(["310.19081801", "300.1", "3211.22070201", "99.unknown", ""])(
    "treats appVersion and databaseVersion as informational metadata: %s",
    (version) => {
      expect(
        parseConfig(
          `<config><appVersion>${version}</appVersion><databaseVersion>unknown</databaseVersion></config>`,
        ),
      ).toEqual({ appVersion: version, databaseVersion: "unknown" });
    },
  );
});
describe("restricted SQL import", () => {
  const schema = { User: [{ name: "id" }, { name: "login" }] };
  it("decodes data, comments, quotes and binary values", () => {
    const result = decodeDump(
      "-- dump\n/*!40101 SET NAMES utf8 */; INSERT INTO `User` VALUES (1,'O\\'Brien'),(2,0x6162);",
      schema,
    );
    expect(result[0]?.rows).toEqual([
      { id: 1, login: "O'Brien" },
      { id: 2, login: Buffer.from("ab") },
    ]);
  });
  it.each([
    "LOAD DATA INFILE '/etc/passwd';",
    "INSERT INTO User VALUES (1,CONCAT('a','b'));",
    "INSERT INTO Other VALUES (1,2);",
    "INSERT INTO User (id,id) VALUES (1,2);",
    "INSERT INTO User VALUES (1,'unterminated);",
    "CREATE TRIGGER bad;",
    "INSERT INTO User VALUES (1,0xabc);",
  ])("rejects executable or malformed input: %s", (sql) =>
    expect(() => decodeDump(sql, schema)).toThrow(),
  );
});
