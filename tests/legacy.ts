import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import {
  createBaseline,
  type Database,
  type Row,
} from "../packages/server/src/db.js";
export const legacyReference = JSON.parse(
  readFileSync(new URL("fixtures/reference.json", import.meta.url), "utf8"),
);

export async function seedLegacy(db: Database): Promise<void> {
  const reference = legacyReference;
  await createBaseline(db);
  await db("UserGroup").insert({ id: 1, name: "Test group" });
  await db("UserProfile").insert({
    id: 1,
    name: "Test profile",
    profile: 'NPJ1:{"accView":true,"accViewPass":true}',
  });
  await db("User").insert({
    id: 1,
    name: "Test admin",
    login: "admin",
    pass: reference.hashes[1].hash,
    hashSalt: randomBytes(20),
    userGroupId: 1,
    userProfileId: 1,
    isAdminApp: 1,
    isAdminAcc: 1,
    mPass: "obsolete master wrapper",
    mKey: "obsolete key wrapper",
  });
  await db("Category").insert({
    id: 1,
    name: "Test category",
    hash: "synthetic-category-hash",
  });
  await db("Client").insert({
    id: 1,
    name: "Test client",
    hash: "synthetic-client-hash",
  });
  await db("UserGroup").insert({ id: 2, name: "Second group" });
  await db("User").insert({
    id: 2,
    name: "Second user",
    login: "second",
    pass: reference.hashes[1].hash,
    hashSalt: randomBytes(20),
    userGroupId: 2,
    userProfileId: 1,
  });
  await db("Category").insert({
    id: 2,
    name: "Second category",
    hash: "synthetic-category-2",
  });
  await db("Client").insert({
    id: 2,
    name: "Second client",
    hash: "synthetic-client-2",
  });
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
  }).parse(
    readFileSync(
      new URL("fixtures/syspass-account-crypt.xml", import.meta.url),
      "utf8",
    ),
  );
  for (const table of parsed.mysqldump.database.table_data) {
    if (
      !["Account", "AccountHistory", "CustomFieldData", "Config"].includes(
        table["@name"],
      )
    )
      continue;
    for (const row of Array.isArray(table.row) ? table.row : [table.row]) {
      const data: Row = {};
      for (const field of row.field) {
        const name = field["@name"] === "VALUE" ? "value" : field["@name"];
        data[name] =
          field["@xsi:nil"] === "true"
            ? null
            : field["@xsi:type"] === "xs:hexBinary"
              ? Buffer.from(field["#text"] ?? "", "hex")
              : (field["#text"] ?? "");
      }
      if (table["@name"] === "CustomFieldData") {
        if (Number(data.id) !== 1) continue;
        await db("CustomFieldType").insert({
          id: 1,
          name: "text",
          text: "Text",
        });
        await db("CustomFieldDefinition").insert({
          id: 1,
          name: "Test encrypted field",
          moduleId: 10,
          typeId: 1,
          isEncrypted: 1,
        });
      }
      await db(table["@name"]).insert(data);
    }
  }
  await db("AccountFile").insert({
    id: 1,
    accountId: 1,
    name: "synthetic.txt",
    type: "text/plain",
    size: 18,
    extension: "txt",
    content: Buffer.from("synthetic contents"),
    thumb: null,
  });
  await db("PublicLink").insert({
    id: 1,
    itemId: 1,
    hash: reference.publicLink.hash,
    data: Buffer.from(reference.publicLink.serialized, "base64"),
    userId: 1,
    typeId: 1,
    dateAdd: 1,
    dateExpire: Math.floor(Date.now() / 1000) + 3600,
    maxCountViews: 2,
  });
  await db("Plugin").insert({
    name: "Authenticator",
    enabled: 1,
    versionLevel: "2.2",
  });
  await db("PluginData").insert({
    name: "Authenticator",
    itemId: 1,
    data: reference.plugin.pass,
    key: reference.plugin.key,
  });
  await db("Account")
    .where({ id: 1 })
    .update({ userId: 1, userGroupId: 1, isPrivate: 0, isPrivateGroup: 0 });
  await db("Account")
    .where({ id: 2 })
    .update({ userId: 1, userGroupId: 1, isPrivate: 1, isPrivateGroup: 0 });
  await db("AccountToUser").insert({ accountId: 1, userId: 2, isEdit: 0 });
  await db("AccountToUserGroup").insert({
    accountId: 1,
    userGroupId: 2,
    isEdit: 1,
  });
  await db("Tag").insert({
    id: 1,
    name: "legacy-ops",
    hash: "synthetic-legacy-tag",
  });
  await db("AccountToTag").insert({ accountId: 1, tagId: 1 });
  await db("AuthToken").insert({
    id: 1,
    userId: 1,
    createdBy: 1,
    actionId: 7,
    startDate: 1,
    token: "synthetic-legacy-auth-token",
    hash: reference.hashes[1].hash,
    vault: "obsolete API key wrapper",
  });
}
