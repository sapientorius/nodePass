import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languageOptions, messages } from "../../packages/web/src/i18n";

test.use({ actionTimeout: 15000 });

const password = "violet meteor cascade 709c2a4e91!";
const maintenance =
  "sysPass ist gestoppt und ich habe eine eigene Sicherung erstellt.";

async function openSetup(page: Page, legacy = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/status", (route) =>
    route.fulfill({ json: { setupRequired: true, legacy, sso: false } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Dein Tresor beginnt hier.",
  );
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
}

test("setup tabs, field feedback, Enter and concurrent submit protection", async ({
  page,
}) => {
  let submissions = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/setup/fresh", async (route) => {
    submissions++;
    await pending;
    await route.fulfill({
      status: 400,
      json: { message: "Test setup stopped" },
    });
  });
  await openSetup(page);
  const form = page.locator("#setup-form");
  const submit = form.getByRole("button", {
    name: "Neu installieren",
    exact: true,
  });
  const fresh = page.getByRole("tab", {
    name: "Neu installieren",
    exact: true,
  });
  const migrate = page.getByRole("tab", {
    name: "sysPass importieren",
    exact: true,
  });
  await expect(fresh).toHaveText("Neu installieren");
  await expect(migrate).toHaveText("sysPass importieren");
  await expect(fresh).toHaveAttribute("aria-selected", "true");
  await expect(submit).toBeDisabled();
  await expect(page.locator(".setup-compatibility")).toHaveCount(0);
  await expect(page.locator(".auth-story")).not.toContainText("Sicherheit");
  await expect(
    page.getByText("Ein sicherer Ort für alles Vertrauliche.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".auth-description")).toHaveText(
    "Richte nodePass ein oder importiere deine sysPass Daten.",
  );
  await fresh.focus();
  await page.keyboard.press("ArrowRight");
  await expect(migrate).toBeFocused();
  await expect(migrate).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByLabel("Bisheriges Master-Passwort", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Home");
  await expect(fresh).toBeFocused();
  await page.keyboard.press("End");
  await expect(migrate).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(fresh).toBeFocused();
  await page.keyboard.press("Space");
  await expect(fresh).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".n-tabs-bar")).toBeVisible();
  await accessible(page);
  await page.getByRole("heading", { level: 1 }).click();
  await page.screenshot({
    path: "output/playwright/setup-fresh-light.png",
    fullPage: true,
  });

  const token = page.getByLabel("Einrichtungstoken", { exact: true });
  const name = page.getByLabel("Name", { exact: true });
  const login = page.getByLabel("Benutzername", { exact: true });
  const secret = page.getByLabel("Passwort", { exact: true });
  await expect(secret).toHaveAttribute("autocomplete", "new-password");
  await expect(login).toHaveAttribute("autocomplete", "username");
  await token.focus();
  await page.keyboard.press("Tab");
  await expect(token).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#setup-setupToken-feedback")).toHaveText(
    "Bitte ausfüllen.",
  );
  await token.fill("synthetic-test-token");
  await name.fill("Test Administrator");
  await login.fill("invalid username");
  await secret.fill(password);
  await expect(login).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();
  await secret.press("Enter");
  await form.dispatchEvent("submit");
  expect(submissions).toBe(0);
  await login.fill("admin");
  await secret.fill("weak");
  await expect(submit).toBeDisabled();
  await expect(page.locator("#setup-password-feedback")).toContainText(
    "Mindestens 15 Zeichen und Stärke 3/4",
  );
  await accessible(page);
  await name.fill("n".repeat(81));
  await expect(page.locator("#setup-name-feedback")).toHaveText(
    "Höchstens 80 Zeichen.",
  );
  await name.fill("Test Administrator");
  await secret.fill(password);
  await expect(submit).toBeEnabled();
  await secret.fill(password.repeat(5));
  await expect(submit).toBeDisabled();
  await secret.fill(password);
  await expect(submit).toBeEnabled();
  try {
    await secret.press("Enter");
    await expect.poll(() => submissions).toBe(1);
    await expect(submit).toBeDisabled();
    await expect(token).toBeDisabled();
    await form.dispatchEvent("submit");
    await migrate.click({ force: true });
    await expect(fresh).toHaveAttribute("aria-selected", "true");
    expect(submissions).toBe(1);
  } finally {
    release();
  }
  await expect(
    page.getByText("Test setup stopped", { exact: true }),
  ).toBeVisible();
  await expect(submit).toBeEnabled();
});

