import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import { defaultPolicy, languages } from "@nodepass/contracts";
import { checkStrength } from "../packages/server/src/security/password.js";
import { assessPassword } from "../packages/web/src/password-policy.js";
import {
  setupIssues,
  type SetupInput,
} from "../packages/web/src/setup-validation.js";
import { messages } from "../packages/web/src/i18n.js";

const fresh: SetupInput = {
  mode: "fresh",
  setupToken: "test-setup-token",
  name: "Test Administrator",
  login: "admin",
  password: "violet meteor cascade 709c2a4e91!",
  masterPassword: "",
  maintenance: false,
};

describe("setup form validation", () => {
  it("requires every fresh-install field and rejects blank identities", () => {
    expect(setupIssues(fresh)).toEqual({});
    for (const field of ["setupToken", "name", "login", "password"] as const)
      expect(setupIssues({ ...fresh, [field]: "" })[field]?.key).toBe(
        "setupRequiredField",
      );
    for (const field of ["setupToken", "name", "login"] as const)
      expect(setupIssues({ ...fresh, [field]: "   " })[field]?.key).toBe(
        "setupRequiredField",
      );
  });

  it("uses the server's fresh-install identity limits and allowed characters", () => {
    for (const login of ["admin", "Üser.01_test-admin@example", "用戶"])
      expect(setupIssues({ ...fresh, login }).login).toBeUndefined();
    for (const login of ["with space", "admin/one", "<script>", "a".repeat(51)])
      expect(setupIssues({ ...fresh, login }).login).toBeDefined();
    expect(
      setupIssues({ ...fresh, login: "a".repeat(50) }).login,
    ).toBeUndefined();
    expect(
      setupIssues({ ...fresh, name: "n".repeat(80) }).name,
    ).toBeUndefined();
    expect(setupIssues({ ...fresh, name: "n".repeat(81) }).name?.key).toBe(
      "setupMaxLength",
    );
  });

  it("matches server password decisions, including strength and Unicode boundaries", () => {
    const passwords = [
      "",
      "short!",
      "passwordpasswordpassword",
      "R8!tP4@vL7#xQ2",
      "R8!tP4@vL7#xQ2$",
      fresh.password,
      "violet meteor cascade ".repeat(6).slice(0, 128),
      "violet meteor cascade ".repeat(6).slice(0, 129),
      "😀🛰️🌿🧭🎨🪁🌌🦉🪷🍋⚓🦋🚲🛶🎯 ".repeat(8),
      "     " + fresh.password + "     ",
    ];
    for (const password of passwords) {
      let accepted = true;
      try {
        checkStrength(password, defaultPolicy);
      } catch {
        accepted = false;
      }
      expect(assessPassword(password).valid, password).toBe(accepted);
      expect(!setupIssues({ ...fresh, password }).password, password).toBe(
        accepted,
      );
    }
    expect(assessPassword(fresh.password).valid).toBe(true);
    expect(
      assessPassword(fresh.password, { minLength: 50, minScore: 4 }).valid,
    ).toBe(false);
  });

  it("accepts existing sysPass passwords without applying the new strength policy", () => {
    const imported: SetupInput = {
      ...fresh,
      mode: "migrate",
      name: "",
      login: "legacy/admin with spaces",
      password: "a",
      masterPassword: "b",
      maintenance: true,
    };
    expect(setupIssues(imported)).toEqual({});
    expect(setupIssues({ ...imported, password: " " })).toEqual({});
    expect(
      setupIssues({ ...imported, maintenance: false }).maintenance,
    ).toBeDefined();
    expect(
      setupIssues({ ...imported, masterPassword: "" }).masterPassword,
    ).toBeDefined();
    expect(
      setupIssues({ ...imported, login: "a".repeat(100) }).login,
    ).toBeUndefined();
    expect(
      setupIssues({ ...imported, login: "a".repeat(101) }).login,
    ).toBeDefined();
    for (const field of ["password", "masterPassword"] as const) {
      expect(
        setupIssues({ ...imported, [field]: "a".repeat(4096) })[field],
      ).toBeUndefined();
      expect(
        setupIssues({ ...imported, [field]: "a".repeat(4097) })[field]?.key,
      ).toBe("setupMaxLength");
      expect(
        setupIssues({ ...imported, [field]: "ü".repeat(2048) })[field],
      ).toBeUndefined();
      expect(
        setupIssues({ ...imported, [field]: "ü".repeat(2049) })[field]?.key,
      ).toBe("setupMaxBytes");
    }
    expect(setupIssues({ ...imported, mode: "fresh" }).password?.key).toBe(
      "setupPasswordHint",
      "setupLegacyLogin",
      "setupLegacyPassword",
      "setupLegacyCredentialsHelp",
      "setupLegacyImportedHelp",
    );
  });

  it("renders setup copy and validation feedback in every supported language", () => {
    const translatedKeys = [
      "setupHelp",
      "migrate",
      "maintenance",
      "setupMaintenanceHelp",
      "setupRequiredField",
      "setupMaxLength",
      "setupMaxBytes",
      "setupLoginHint",
      "setupPasswordHint",
    ];
    for (const locale of languages) {
      const translator = createI18n({
        legacy: false,
        locale,
        fallbackLocale: false,
        messages,
      });
      for (const key of translatedKeys) {
        const text = translator.global.t(key, {
          max: 80,
          minLength: 15,
          minScore: 3,
        });
        expect(text, `${locale}/${key}`).not.toBe(key);
        expect(text, `${locale}/${key}`).not.toMatch(
          /\{(?:max|minLength|minScore)\}/,
        );
      }
      expect(translator.global.t("setupLoginHint")).toContain("@");
    }
    expect(messages.de_DE?.setupHelp).toBe(
      "Richte nodePass ein oder importiere deine sysPass Daten.",
    );
    expect(messages.de_DE?.migrate).toBe("sysPass importieren");
  });
});
