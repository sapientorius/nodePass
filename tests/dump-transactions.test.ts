import { describe, expect, it } from "vitest";
import { decodeDump } from "../packages/server/src/migration/dump.js";
import { setupFailure } from "../packages/server/src/migration/errors.js";

const schema = { User: [{ name: "id" }, { name: "login" }] };
const data = "INSERT INTO User VALUES (1,'admin');";

describe("export transaction metadata", () => {
  it.each([
    "START TRANSACTION;",
    "start\ntransaction;",
    "BEGIN;",
    "BEGIN WORK;",
    "COMMIT;",
    "commit work;",
    "BEGIN /* comment */ WORK;",
    "START /* comment */ TRANSACTION /* comment */;",
  ])(
    "skips only the complete wrapper %s and retains the following rows",
    (wrapper) => {
      expect(decodeDump(wrapper + data, schema)).toEqual([
        { table: "User", rows: [{ id: 1, login: "admin" }] },
      ]);
    },
  );

  it("reads phpMyAdmin transaction framing with START TRANSACTION on line 11", () => {
    const dump =
      Array(10).fill("-- export header").join("\n") +
      "\nSTART TRANSACTION;\nSET time_zone = '+00:00';\n" +
      data +
      "\nCOMMIT;";
    expect(decodeDump(dump, schema)[0]!.rows).toEqual([
      { id: 1, login: "admin" },
    ]);
  });

  it.each([
    "START REPLICA;",
    "START TRANSACTION DELETE FROM User;",
    "START TRANSACTION",
    "BEGIN INSERT INTO User VALUES (2,'secret');",
    "BEGIN ATOMIC;",
    "COMMIT UPDATE User SET login='secret';",
    "COMMIT AND CHAIN;",
    "COMMIT WORK DELETE FROM User;",
  ])(
    "rejects unknown forms instead of swallowing data instructions: %s",
    (source) => {
      expect(() => decodeDump(source + data, schema)).toThrow();
    },
  );

  it.each(["UPDATE", "DELETE", "REPLACE", "ROLLBACK", "CALL", "DELIMITER"])(
    "keeps %s explicit and reports only a fixed keyword",
    (operation) => {
      try {
        decodeDump(
          "START TRANSACTION;\n" + data + "\n" + operation + " private-secret;",
          schema,
        );
        throw new Error("Expected rejection");
      } catch (error) {
        const failure = setupFailure(error);
        expect(failure).toMatchObject({
          code: "DUMP_OPERATION",
          details: { line: 3, operation },
        });
        expect(JSON.stringify(failure)).not.toContain("private-secret");
      }
    },
  );

  it("redacts unknown tokens rather than reflecting uploaded content as an operation", () => {
    try {
      decodeDump("privateSecret;", schema);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(setupFailure(error)).toMatchObject({
        code: "DUMP_OPERATION",
        details: { operation: "UNKNOWN" },
      });
      expect(JSON.stringify(setupFailure(error))).not.toContain(
        "PRIVATESECRET",
      );
    }
  });
});
