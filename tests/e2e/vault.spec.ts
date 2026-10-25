import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as OTPAuth from "otpauth";
import AxeBuilder from "@axe-core/playwright";
import { languages } from "@nodepass/contracts";
const headings = [
  "Konten",
  "Accounts",
  "Cuentas",
  "Comptes",
  "Fiókok",
  "Comptes",
  "Konta",
  "Учётные записи",
  "Accounts",
  "Contas",
  "Account",
  "Konti",
  "Kontur",
  "アカウント",
];
test("fresh setup, MFA, accounts, themes, responsive layout and passwordless passkeys", async ({
  page,
  context,
}) => {
  const secrets = JSON.parse(readFileSync(".cache/browser.json", "utf8")),
    foreign: string[] = [],
    errors: string[] = [];
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      new URL(r.url()).origin !== "http://localhost:3100"
    )
      foreign.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Dein Tresor beginnt hier." }),
  ).toBeVisible();
  const accessible = async () => {
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    const builder = new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
    ]);
    // Audit the active dialog separately from the deliberately dimmed background.
    if (await page.getByRole("dialog").isVisible())
      builder.include('[role="dialog"]');
    const result = await builder.analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  };
  await accessible();
  const form = page.locator(".auth-card form"),
    inputs = form.locator("input");
  await inputs.nth(0).fill(secrets.setupToken);
  await inputs.nth(1).fill("Vault Administrator");
  await inputs.nth(2).fill("admin");
  await inputs.nth(3).fill(secrets.password);
  await form
    .getByRole("button", { name: "Neu installieren", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Anmeldeschutz" }),
  ).toBeVisible();
  const started = page.waitForResponse((r) =>
    r.url().endsWith("/auth/totp/start"),
  );
  await page
    .getByRole("button", { name: "Authenticator-App", exact: true })
    .click();
  const factor = await (await started).json();
  expect(factor.qr).toMatch(/^data:image\/png;base64,/);
  await page
    .locator(".auth-card form input")
    .fill(new OTPAuth.TOTP({ secret: factor.secret }).generate());
  await page.getByRole("button", { name: "Bestätigen", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  for (const name of [
    "Infrastructure",
    "Design workspace",
    "Team communications",
    "Production database",
    "Customer portal",
    "Cloud console",
  ]) {
    await page
      .locator(".page-heading")
      .getByRole("button", { name: "Neues Konto", exact: true })
      .click();
    const modal = page.locator(".account-modal");
    await modal.locator("input").nth(0).fill(name);
    await modal.locator("input").nth(1).fill("operations@example.invalid");
    await modal.locator("input").nth(3).fill("synthetic vault secret");
    if (name === "Infrastructure") {
      await modal.getByRole("textbox", { name: "Name", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        modal.getByRole("textbox", { name: "Benutzername", exact: true }),
      ).toBeFocused();
      await accessible();
    }
    await modal.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(modal).not.toBeVisible();
  }
  await expect(page.locator(".account-card")).toHaveCount(6);
  await page
    .getByRole("textbox", { name: "Konten durchsuchen …", exact: true })
    .fill("Cloud");
  await expect(page.locator(".account-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await expect(page.locator(".n-data-table")).toContainText("Cloud console");
  await page.getByRole("button", { name: "Karten", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Konten durchsuchen …", exact: true }),
  ).toHaveValue("Cloud");
  await page
    .getByRole("textbox", { name: "Konten durchsuchen …", exact: true })
    .fill("");
  await expect(page.locator(".account-card")).toHaveCount(6);
  await page.screenshot({
    path: "output/playwright/accounts-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await expect(page.locator(".n-data-table")).toBeVisible();
  await page.getByRole("button", { name: "Karten", exact: true }).click();
  await page.getByRole("button", { name: "Dunkel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await accessible();
  await page.screenshot({
    path: "output/playwright/accounts-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/accounts-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const virtual = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const session = await (await page.request.get("/api/v1/auth/session")).json();
  const headers = {
    origin: "http://localhost:3100",
    "x-csrf-token": session.csrf,
  };
  const options = await (
    await page.request.post("/api/v1/auth/passkey/register-options", {
      headers,
      data: {},
    })
  ).json();
  const credential = await page.evaluate(async (options) => {
    const c = (await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
    })) as PublicKeyCredential;
    return c.toJSON();
  }, options.options);
  const enrolled = await page.request.post("/api/v1/auth/passkey/register", {
    headers,
    data: {
      challenge: options.challenge,
      response: credential,
      name: "Virtual test passkey",
    },
  });
  expect(enrolled.ok(), await enrolled.text()).toBe(true);
  for (const invalid of ["origin", "rp", "uv"]) {
    const pending = await (
      await page.request.post("/api/v1/auth/passkey/login-options", {
        headers: { origin: "http://localhost:3100" },
        data: {},
      })
    ).json();
    if (invalid === "uv")
      await cdp.send("WebAuthn.setUserVerified", {
        authenticatorId: virtual.authenticatorId,
        isUserVerified: false,
      });
    const assertion = (await page.evaluate(async (options) => {
      const credential = (await navigator.credentials.get({
        publicKey: PublicKeyCredential.parseRequestOptionsFromJSON({
          ...options,
          userVerification: "discouraged",
        }),
      })) as PublicKeyCredential;
      return credential.toJSON();
    }, pending.options)) as any;
    if (invalid === "origin") {
      const data = JSON.parse(
        Buffer.from(assertion.response.clientDataJSON, "base64url").toString(),
      );
      data.origin = "https://untrusted.example.test";
      assertion.response.clientDataJSON = Buffer.from(
        JSON.stringify(data),
      ).toString("base64url");
    }
    if (invalid === "rp") {
      const data = Buffer.from(
        assertion.response.authenticatorData,
        "base64url",
      );
      data[0] ^= 1;
      assertion.response.authenticatorData = data.toString("base64url");
    }
    const response = await page.request.post("/api/v1/auth/passkey/login", {
      headers: { origin: "http://localhost:3100" },
      data: { challenge: pending.challenge, response: assertion },
    });
    expect(response.status(), invalid).toBe(401);
    expect(
      (
        await page.request.post("/api/v1/auth/passkey/login", {
          headers: { origin: "http://localhost:3100" },
          data: { challenge: pending.challenge, response: assertion },
        })
      ).status(),
    ).toBe(401);
    if (invalid === "uv")
      await cdp.send("WebAuthn.setUserVerified", {
        authenticatorId: virtual.authenticatorId,
        isUserVerified: true,
      });
  }
  await page.reload();
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Willkommen zurück." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mit Passkey anmelden", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const current = await (await page.request.get("/api/v1/auth/session")).json();
  const currentHeaders = () => ({
    origin: "http://localhost:3100",
    "x-csrf-token": current.csrf,
  });
  for (const [index, locale] of languages.entries()) {
    const changed = await page.request.patch("/api/v1/preferences", {
      headers: currentHeaders(),
      data: { lang: locale },
    });
    expect(changed.ok()).toBe(true);
    await page.reload();
    await expect(page.locator("main h1")).toHaveText(
      new RegExp("^" + headings[index] + "[0-9]+$"),
    );
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      locale.split("_")[0]!,
    );
  }
  await page.request.patch("/api/v1/preferences", {
    headers: currentHeaders(),
    data: { lang: "de_DE" },
  });
  await page.reload();
  const fieldResponse = await page.request.post("/api/v1/fields", {
    headers: currentHeaders(),
    data: {
      name: "Location",
      moduleId: 1,
      typeId: 1,
      isEncrypted: false,
      required: false,
      showInList: true,
    },
  });
  expect(fieldResponse.ok(), await fieldResponse.text()).toBe(true);
  await page
    .getByRole("button", { name: "Infrastructure", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zusatzfelder", exact: true })
    .focus();
  await page.keyboard.press("Space");
  const editor = page.locator(".custom-fields");
  await editor
    .getByRole("button", { name: "Bearbeiten · Location", exact: true })
    .click();
  await editor
    .getByRole("textbox", { name: "Location", exact: true })
    .fill("Rack A");
  const savedField = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      /\/fields\/\d+$/.test(response.url()),
  );
  await editor
    .getByRole("button", { name: "Speichern · Location", exact: true })
    .click();
  expect((await savedField).ok()).toBe(true);
  await page.goto("/");
  await expect(
    page.locator(".account-card").filter({ hasText: "Infrastructure" }),
  ).toContainText("Rack A");
  for (const section of [
    "settings",
    "manage/users",
    "manage/security",
    "manage/presets",
    "manage/integrations",
    "manage/transfer",
    "manage/tokens",
    "manage/fields",
  ]) {
    await page.goto("/" + section);
    await expect(page.locator("main h1")).toBeVisible();
    await accessible();
  }
  await page.goto("/");
  const codes = await page.request.post("/api/v1/auth/recovery", {
    headers: currentHeaders(),
    data: {},
  });
  expect(codes.ok()).toBe(true);
  const recovery = (await codes.json()).codes[0];
  await page.getByRole("button", { name: "Abmelden", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Benutzername", exact: true })
    .fill("admin");
  await page.getByLabel("Passwort", { exact: true }).fill(secrets.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page
    .getByRole("button", { name: "Wiederherstellungscodes", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Wiederherstellungscodes", exact: true })
    .fill(recovery);
  await page.getByRole("button", { name: "Bestätigen", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});