test("existing sysPass passwords and the migration confirmation", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/v1/setup/**", (route) => {
    requests++;
    return route.fulfill({
      status: 400,
      json: { message: "Test preflight stopped" },
    });
  });
  await openSetup(page, true);
  await expect(
    page.getByRole("tab", { name: "sysPass importieren", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const submit = page
    .locator("#setup-form")
    .getByRole("button", { name: "sysPass importieren", exact: true });
  const checkbox = page.getByRole("checkbox", {
    name: maintenance,
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await expect(checkbox).toHaveAttribute(
    "aria-describedby",
    "setup-maintenance-help",
  );
  await expect(page.locator("#setup-maintenance-help")).toContainText(
    "nicht gleichzeitig in dieselbe Datenbank schreiben",
  );
  await accessible(page);
  await page.screenshot({
    path: "output/playwright/setup-import-light.png",
    fullPage: true,
  });
  await page
    .getByLabel("Einrichtungstoken", { exact: true })
    .fill("synthetic-test-token");
  await expect(page.locator("#setup-legacy-credentials-help")).toContainText(
    "bestehenden lokalen sysPass-Anwendungsadministrator",
  );
  await expect(page.locator(".setup-imported")).toContainText(
    "Ein weiterer SQL-Import ist nicht erforderlich",
  );
  await expect(page.locator('input[type="file"][accept=".sql"]')).toHaveCount(
    0,
  );
  await page
    .getByLabel("Bisheriger sysPass-Benutzername", { exact: true })
    .fill("legacy/admin");
  const legacyPassword = page.getByLabel("Bisheriges sysPass-Login-Passwort", {
    exact: true,
  });
  await expect(legacyPassword).toHaveAttribute(
    "aria-describedby",
    "setup-legacy-credentials-help",
  );
  await expect(legacyPassword).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
  await legacyPassword.fill("a");
  const master = page.getByLabel("Bisheriges Master-Passwort", { exact: true });
  await master.fill("b");
  await expect(submit).toBeDisabled();
  await master.press("Enter");
  expect(requests).toBe(0);
  await checkbox.check();
  await expect(submit).toBeEnabled();
  await master.fill("");
  await expect(submit).toBeDisabled();
  await master.fill("b");
  await expect(submit).toBeEnabled();
  await checkbox.uncheck();
  await expect(submit).toBeDisabled();
  await checkbox.check();
  await submit.click();
  await expect(
    page.getByText("Test preflight stopped", { exact: true }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page
    .getByRole("tab", { name: "Neu installieren", exact: true })
    .click();
  await expect(page.locator("#setup-password-feedback")).toContainText(
    "Mindestens 15 Zeichen",
  );
  await expect(page.locator("#setup-form button[type=submit]")).toBeDisabled();
});

test("setup layouts, both themes and all fourteen languages", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" ||
      /intlify|translation/i.test(message.text())
    )
      errors.push(message.text());
  });
  await openSetup(page);
  for (const [index, { value }] of languageOptions.entries()) {
    await page.locator(".auth-controls .n-select").click();
    if (index > 0) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator(".auth-description")).toHaveText(
      String(messages[value]?.setupHelp),
    );
    const tabs = page.getByRole("tab");
    await expect(tabs.nth(0)).toHaveText(String(messages[value]?.fresh));
    await expect(tabs.nth(1)).toHaveText(String(messages[value]?.migrate));
    await tabs.nth(1).click();
    await expect(page.locator(".setup-compatibility")).toHaveText(
      String(messages[value]?.setupCompatibilityNotice),
    );
    await expect(page.locator("#setup-maintenance-help")).toHaveText(
      String(messages[value]?.setupMaintenanceHelp),
    );
    await page
      .getByLabel(String(messages[value]?.setupLegacyPassword), { exact: true })
      .fill("weak");
    await expect(
      page.getByLabel(String(messages[value]?.setupLegacyLogin), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator("#setup-legacy-credentials-help")).toHaveText(
      String(messages[value]?.setupLegacyCredentialsHelp),
    );
    await tabs.nth(0).click();
    await expect(page.locator("#setup-password-feedback")).not.toBeEmpty();
    await page
      .getByLabel(String(messages[value]?.password), { exact: true })
      .fill("");
  }
  await page.reload();
  await page.getByRole("button", { name: "Darstellung", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const mobile of [false, true]) {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    for (const mode of ["fresh", "import"]) {
      await page
        .getByRole("tab", {
          name: mode === "fresh" ? "Neu installieren" : "sysPass importieren",
          exact: true,
        })
        .click();
      await accessible(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `output/playwright/setup-${mode}-${mobile ? "mobile" : "dark"}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "Darstellung", exact: true }).click();
  await accessible(page);
  expect(errors).toEqual([]);
});

test("correcting the existing administrator resumes migration without reimporting SQL", async ({
  page,
}) => {
  let imports = 0,
    migrations = 0;
  await page.route("**/api/v1/setup/import", (route) => {
    imports++;
    return route.fulfill({ status: 202, json: { job: "imported-db" } });
  });
  await page.route("**/api/v1/setup/jobs/imported-db", (route) =>
    route.fulfill({
      json: { state: "complete", step: "saved", result: { imported: true } },
    }),
  );
  await page.route("**/api/v1/setup/preflight", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("**/api/v1/setup/migrate", (route) => {
    migrations++;
    const payload = route.request().postDataJSON();
    expect(payload.login).toBe(
      migrations === 1 ? "new-nodepass-admin" : "legacy-admin",
    );
    expect(payload.password).toBe(
      migrations === 1
        ? "synthetic-new-password"
        : "synthetic-existing-password",
    );
    expect(payload.configuration).toBe("<config/>");
    return route.fulfill({ status: 202, json: { job: "admin-check" } });
  });
  await page.route("**/api/v1/setup/jobs/admin-check", (route) =>
    route.fulfill({
      json: {
        state: "failed",
        step: "confirm",
        error: {
          code: "SETUP_ADMIN_REQUIRED",
          message: "Existing sysPass administrator required",
          details: {
            reason:
              migrations === 1
                ? "not_found"
                : migrations === 2
                  ? "password_rejected"
                  : "not_application_admin",
          },
          step: "confirm",
          reference: "d4f7b70f-7ae3-46de-9fa7-a58fd3f58c45",
        },
      },
    }),
  );
  await openSetup(page);
  await page
    .getByRole("tab", { name: "sysPass importieren", exact: true })
    .click();
  await page
    .getByLabel("Einrichtungstoken", { exact: true })
    .fill("synthetic-test-token");
  const login = page.getByLabel("Bisheriger sysPass-Benutzername", {
    exact: true,
  });
  const password = page.getByLabel("Bisheriges sysPass-Login-Passwort", {
    exact: true,
  });
  await login.fill("new-nodepass-admin");
  await password.fill("synthetic-new-password");
  await page
    .getByLabel("Bisheriges Master-Passwort", { exact: true })
    .fill("synthetic-master");
  await page.getByLabel("config.xml", { exact: true }).setInputFiles({
    name: "config.xml",
    mimeType: "application/xml",
    buffer: Buffer.from("<config/>"),
  });
  await page.locator('input[type="file"][accept=".sql"]').setInputFiles({
    name: "dump.sql",
    mimeType: "application/sql",
    buffer: Buffer.from("synthetic-dump"),
  });
  await page.getByRole("checkbox", { name: maintenance, exact: true }).check();
  const submit = page
    .locator("#setup-form")
    .getByRole("button", { name: "sysPass importieren", exact: true });
  await submit.click();
  await expect(page.locator(".setup-failure")).toContainText(
    "kein Benutzer mit diesem Anmeldenamen gefunden",
  );
  await expect(submit).toBeEnabled();
  await expect(page.locator(".setup-imported")).toBeVisible();
  await expect(page.locator('input[type="file"][accept=".sql"]')).toHaveCount(
    0,
  );
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/setup-existing-admin-error.png",
    fullPage: true,
  });
  await login.fill("legacy-admin");
  await password.fill("synthetic-existing-password");
  await submit.click();
  await expect.poll(() => migrations).toBe(2);
  await expect(submit).toBeEnabled();
  expect(imports).toBe(1);
  await expect(page.locator(".setup-failure")).toContainText(
    "wurde gefunden und hat die erforderlichen Rechte",
  );
  await expect(page.locator(".setup-failure")).toContainText(
    "Login-Passwort zum Zeitpunkt des Exports",
  );
  await submit.click();
  await expect.poll(() => migrations).toBe(3);
  await expect(submit).toBeEnabled();
  await expect(page.locator(".setup-failure")).toContainText(
    "keine Anwendungsadmin-Rechte",
  );
  expect(imports).toBe(1);
  await accessible(page);
  await page.screenshot({
    path: "output/playwright/setup-existing-admin-role-error.png",
    fullPage: true,
  });
  await page.route("**/api/v1/status", (route) =>
    route.fulfill({ json: { setupRequired: true, legacy: true, sso: false } }),
  );
  await page.reload();
  await expect(page.locator(".setup-imported")).toBeVisible();
  await expect(page.locator('input[type="file"][accept=".sql"]')).toHaveCount(
    0,
  );
  await expect(login).toHaveValue("");
});

