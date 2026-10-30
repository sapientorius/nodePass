import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { XMLBuilder } from "fast-xml-parser";
import { BadRequest } from "@feathersjs/errors";
import { parseImport } from "../packages/server/src/services/transfer.js";
import { encryptDefuse } from "../packages/server/src/compat/defuse.js";

const encryptedSource = readFileSync(
    new URL("fixtures/syspass-export-encrypted.xml", import.meta.url),
    "utf8",
  ),
  plainSource = readFileSync(
    new URL("fixtures/syspass-export.xml", import.meta.url),
    "utf8",
  ),
  exportPassword = "test_encrypt",
  masterPassword = "12345678900";

describe("original sysPass XML export interoperability", () => {
  it("verifies the original encrypted-node hash and separately unlocks account passwords", async () => {
    const entries = await parseImport(
      "syspass",
      encryptedSource,
      exportPassword,
      masterPassword,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: "Amazon SES",
      login: "admin",
      category: "AWS",
      client: "Amazon",
      tags: ["Email"],
      password: "-zVu78~=0ub·",
    });
    expect(entries[1]).toMatchObject({
      name: "Google GCP",
      password: "c1E;Co%t=¿r_",
    });
  });

  it("unlocks account passwords in an unencrypted original export", async () => {
    const entries = await parseImport(
      "syspass",
      plainSource,
      "",
      masterPassword,
    );
    expect(entries).toHaveLength(5);
    expect(entries.find((e) => e.name === "Test CSV 1")?.password).toBe(
      "csv_pass1",
    );
    // Preserve the old single-password API for files without outer encryption.
    expect(await parseImport("syspass", plainSource, masterPassword)).toEqual(
      entries,
    );
  });

  it.each(["", "wrong"])(
    "rejects an absent/wrong export password (%s)",
    async (password) => {
      await expect(
        parseImport("syspass", encryptedSource, password, masterPassword),
      ).rejects.toMatchObject({
        code: 400,
        message: expect.stringMatching(/export password/i),
      });
    },
  );

  it.each(["", "wrong"])(
    "reports an absent/wrong master password without a server error (%s)",
    async (master) => {
      await expect(
        parseImport("syspass", encryptedSource, exportPassword, master),
      ).rejects.toMatchObject({
        code: 400,
        message: expect.stringContaining("sysPass master password"),
      });
    },
  );

  it("requires the original master password for account ciphertext in unencrypted XML", async () => {
    await expect(parseImport("syspass", plainSource)).rejects.toMatchObject({
      code: 400,
      message: "Original sysPass master password required",
    });
    await expect(
      parseImport("syspass", plainSource, "wrong"),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it.each([
    (source: string) =>
      source.replace(
        /(<Hash[^>]*>)([a-f0-9])/,
        (_, prefix, digit) => prefix + (digit === "0" ? "1" : "0"),
      ),
    (source: string) =>
      source.replace(
        /(sign=")([a-f0-9])/,
        (_, prefix, digit) => prefix + (digit === "0" ? "1" : "0"),
      ),
    (source: string) => source.replace(/(<Data[^>]*>)[A-Za-z0-9]/, "$1!"),
    (source: string) => source.replace(/(<Data key=")[a-f0-9]+/, "$1invalid"),
  ])(
    "rejects damaged digests, signatures, ciphertext and keys",
    async (damage) => {
      const damaged = damage(encryptedSource);
      expect(damaged).not.toBe(encryptedSource);
      await expect(
        parseImport("syspass", damaged, exportPassword, masterPassword),
      ).rejects.toBeInstanceOf(BadRequest);
    },
  );

  it("rejects unsigned plaintext sections alongside encrypted data", async () => {
    const source = encryptedSource.replace(
      "</Root>",
      "<Accounts><Account><name>Injected</name><pass>unsigned</pass></Account></Accounts></Root>",
    );
    await expect(
      parseImport("syspass", source, exportPassword, masterPassword),
    ).rejects.toMatchObject({
      code: 400,
      message: "Unexpected unencrypted XML section",
    });
  });

  it.each([0, 5])(
    "rejects an invalid number of encrypted chunks (%s)",
    async (count) => {
      const source = `<Root><Meta><Version>3</Version></Meta><Encrypted>${"<Data key='invalid'>invalid</Data>".repeat(count)}</Encrypted></Root>`;
      await expect(
        parseImport("syspass", source, exportPassword),
      ).rejects.toMatchObject({
        code: 400,
        message: "Expected 1 to 4 encrypted XML sections",
      });
    },
  );

  it.each([42, {}, "x".repeat(4097)])(
    "rejects invalid password inputs before attempting decryption",
    async (password) => {
      await expect(
        parseImport("syspass", encryptedSource, password as string),
      ).rejects.toMatchObject({ code: 400 });
      await expect(
        parseImport(
          "syspass",
          encryptedSource,
          exportPassword,
          password as string,
        ),
      ).rejects.toMatchObject({ code: 400 });
    },
  );

  it("bounds bcrypt work for an attacker-controlled export hash", async () => {
    const source = encryptedSource.replace(/\$2y\$\d\d\$/, "$$2y$$31$$");
    expect(source).not.toBe(encryptedSource);
    await expect(
      parseImport("syspass", source, exportPassword, masterPassword),
    ).rejects.toMatchObject({ code: 400, message: "Wrong export password" });
  });

  it.each([
    { password: exportPassword, prehash: false },
    { password: "a".repeat(80), prehash: false },
    { password: "a".repeat(80), prehash: true },
  ])(
    "accepts authenticated clear-section hashes and both bounded long-password hash conventions",
    async ({ password, prehash }) => {
      const builder = new XMLBuilder({ ignoreAttributes: false }),
        account = await encryptDefuse("synthetic account secret", password),
        section = builder.build({
          Accounts: {
            Account: {
              name: "Early nodePass",
              pass: account.pass,
              key: account.key,
            },
          },
        }),
        encrypted = await encryptDefuse(section, password),
        hash = createHash("sha1").update(section).digest("hex"),
        passwordHash = await bcrypt.hash(
          prehash
            ? createHash("sha256").update(password).digest("hex")
            : password,
          4,
        ),
        source = builder.build({
          Root: {
            Meta: {
              Version: "3211.22070201",
              Hash: {
                "@_sign": createHmac("sha256", password)
                  .update(hash)
                  .digest("hex"),
                "#text": hash,
              },
            },
            Encrypted: {
              "@_hash": passwordHash,
              Data: {
                "@_key": encrypted.key,
                "#text": Buffer.from(encrypted.pass).toString("base64"),
              },
            },
          },
        });
      expect(await parseImport("syspass", source, password)).toMatchObject([
        { name: "Early nodePass", password: "synthetic account secret" },
      ]);
    },
  );
});
