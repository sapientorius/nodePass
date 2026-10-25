import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeDump } from "../packages/server/src/migration/dump.js";
import { setupFailure } from "../packages/server/src/migration/errors.js";

const schema = JSON.parse(
  readFileSync(
    new URL("../packages/server/resources/schema.json", import.meta.url),
    "utf8",
  ),
);
const tail = readFileSync(
  new URL("fixtures/phpmyadmin-schema-tail.sql", import.meta.url),
  "utf8",
);
const row = "INSERT INTO Account (id,name) VALUES (7,'preserved');";

describe("phpMyAdmin schema metadata", () => {
  it("reads the reported Account index block at line 5195 and the standard metadata tail", () => {
    const source = Array(5192).fill("-- header").join("\n") + "\n" + tail + row;
    expect(source.split("\n")[5194]).toBe("ALTER TABLE `Account`");
    expect(decodeDump(source, schema)).toEqual([
      { table: "Account", rows: [{ id: 7, name: "preserved" }] },
    ]);
  });

  it.each([
    "ADD PRIMARY KEY (`id`)",
    "ADD KEY `idx` (`categoryId`), ADD KEY `compound` (`userGroupId`,`userId`)",
    "ADD INDEX idx (name)",
    "ADD UNIQUE INDEX idx (name)",
    "ADD UNIQUE KEY (name)",
    "ADD KEY (name)",
    "ADD KEY USING BTREE (name)",
    "ADD KEY idx USING HASH (name)",
    "ADD KEY idx (name) USING BTREE",
    "ADD KEY idx (name(20) ASC, login DESC)",
    "ADD /* exporter comment */ KEY idx (name)",
    "ENABLE KEYS",
    "DISABLE KEYS",
    "AUTO_INCREMENT=100",
    "AUTO_INCREMENT 100",
    "MODIFY id mediumint(8) UNSIGNED NOT NULL AUTO_INCREMENT",
    "MODIFY COLUMN id MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=100",
    "ADD CONSTRAINT fk_category FOREIGN KEY (categoryId) REFERENCES Category (id)",
    "ADD CONSTRAINT FOREIGN KEY (categoryId) REFERENCES Category (id)",
    "ADD FOREIGN KEY (categoryId) REFERENCES Category (id)",
    "ADD FOREIGN KEY idx (categoryId) REFERENCES Category (id)",
    "ADD FOREIGN KEY (categoryId) REFERENCES Category (id) ON DELETE CASCADE ON UPDATE RESTRICT",
    "ADD FOREIGN KEY (categoryId) REFERENCES Category (id) ON UPDATE NO ACTION ON DELETE SET NULL",
  ])("skips the complete known metadata clause: %s", (clause) => {
    expect(
      decodeDump(`ALTER TABLE Account ${clause};` + row, schema)[0]!.rows,
    ).toEqual([{ id: 7, name: "preserved" }]);
  });

  it("accepts signed AUTO_INCREMENT types only where they match the bundled column", () => {
    expect(
      decodeDump(
        "ALTER TABLE AccountFile MODIFY id int(11) NOT NULL AUTO_INCREMENT;" +
          row,
        schema,
      )[0]!.rows,
    ).toHaveLength(1);
  });

  it.each([
    "ALTER TABLE Unknown ADD PRIMARY KEY (id);",
    "ALTER TABLE __proto__ ADD PRIMARY KEY (id);",
    "ALTER TABLE account_data_v ADD PRIMARY KEY (id);",
    "ALTER VIEW Account ADD PRIMARY KEY (id);",
    "ALTER TABLE Account ADD KEY idx (unknown);",
    "ALTER TABLE Account ADD KEY idx (name,name);",
    "ALTER TABLE Account ADD KEY idx ((name));",
    "ALTER TABLE Account ADD KEY idx (name + 1);",
    "ALTER TABLE Account ADD KEY idx (name(0));",
    "ALTER TABLE Account ADD KEY idx (name(9999999999));",
    "ALTER TABLE Account ADD KEY idx (name) USING unknown;",
    "ALTER TABLE Account ADD COLUMN secret text;",
    "ALTER TABLE Account ADD FULLTEXT KEY idx (notes);",
    "ALTER TABLE Account DROP COLUMN pass;",
    "ALTER TABLE Account CHANGE id secret int;",
    "ALTER TABLE Account RENAME TO Other;",
    "ALTER TABLE Account ENGINE=MyISAM;",
    "ALTER TABLE Account CONVERT TO CHARACTER SET latin1;",
    "ALTER TABLE Account ADD KEY idx (name), DROP COLUMN pass;",
    "ALTER TABLE Account ADD CONSTRAINT check_data CHECK (id>0);",
    "ALTER TABLE Account ADD FOREIGN KEY (categoryId) REFERENCES Unknown (id);",
    "ALTER TABLE Account ADD FOREIGN KEY (categoryId) REFERENCES Category (unknown);",
    "ALTER TABLE Account ADD FOREIGN KEY (categoryId,userId) REFERENCES Category (id);",
    "ALTER TABLE Account ADD FOREIGN KEY (categoryId) REFERENCES Category (id) ON DELETE CASCADE ON DELETE RESTRICT;",
    "ALTER TABLE Account ADD FOREIGN KEY (categoryId) REFERENCES Category (id) ON DELETE secret;",
    "ALTER TABLE Account MODIFY login int NOT NULL AUTO_INCREMENT;",
    "ALTER TABLE Account MODIFY id bigint unsigned NOT NULL AUTO_INCREMENT;",
    "ALTER TABLE Account MODIFY id mediumint(8) NOT NULL AUTO_INCREMENT;",
    "ALTER TABLE Account MODIFY id mediumint(8) unsigned NULL AUTO_INCREMENT;",
    "ALTER TABLE Account MODIFY id mediumint(8) unsigned NOT NULL;",
    "ALTER TABLE Config AUTO_INCREMENT=100;",
    "ALTER TABLE Account AUTO_INCREMENT=99999999999999999;",
    "ALTER TABLE Account AUTO_INCREMENT=1+1;",
    "ALTER TABLE Account ADD KEY idx (name),;",
    "ALTER TABLE Account ADD KEY idx (name)",
    "ALTER TABLE Account ADD KEY idx (name) UPDATE Account SET name='private-secret';",
  ])(
    "rejects unknown, incomplete or data-changing clauses: %s",
    (statement) => {
      expect(() => decodeDump(row + statement, schema)).toThrow();
    },
  );

  it("requires a known integer id definition for AUTO_INCREMENT metadata", () => {
    for (const columns of [
      [{ name: "id" }],
      [{ name: "id", type: "varchar(10)" }],
    ])
      expect(() =>
        decodeDump("ALTER TABLE Custom AUTO_INCREMENT=10;", {
          Custom: columns,
        }),
      ).toThrow();
  });

  it("retains line, command and known table without reflecting rejected clause values", () => {
    try {
      decodeDump(
        Array(5194).fill("-- header").join("\n") +
          "\nALTER TABLE Account DROP COLUMN private_secret;",
        schema,
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(setupFailure(error)).toMatchObject({
        code: "DUMP_ALTER",
        details: { line: 5195, operation: "ALTER", table: "Account" },
      });
      expect(JSON.stringify(setupFailure(error))).not.toContain(
        "private_secret",
      );
    }
  });

  it("continues decoding after metadata and refuses a following UPDATE", () => {
    try {
      decodeDump(
        tail + row + "\nUPDATE Account SET name='private-secret';",
        schema,
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(setupFailure(error)).toMatchObject({
        code: "DUMP_OPERATION",
        details: { operation: "UPDATE" },
      });
      expect(JSON.stringify(setupFailure(error))).not.toContain(
        "private-secret",
      );
    }
  });
});
