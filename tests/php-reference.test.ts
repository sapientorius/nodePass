import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { decryptDefuse } from "../packages/server/src/compat/defuse.js";
import { readAuthenticator } from "../packages/server/src/compat/authenticator.js";
import { verifyPassword } from "../packages/server/src/security/password.js";
import { phpMap } from "../packages/server/src/compat/php.js";
import { createHash } from "node:crypto";
const stored = JSON.parse(
  readFileSync(new URL("fixtures/reference.json", import.meta.url), "utf8"),
);
const generated =
  process.env.NODEPASS_PHP_REFERENCE ?? ".cache/php-reference.json";
if (
  process.env.NODEPASS_REQUIRE_PHP_REFERENCE === "1" &&
  !existsSync(generated)
)
  throw new Error("Mandatory independent PHP reference generation is missing");
const sources = existsSync(generated)
  ? [stored, JSON.parse(readFileSync(generated, "utf8"))]
  : [stored];
describe.each(sources)(
  "independent PHP 8.4 / Defuse 2.3.1 vectors",
  (reference) => {
    it.each(reference.hashes as { password: string; hash: string }[])(
      "matches PHP bcrypt byte and Unicode behavior ($password)",
      async ({ password, hash }) => {
        expect(await verifyPassword(password, hash)).toBe(true);
        expect(await verifyPassword("incorrect-" + password, hash)).toBe(false);
      },
    );
    it("decrypts binary and Unicode data", async () =>
      expect(
        (
          await decryptDefuse(
            reference.secret.pass,
            reference.secret.key,
            reference.master,
          )
        ).toString(),
      ).toBe("日本語\0secret"));
    it("reads the official Authenticator 2.2 serialized fields and recovery codes", async () => {
      expect(
        await readAuthenticator(
          Buffer.from(reference.plugin.pass),
          Buffer.from(reference.plugin.key),
          reference.master,
          1,
        ),
      ).toEqual({
        userId: 1,
        enabled: true,
        secret: "JBSWY3DPEHPK3PXP",
        recoveryCodes: ["synthetic-recovery-code-1"],
      });
      await expect(
        readAuthenticator(
          Buffer.from(reference.plugin.pass),
          Buffer.from(reference.plugin.key),
          reference.master,
          2,
        ),
      ).rejects.toThrow();
    });
    it("decrypts the protected PHP public-link vault", async () => {
      const outer = phpMap(
          Buffer.from(reference.publicLink.serialized, "base64"),
        ),
        password = createHash("sha1")
          .update(reference.publicLink.salt + reference.publicLink.hash)
          .digest("hex");
      const clear = await decryptDefuse(
        String(outer.data),
        String(outer.key),
        password,
      );
      expect(phpMap(clear)).toEqual(reference.publicLink.expected);
    });
  },
);