for (const problem of [
  {
    code: "DUMP_SYNTAX",
    details: { line: 12, operation: "INSERT", table: "User", row: 2 },
    expected: "nicht unterstützte oder unvollständige Anweisung",
  },
  {
    code: "DUMP_ALTER",
    details: { line: 5195, operation: "ALTER", table: "Account" },
    expected: "nicht unterstützte Strukturänderung",
  },
]) {
  test(`import failures stay visible with actionable context and the log reference (${problem.code})`, async ({
    page,
  }) => {
    const reference = "f7e99a4f-20cd-4174-9e62-e2059ac04b4b";
    let submissions = 0;
    await page.route("**/api/v1/setup/import", async (route) => {
      submissions++;
      expect(route.request().postDataJSON().configuration).toBe("<config/>");
      await route.fulfill({ status: 202, json: { job: "synthetic-job" } });
    });
    await page.route("**/api/v1/setup/jobs/synthetic-job", (route) =>
      route.fulfill({
        json: {
          state: "failed",
          step: "decode",
          error: {
            code: problem.code,
            message: "Unsupported SQL syntax",
            reference,
            step: "decode",
            details: problem.details,
          },
        },
      }),
    );
    await openSetup(page);
    await page
      .getByRole("tab", { name: "sysPass importieren", exact: true })
      .click();
    await page
      .getByLabel("Einrichtungstoken", { exact: true })
      .fill("synthetic-test-token");
    await page
      .getByLabel("Bisheriger sysPass-Benutzername", { exact: true })
      .fill("admin");
    await page
      .getByLabel("Bisheriges sysPass-Login-Passwort", { exact: true })
      .fill("legacy-password");
    await page
      .getByLabel("Bisheriges Master-Passwort", { exact: true })
      .fill("legacy-master");
    await page.getByLabel("config.xml", { exact: true }).setInputFiles({
      name: "config.xml",
      mimeType: "application/xml",
      buffer: Buffer.from("<config/>"),
    });
    await page.locator('input[type="file"][accept=".sql"]').setInputFiles({
      name: "dump.sql",
      mimeType: "application/sql",
      buffer: Buffer.from("INSERT INTO User VALUES (1,'admin');"),
    });
    await page
      .getByRole("checkbox", { name: maintenance, exact: true })
      .check();
    const submit = page
      .locator("#setup-form")
      .getByRole("button", { name: "sysPass importieren", exact: true });
    await submit.click();
    const failure = page.locator(".setup-failure");
    await expect(failure).toHaveAttribute("role", "alert");
    await expect(failure).toContainText(problem.expected);
    await expect(failure).toContainText(`SQL-Zeile: ${problem.details.line}`);
    await expect(failure).toContainText(`Tabelle: ${problem.details.table}`);
    await expect(failure).toContainText(
      `SQL-Befehl: ${problem.details.operation}`,
    );
    await expect(failure).toContainText(reference);
    await expect(failure).toContainText("npm run preview:logs");
    await expect(submit).toBeEnabled();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path:
        problem.code === "DUMP_SYNTAX"
          ? "output/playwright/setup-import-error.png"
          : "output/playwright/setup-import-metadata-error.png",
      fullPage: true,
    });
    await submit.click();
    await expect.poll(() => submissions).toBe(2);
    await expect(failure).toContainText(reference);
  });
}
