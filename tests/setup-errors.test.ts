import { describe, expect, it } from "vitest";
import { BadRequest } from "@feathersjs/errors";
import {
  SetupInputError,
  SetupAccessError,
  setupAdminMessages,
  setupFailure,
} from "../packages/server/src/migration/errors.js";
import { decodeDump } from "../packages/server/src/migration/dump.js";
import { parseConfig } from "../packages/server/src/compat/config.js";
import {
  setupErrorContext,
  setupErrorMessage,
} from "../packages/web/src/setup-errors.js";

const schema = { User: [{ name: "id" }, { name: "login" }] };

describe("safe setup diagnostics", () => {
  it("keeps administrator proof failures forbidden and explains the existing identity requirement", () => {
    const error = new SetupAccessError(
      "SETUP_ADMIN_REQUIRED",
      "Existing sysPass administrator credentials required",
    );
    expect(error.code).toBe(403);
    const failure = setupFailure(error);
    expect(failure.code).toBe("SETUP_ADMIN_REQUIRED");
    expect(setupErrorMessage(failure, "de_DE")).toContain(
      "bisherige Login-Passwort",
    );
    expect(setupErrorMessage(failure, "de_DE")).toContain(
      "aktiven lokalen sysPass-Anwendungsadministrators",
    );
    expect(setupErrorMessage(failure, "en_US")).toBe(error.message);
  });
  it.each(Object.entries(setupAdminMessages))(
    "returns the bounded administrator rejection reason %s without credentials",
    (reason, message) => {
      const error = new SetupAccessError("SETUP_ADMIN_REQUIRED", message, {
        reason,
        login: "private-login",
        password: "private-password",
        hash: "private-hash",
      });
      const failure = setupFailure(error);
      expect(error.code).toBe(403);
      expect(failure.details).toEqual({ reason });
      expect(setupErrorMessage(failure, "de_DE")).not.toBe(message);
      expect(setupErrorMessage(failure, "en_US")).toBe(message);
      expect(JSON.stringify(failure)).not.toContain("private-");
    },
  );
  it("does not reflect unknown administrator diagnostic reasons", () => {
    const failure = setupFailure(
      new SetupAccessError("SETUP_ADMIN_REQUIRED", "Safe message", {
        reason: "private-secret",
      }),
    );
    expect(failure.details).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain("private-secret");
    expect(
      setupErrorMessage(
        { ...failure, details: { reason: "private-secret" } },
        "de_DE",
      ),
    ).toContain("bisherige Login-Passwort");
  });
  it("reads metadata produced by the original FileBackupService without executing it", () => {
    const source = `-- sysPass DB dump generated on 1 (START)
SET AUTOCOMMIT = 0;
SET FOREIGN_KEY_CHECKS = 0;
CREATE DATABASE IF NOT EXISTS \`source_database\`;
USE \`source_database\`;
DROP TABLE IF EXISTS \`User\`;
CREATE TABLE \`User\` (\`id\` int, \`login\` varchar(50));
DROP TABLE IF EXISTS \`account_data_v\`;
CREATE ALGORITHM=UNDEFINED DEFINER=\`legacy_user\`@\`%\` SQL SECURITY DEFINER VIEW \`account_data_v\` AS SELECT \`id\` FROM \`User\`;
CREATE VIEW \`account_search_v\` AS SELECT \`id\` FROM \`User\`;
INSERT INTO \`User\` VALUES(1,'admin');
SET AUTOCOMMIT = 1;`;
    expect(decodeDump(source, schema)).toEqual([
      { table: "User", rows: [{ id: 1, login: "admin" }] },
    ]);
    expect(() => decodeDump("CREATE VIEW User AS SELECT 1;", schema)).toThrow(
      "Unknown dump table or view",
    );
    expect(() =>
      decodeDump(
        "CREATE TRIGGER unsafe BEFORE INSERT ON User FOR EACH ROW SET @x=1;",
        schema,
      ),
    ).toThrow();
  });

  it("returns the SQL line, known table and row without including dump values", () => {
    const source =
      "-- source\nCREATE DATABASE IF NOT EXISTS `source`;\nINSERT INTO User VALUES (1,'private-secret'),\n(2,CONCAT('do-not-log'));";
    try {
      decodeDump(source, schema);
      throw new Error("Expected rejection");
    } catch (error) {
      const failure = setupFailure(error);
      expect(failure.code).toBe("DUMP_SYNTAX");
      expect(failure.details).toEqual({
        line: 4,
        operation: "INSERT",
        table: "User",
        row: 2,
      });
      expect(JSON.stringify(failure)).not.toMatch(
        /private-secret|do-not-log|CONCAT|source_database/,
      );
    }
  });

  it("explains invalid UTF-8 and reports the first affected line", () => {
    try {
      decodeDump("-- header\n\ufffd", schema);
    } catch (error) {
      expect(setupFailure(error)).toMatchObject({
        code: "DUMP_ENCODING",
        details: { line: 2 },
      });
      expect(setupFailure(error).message).toContain("--hex-blob");
    }
  });

  it.each([
    ["<config>", "CONFIG_XML"],
    ["<other/>", "CONFIG_ROOT"],
    ["<config><secret><nested/></secret></config>", "CONFIG_VALUE"],
  ])("explains rejected configurations without echoing XML", (xml, code) => {
    expect(() => parseConfig(xml)).toThrow(SetupInputError);
    try {
      parseConfig(xml);
    } catch (error) {
      expect(setupFailure(error).code).toBe(code);
      expect(JSON.stringify(setupFailure(error))).not.toContain(xml);
    }
  });

  it("classifies database and storage failures without copying driver SQL, messages or credentials", () => {
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ER_ACCESS_DENIED_ERROR",
      "ER_DBACCESS_DENIED_ERROR",
      "ER_DUP_ENTRY",
      "ER_DATA_TOO_LONG",
      "ER_BAD_NULL_ERROR",
      "ER_NO_DEFAULT_FOR_FIELD",
      "ER_TRUNCATED_WRONG_VALUE",
      "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD",
      "EACCES",
      "EROFS",
      "ENOSPC",
    ]) {
      const failure = setupFailure(
        Object.assign(new Error("INSERT INTO secret VALUES ('password')"), {
          code,
          sql: "secret",
          data: { table: "secret" },
        }),
      );
      expect(failure.code).not.toBe("SETUP_INTERNAL");
      expect(JSON.stringify(failure)).not.toMatch(/INSERT|password|secret/);
    }
    for (const error of [
      undefined,
      null,
      "secret",
      new Error("secret"),
      { code: "secret", message: "secret" },
      { code: 400, message: "secret" },
    ]) {
      expect(setupFailure(error).code).toBe("SETUP_INTERNAL");
      expect(JSON.stringify(setupFailure(error))).not.toContain("secret");
    }
  });

  it("bounds and filters validation metadata", () => {
    const failure = setupFailure(
      new BadRequest("Invalid data", {
        id: 1,
        userId: -1,
        row: "secret",
        line: 2.1,
        table: "User",
        column: "bad column",
        password: "secret",
        operation: "INSERT",
        columns: ["User.id", "secret value", ...Array(60).fill("User.login")],
      }),
    );
    expect(failure.code).toBe("SETUP_VALIDATION");
    expect(failure.details).toEqual({
      id: 1,
      table: "User",
      operation: "INSERT",
      columns: ["User.id", ...Array(49).fill("User.login")],
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
    expect(
      setupFailure(
        new BadRequest("Invalid data", { operation: "private-secret" }),
      ).details,
    ).toBeUndefined();
  });

  it("formats German actionable messages and readable context with an English fallback", () => {
    const failure = {
      code: "DUMP_ENCODING",
      message: "Use --hex-blob",
      details: {
        line: 8,
        table: "User",
        columns: ["User.id"],
        password: "secret",
        operation: "INSERT",
      },
    };
    expect(setupErrorMessage(failure, "de_DE")).toContain("Binärdaten");
    expect(setupErrorMessage(failure, "en_US")).toBe(failure.message);
    expect(
      setupErrorMessage({ message: "Fallback", code: "unknown" }, "de_DE"),
    ).toBe("Fallback");
    expect(setupErrorContext(failure, "de_DE")).toBe(
      "SQL-Zeile: 8 · Tabelle: User · Spalten: User.id · SQL-Befehl: INSERT",
    );
    expect(setupErrorContext(failure, "en_US")).toContain("SQL line: 8");
    expect(setupErrorContext({ message: "failure" }, "de_DE")).toBe("");
  });
});
