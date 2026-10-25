import type { Row } from "../db.js";
import { SetupInputError, dumpOperations } from "./errors.js";
export interface ImportedTable {
  table: string;
  rows: Row[];
}
interface DumpColumn {
  name: string;
  type?: string;
}
/** Restricted mysqldump data decoder; no supplied SQL is ever sent to MySQL. */
export function decodeDump(
  source: string,
  schema: Record<string, DumpColumn[]>,
): ImportedTable[] {
  if (Buffer.byteLength(source) > 64 * 1024 * 1024)
    throw new SetupInputError(
      "DUMP_SIZE",
      "The SQL dump exceeds the 64 MiB upload limit. Use direct database migration for larger databases.",
    );
  let at = 0;
  let currentTable: string | undefined;
  let currentRow: number | undefined;
  let currentOperation: string | undefined;
  const fail: (code: string, message: string) => never = (code, message) => {
    let line = 1;
    for (let i = 0; i < at; i++) if (source.charCodeAt(i) === 10) line++;
    throw new SetupInputError(code, message, {
      line,
      ...(currentOperation ? { operation: currentOperation } : {}),
      ...(currentTable ? { table: currentTable } : {}),
      ...(currentRow ? { row: currentRow } : {}),
    });
  };
  const invalidText = source.search(/[\0\ufffd]/);
  if (invalidText >= 0) {
    at = invalidText;
    fail(
      "DUMP_ENCODING",
      "The dump contains binary or invalid UTF-8 text. Export again with --default-character-set=utf8mb4 --hex-blob; binary data must be encoded as hex.",
    );
  }
  const results = new Map<string, Row[]>();
  const skip = (): void => {
    while (at < source.length) {
      if (/\s/.test(source[at]!)) {
        at++;
        continue;
      }
      if (source.startsWith("--", at) && /\s/.test(source[at + 2] ?? " ")) {
        const end = source.indexOf("\n", at);
        at = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source.startsWith("/*", at)) {
        const end = source.indexOf("*/", at + 2);
        if (end < 0)
          fail(
            "DUMP_SYNTAX",
            "Unclosed SQL comment. The export may be incomplete.",
          );
        const comment = source.slice(at + 2, end);
        if (
          /^(?:!|M!)/.test(comment) &&
          /\b(?:TRIGGER|PROCEDURE|FUNCTION|EVENT|GRANT|OUTFILE|INFILE)\b/i.test(
            comment,
          )
        )
          fail(
            "DUMP_OPERATION",
            "Executable routines in dumps are not supported. Export without routines, triggers or events.",
          );
        at = end + 2;
        continue;
      }
      break;
    }
  };
  const match = (expression: RegExp): string => {
    skip();
    const m = expression.exec(source.slice(at));
    if (!m)
      fail(
        "DUMP_SYNTAX",
        "Unsupported SQL syntax. Use an uncompressed SQL database export with literal INSERT INTO ... VALUES statements.",
      );
    at += m[0].length;
    return m[0];
  };
  const ident = (): string =>
    match(/^(?:`[A-Za-z_][A-Za-z0-9_]*`|[A-Za-z_][A-Za-z0-9_]*)/).replaceAll(
      "`",
      "",
    );
  const take = (expression: RegExp): string | undefined => {
    skip();
    const found = expression.exec(source.slice(at));
    if (!found) return undefined;
    at += found[0].length;
    return found[0];
  };
  const metadataFailure = (): never =>
    fail(
      "DUMP_ALTER",
      "Unsupported ALTER TABLE metadata. Only index and foreign-key declarations, key toggles and matching AUTO_INCREMENT declarations are supported. nodePass uses its bundled schema.",
    );
  const knownTable = (): string => {
    const table = ident();
    if (!Object.hasOwn(schema, table))
      fail(
        "DUMP_TABLE",
        "Unknown metadata table. Only original sysPass tables are supported.",
      );
    return table;
  };
  const columnList = (table: string, index = false): string[] => {
    const columns: string[] = [];
    match(/^\(/);
    do {
      const column = ident();
      if (
        !schema[table]!.some((item) => item.name === column) ||
        columns.includes(column)
      )
        fail(
          "DUMP_COLUMNS",
          "Unknown or duplicate metadata column. Check the sysPass database schema.",
        );
      columns.push(column);
      if (index) {
        take(/^\(\s*[1-9]\d{0,8}\s*\)/);
        take(/^(?:ASC|DESC)\b/i);
      }
    } while (take(/^,/));
    match(/^\)/);
    return columns;
  };
  const indexMethod = (): void => {
    if (take(/^USING\b/i)) match(/^(?:BTREE|HASH)\b/i);
  };
  const autoId = (table: string): DumpColumn => {
    const column = schema[table]!.find((item) => item.name === "id");
    if (
      !column?.type ||
      !/^(?:tinyint|smallint|mediumint|bigint|int)\b/i.test(column.type)
    )
      metadataFailure();
    return column!;
  };
  const canonicalInteger = (type: string): string =>
    type
      .toLowerCase()
      .replace(/\(\s*\d+\s*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const alterClause = (table: string): void => {
    if (take(/^ADD\b/i)) {
      const constraint = take(/^CONSTRAINT\b/i);
      if (constraint || take(/^FOREIGN\b/i)) {
        if (constraint) {
          if (!take(/^FOREIGN\b/i)) {
            ident();
            match(/^FOREIGN\b/i);
          }
        }
        match(/^KEY\b/i);
        skip();
        if (source[at] !== "(") ident();
        const columns = columnList(table);
        match(/^REFERENCES\b/i);
        const parent = knownTable(),
          references = columnList(parent);
        if (columns.length !== references.length) metadataFailure();
        const actions = new Set<string>();
        while (take(/^ON\b/i)) {
          const action = match(/^(?:DELETE|UPDATE)\b/i).toUpperCase();
          if (actions.has(action)) metadataFailure();
          actions.add(action);
          match(/^(?:RESTRICT|CASCADE|SET\s+NULL|NO\s+ACTION)\b/i);
        }
      } else {
        if (take(/^PRIMARY\b/i)) match(/^KEY\b/i);
        else {
          take(/^UNIQUE\b/i);
          if (!take(/^(?:KEY|INDEX)\b/i)) metadataFailure();
          skip();
          if (source[at] !== "(" && !/^USING\b/i.test(source.slice(at)))
            ident();
        }
        indexMethod();
        columnList(table, true);
        indexMethod();
      }
      return;
    }
    if (take(/^(?:ENABLE|DISABLE)\b/i)) {
      match(/^KEYS\b/i);
      return;
    }
    if (take(/^AUTO_INCREMENT\b/i)) {
      autoId(table);
      take(/^=/);
      const value = Number(match(/^\d+\b/));
      if (!Number.isSafeInteger(value)) metadataFailure();
      return;
    }
    if (take(/^MODIFY\b/i)) {
      take(/^COLUMN\b/i);
      const column = ident(),
        expected = autoId(table);
      const type =
        match(
          /^(?:tinyint|smallint|mediumint|bigint|int)\b(?:\s*\(\s*\d{1,3}\s*\))?/i,
        ) + (take(/^UNSIGNED\b/i) ? " unsigned" : "");
      if (
        column !== "id" ||
        canonicalInteger(type) !== canonicalInteger(expected.type!)
      )
        metadataFailure();
      match(/^NOT\s+NULL\b/i);
      match(/^AUTO_INCREMENT\b/i);
      return;
    }
    metadataFailure();
  };
  const value = (): unknown => {
    skip();
    if (source[at] === "'") {
      at++;
      let out = "";
      let closed = false;
      while (at < source.length) {
        const c = source[at++]!;
        if (c === "'") {
          if (source[at] === "'") {
            out += "'";
            at++;
          } else {
            closed = true;
            break;
          }
        } else if (c === "\\") {
          const c2 = source[at++];
          if (c2 === undefined)
            fail(
              "DUMP_SYNTAX",
              "Invalid SQL escape. The export may be incomplete.",
            );
          const escaped: Record<string, string> = {
            "0": "\0",
            n: "\n",
            r: "\r",
            t: "\t",
            b: "\b",
            Z: "\x1a",
          };
          out += escaped[c2] ?? c2;
        } else out += c;
      }
      if (!closed)
        fail(
          "DUMP_SYNTAX",
          "Unclosed SQL value. The export may be incomplete.",
        );
      return out;
    }
    if (/^0x/i.test(source.slice(at, at + 2))) {
      const v = match(/^0x[0-9a-f]+/i).slice(2);
      if (v.length % 2)
        fail(
          "DUMP_HEX",
          "Invalid SQL hex value. Export again with --hex-blob.",
        );
      return Buffer.from(v, "hex");
    }
    if (/^null\b/i.test(source.slice(at))) {
      at += 4;
      return null;
    }
    const n = match(/^-?\d+(?:\.\d+)?/);
    if (!Number.isFinite(Number(n))) fail("DUMP_SYNTAX", "Invalid SQL number.");
    return Number(n);
  };
  const discardStatement = (): void => {
    let quote = "";
    while (at < source.length) {
      const c = source[at++]!;
      if (quote) {
        if (c === "\\") {
          at++;
        } else if (c === quote) {
          if (source[at] === quote) at++;
          else quote = "";
        }
      } else if (c === "'" || c === '"' || c === "`") quote = c;
      else if (c === ";") return;
    }
    if (quote)
      fail(
        "DUMP_SYNTAX",
        "Unclosed SQL statement. The export may be incomplete.",
      );
  };
  while (at < source.length) {
    currentOperation = undefined;
    skip();
    if (source[at] === ";") {
      at++;
      continue;
    }
    if (at >= source.length) break;
    currentTable = undefined;
    currentRow = undefined;
    const keyword = match(/^[a-z]+/i).toUpperCase();
    currentOperation = dumpOperations.has(keyword) ? keyword : "UNKNOWN";
    // Export transaction wrappers are replaced by importDump's own transaction.
    // Parse their complete form: never discard arbitrary text after START/COMMIT.
    if (keyword === "START" || keyword === "BEGIN" || keyword === "COMMIT") {
      if (keyword === "START") match(/^TRANSACTION\b/i);
      else {
        skip();
        if (/^WORK\b/i.test(source.slice(at))) match(/^WORK\b/i);
      }
      match(/^;/);
      continue;
    }
    if (["SET", "LOCK", "UNLOCK", "USE"].includes(keyword)) {
      discardStatement();
      continue;
    }
    if (keyword === "ALTER") {
      match(/^TABLE\b/i);
      const table = knownTable();
      currentTable = table;
      // phpMyAdmin emits indexes, foreign keys and AUTO_INCREMENT after the rows.
      // Parse each entire clause; use the bundled schema rather than executing it.
      do {
        alterClause(table);
      } while (take(/^,/));
      match(/^;/);
      continue;
    }
    if (keyword === "DROP") {
      match(/^\s*(?:TABLE|VIEW)\s+/i);
      match(/^IF\s+EXISTS\s+/i);
      const name = ident();
      if (
        !Object.hasOwn(schema, name) &&
        !["account_data_v", "account_search_v"].includes(name)
      )
        fail(
          "DUMP_TABLE",
          "Unknown dump table. Only the original sysPass 3.2.11 tables and views are supported.",
        );
      match(/^;/);
      continue;
    }
    if (keyword === "CREATE") {
      skip();
      // sysPass FileBackupService and mysqldump emit source database metadata.
      // Ignore it: the configured target database and bundled schema always win.
      if (/^DATABASE\b/i.test(source.slice(at))) {
        discardStatement();
        continue;
      }
      const metadataName =
        /^(?:TABLE\s+|(?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*(?:`[^`]*`|'[^']*'|[\w.-]+)\s*@\s*(?:`[^`]*`|'[^']*'|[\w.%:-]+)\s+)?(?:SQL\s+SECURITY\s+(?:DEFINER|INVOKER)\s+)?VIEW\s+)/i;
      const metadata = match(metadataName);
      const name = ident();
      if (
        (/VIEW\s+$/i.test(metadata) &&
          !["account_data_v", "account_search_v"].includes(name)) ||
        (!Object.hasOwn(schema, name) &&
          !["account_data_v", "account_search_v"].includes(name))
      )
        fail(
          "DUMP_TABLE",
          "Unknown dump table or view. Only the original sysPass 3.2.11 schema is supported.",
        );
      discardStatement();
      continue;
    }
    if (keyword !== "INSERT")
      fail(
        "DUMP_OPERATION",
        "Unsupported SQL operation. Known export metadata is skipped; data-changing and unknown statements cannot be silently omitted.",
      );
    match(/^\s*INTO\s+/i);
    const table = ident();
    const definition = Object.hasOwn(schema, table) ? schema[table] : undefined;
    if (!definition)
      fail(
        "DUMP_TABLE",
        "Unknown dump table. Only the original sysPass 3.2.11 tables are supported.",
      );
    currentTable = table;
    skip();
    const columns: string[] = [];
    if (source[at] === "(") {
      at++;
      while (true) {
        columns.push(ident());
        skip();
        if (source[at++] === ")") break;
        if (source[at - 1] !== ",")
          fail(
            "DUMP_COLUMNS",
            "Invalid SQL columns. Use a complete sysPass SQL export.",
          );
      }
    } else columns.push(...definition.map((c) => c.name));
    if (
      new Set(columns).size !== columns.length ||
      columns.some((c) => !definition.some((d) => d.name === c))
    )
      fail(
        "DUMP_COLUMNS",
        "Unknown or duplicate SQL column. Check that the dump uses the sysPass 3.2.11 schema.",
      );
    match(/^VALUES\s*/i);
    const rows = results.get(table) ?? [];
    results.set(table, rows);
    while (true) {
      currentRow = rows.length + 1;
      match(/^\(/);
      const row: Row = Object.create(null) as Row;
      for (let i = 0; i < columns.length; i++) {
        row[columns[i]!] = value();
        skip();
        match(i === columns.length - 1 ? /^\)/ : /^,/);
      }
      rows.push(row);
      if (rows.length > 200000)
        fail(
          "DUMP_ROWS",
          "Dump row limit exceeded (200000 per table). Use direct database migration for larger databases.",
        );
      skip();
      if (source[at] === ",") {
        at++;
        continue;
      }
      match(/^;/);
      break;
    }
  }
  return [...results].map(([table, rows]) => ({ table, rows }));
}
