import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languages, type Language } from "@nodepass/contracts";
import { messages } from "../../packages/web/src/i18n";
test.use({ actionTimeout: 10000 });

declare global {
  interface Window {
    fieldClipboard: string[];
    fieldClipboardFail: boolean;
  }
}

const mask = "••••••••••••••••";
const definitions = [
  { id: 1, name: "Location", typeName: "text", value: "Rack A" },
  {
    id: 2,
    name: "Security number",
    typeName: "password",
    value: "synthetic secret",
  },
  {
    id: 3,
    name: "Second secret",
    typeName: "text",
    value: "second synthetic secret",
    isEncrypted: true,
  },
  { id: 4, name: "Expiry", typeName: "date", value: "2026-10-25" },
  {
    id: 5,
    name: "Description",
    typeName: "textarea",
    value: "First line\nSecond line",
  },
  {
    id: 6,
    name: "Required secret",
    typeName: "password",
    value: "required synthetic secret",
    required: true,
  },
  { id: 7, name: "Empty", typeName: "text", value: "" },
  { id: 8, name: "Unset secret", typeName: "password", value: "" },
];

async function fixture(page: Page, permissions: Record<string, boolean> = {}) {
  const state = {
    language: "de_DE" as Language,
    reads: [] as string[],
    writes: [] as { path: string; value: string }[],
    failSave: false,
    failReveal: false,
    values: new Map<string, Map<number, string>>(),
    permissions: { edit: true, secret: true, editSecret: true, ...permissions },
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.fieldClipboard = [];
    window.fieldClipboardFail = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          if (window.fieldClipboardFail)
            throw new Error("Synthetic clipboard failure");
          window.fieldClipboard.push(value);
        },
      },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/",
      "",
    );
    const fieldPath =
      /^(accounts\/\d+|items\/\d+\/\d+)\/fields(?:\/(\d+)(\/secret)?)?$/.exec(
        path,
      );
    if (fieldPath) {
      const item = fieldPath[1]!;
      if (!state.values.has(item))
        state.values.set(
          item,
          new Map(definitions.map((field) => [field.id, field.value])),
        );
      const values = state.values.get(item)!;
      if (fieldPath[3]) {
        state.reads.push(path);
        await route.fulfill(
          state.failReveal
            ? { status: 403, json: { message: "Synthetic reveal denied" } }
            : { json: { value: values.get(Number(fieldPath[2])) ?? "" } },
        );
      } else if (route.request().method() === "PUT") {
        const { value } = route.request().postDataJSON();
        state.writes.push({ path, value });
        if (state.failSave)
          await route.fulfill({
            status: 400,
            json: { message: "Synthetic save rejected" },
          });
        else {
          values.set(Number(fieldPath[2]), value);
          await route.fulfill({ status: 204 });
        }
      } else {
        await route.fulfill({
          json: definitions.map((field) => ({
            ...field,
            help: field.id === 2 ? "Synthetic confidential information" : "",
            required: !!field.required,
            isEncrypted: !!field.isEncrypted || field.typeName === "password",
            hasValue: !!values.get(field.id),
            value:
              field.isEncrypted || field.typeName === "password"
                ? ""
                : values.get(field.id),
          })),
        });
      }
      return;
    }
    const account = (id: number) => ({
      id,
      name: `Synthetic account ${id}`,
      login: "demo@example.test",
      url: "",
      notes: "",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
      userId: 1,
      version: 1,
      categoryName: "Category",
      clientName: "Customer",
      groupName: "Group",
      tags: [],
      permissions: state.permissions,
    });
    const responses: Record<string, unknown> = {
      status: {
        setupRequired: false,
        legacy: false,
        sso: false,
        version: "test",
      },
      "auth/session": {
        id: 1,
        name: "Synthetic administrator",
        login: "admin",
        phase: "ready",
        isAppAdmin: true,
        isAdmin: true,
        language: state.language,
        csrf: "synthetic-csrf",
        permissions: {},
      },
      "auth/policy": { minLength: 15, minScore: 3 },
      accounts: {
        data: [account(1), account(2)],
        total: 2,
        limit: 24,
        skip: 0,
      },
      categories: [{ id: 1, name: "Category" }],
      clients: [{ id: 1, name: "Customer" }],
      groups: [{ id: 1, name: "Group" }],
      users: [{ id: 1, name: "Synthetic administrator" }],
      tokens: [{ id: 7, method: "account/search", userId: 1 }],
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
  return state;
}

function row(page: Page, name: string) {
  return page
    .locator(".custom-field-row")
    .and(page.getByRole("group", { name, exact: true }));
}
function button(
  scope: Locator,
  action: string,
  name: string,
  locale: Language = "de_DE",
) {
  return scope.getByRole("button", {
    name: `${messages[locale]![action]} · ${name}`,
    exact: true,
  });
}
async function openFields(page: Page, locale: Language = "de_DE", id = 1) {
  await page
    .getByRole("button", { name: `Synthetic account ${id}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: messages[locale]!.fields, exact: true })
    .click();
  await expect(page.locator(".custom-field-row")).toHaveCount(
    definitions.length,
  );
}
async function accessible(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  const result = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
}

test("read-only values, exact copies and independent field edits", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/");
  await openFields(page);
  const location = row(page, "Location");
  const input = location.getByRole("textbox");
  await expect(input).toHaveValue("Rack A");
  await expect(input).toHaveAttribute("readonly", "");
  await expect(
    page.locator(".custom-fields").getByRole("button", { name: /^Speichern/ }),
  ).toHaveCount(0);
  await button(location, "copy", "Location").click();
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual(["Rack A"]);
  expect(state.reads).toEqual([]);
  await expect(row(page, "Empty").getByRole("textbox")).toHaveAttribute(
    "placeholder",
    "Kein Wert",
  );
  await expect(row(page, "Description").getByRole("textbox")).toHaveValue(
    "First line\nSecond line",
  );

  await button(location, "edit", "Location").focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await expect(button(location, "save", "Location")).toBeDisabled();
  await input.fill("Rack B");
  await button(row(page, "Description"), "edit", "Description").click();
  await row(page, "Description")
    .getByRole("textbox")
    .fill("Pending description");
  await button(location, "cancel", "Location").click();
  await expect(input).toHaveValue("Rack A");
  await expect(button(location, "edit", "Location")).toBeFocused();
  expect(state.writes).toEqual([]);
  await button(location, "edit", "Location").click();
  await input.fill("Rack B");
  state.failSave = true;
  await button(location, "save", "Location").click();
  await expect(
    page.getByText("Synthetic save rejected", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("Rack B");
  await expect(button(location, "cancel", "Location")).toBeVisible();
  state.failSave = false;
  await input.press("Enter");
  await expect(button(location, "edit", "Location")).toBeFocused();
  await expect(input).toHaveValue("Rack B");
  await expect(row(page, "Description").getByRole("textbox")).toHaveValue(
    "Pending description",
  );
  expect(state.writes).toEqual([
    { path: "accounts/1/fields/1", value: "Rack B" },
    { path: "accounts/1/fields/1", value: "Rack B" },
  ]);
  await button(location, "copy", "Location").click();
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual([
    "Rack A",
    "Rack B",
  ]);
});

test("date fields preserve ISO values when viewing, copying and editing", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/");
  await openFields(page);
  const expiry = row(page, "Expiry");
  await expect(expiry.getByRole("textbox")).toHaveValue("2026-10-25");
  await button(expiry, "copy", "Expiry").click();
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual([
    "2026-10-25",
  ]);
  await button(expiry, "edit", "Expiry").click();
  const input = expiry.getByRole("textbox");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-label", "Expiry");
  await expect(input).toHaveValue("25.10.2026");
  await expect(button(expiry, "save", "Expiry")).toBeDisabled();
  await input.fill("03.02.2027");
  await input.press("Tab");
  await expect(button(expiry, "save", "Expiry")).toBeEnabled();
  await accessible(page);
  await button(expiry, "save", "Expiry").click();
  await expect(button(expiry, "edit", "Expiry")).toBeVisible();
  await expect(input).toHaveValue("2027-02-03");
  expect(state.writes).toEqual([
    { path: "accounts/1/fields/4", value: "2027-02-03" },
  ]);
});

test("empty secrets have no reveal or copy actions before or after clearing and reopening", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const section of ["accounts", "categories", "tokens"]) {
    const open = async () => {
      if (section === "accounts") await openFields(page);
      else
        await page
          .locator("main")
          .getByRole("button", {
            name: section === "categories" ? "Bearbeiten" : "Zusatzfelder",
            exact: true,
          })
          .click();
    };
    await page.goto(section === "accounts" ? "/" : `/manage/${section}`);
    await open();
    const empty = row(page, "Unset secret");
    const assertEmpty = async () => {
      await expect(empty.getByRole("textbox")).toHaveValue("");
      await expect(empty.getByRole("textbox")).toHaveAttribute(
        "placeholder",
        "Kein Wert",
      );
      await expect(button(empty, "reveal", "Unset secret")).toHaveCount(0);
      await expect(button(empty, "copy", "Unset secret")).toHaveCount(0);
      await expect(button(empty, "edit", "Unset secret")).toBeVisible();
    };
    const reads = state.reads.length;
    await assertEmpty();
    expect(state.reads).toHaveLength(reads);
    await button(empty, "edit", "Unset secret").click();
    await empty.locator("input").first().fill("0");
    await button(empty, "save", "Unset secret").click();
    await expect(empty.getByRole("textbox")).toHaveValue(mask);
    await button(empty, "reveal", "Unset secret").click();
    await expect(empty.getByRole("textbox")).toHaveValue("0");
    await button(empty, "copy", "Unset secret").click();
    expect(await page.evaluate(() => window.fieldClipboard.at(-1))).toBe("0");
    await button(empty, "edit", "Unset secret").click();
    await empty.getByRole("checkbox").check();
    await button(empty, "save", "Unset secret").click();
    await assertEmpty();
    await page.reload();
    await open();
    await assertEmpty();
    expect(state.reads).toHaveLength(reads + 2);
  }
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual([]);
  expect(state.writes.map(({ value }) => value)).toEqual([
    "0",
    "",
    "0",
    "",
    "0",
    "",
  ]);
  await expect(page.getByText("Field not found", { exact: true })).toHaveCount(
    0,
  );
});

test("secret reveal, independent expiry, replacement and explicit clearing", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto("/");
  await openFields(page);
  const first = row(page, "Security number");
  const second = row(page, "Second secret");
  await expect(first.getByRole("textbox")).toHaveValue(mask);
  await button(first, "copy", "Security number").click();
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual([
    "synthetic secret",
  ]);
  await expect(first.getByRole("textbox")).toHaveValue(mask);
  await button(first, "reveal", "Security number").click();
  await expect(first.getByRole("textbox")).toHaveAttribute("type", "text");
  await expect(first.getByRole("textbox")).toHaveValue("synthetic secret");
  await page.clock.fastForward(10000);
  await button(second, "reveal", "Second secret").click();
  await expect(second.getByRole("textbox")).toHaveValue(
    "second synthetic secret",
  );
  await page.clock.fastForward(5000);
  await expect(first.getByRole("textbox")).toHaveValue(mask);
  await expect(second.getByRole("textbox")).toHaveValue(
    "second synthetic secret",
  );
  await button(first, "edit", "Security number").click();
  const replacement = first.locator("input").first();
  await expect(replacement).toBeFocused();
  await expect(replacement).toHaveValue("");
  await expect(replacement).toHaveAttribute("type", "password");
  await expect(button(first, "save", "Security number")).toBeDisabled();
  await first.locator("form").dispatchEvent("submit");
  expect(state.writes).toEqual([]);
  await replacement.fill("replacement secret");
  await page.clock.fastForward(10000);
  await expect(second.getByRole("textbox")).toHaveValue(mask);
  await expect(replacement).toHaveValue("replacement secret");
  await button(first, "save", "Security number").click();
  await expect(first.getByRole("textbox")).toHaveValue(mask);
  await button(first, "reveal", "Security number").click();
  await expect(first.getByRole("textbox")).toHaveValue("replacement secret");
  await button(first, "fieldHide", "Security number").click();
  await expect(first.getByRole("textbox")).toHaveValue(mask);
  await button(first, "edit", "Security number").click();
  await expect(replacement).toHaveValue("");
  await replacement.fill("discarded secret");
  await button(first, "cancel", "Security number").click();
  expect(state.writes).toHaveLength(1);
  await button(first, "edit", "Security number").click();
  await first
    .getByRole("checkbox", {
      name: "Wert löschen · Security number",
      exact: true,
    })
    .check();
  await button(first, "save", "Security number").click();
  expect(state.writes.at(-1)).toEqual({
    path: "accounts/1/fields/2",
    value: "",
  });
  await expect(first.getByRole("textbox")).toHaveValue("");
  await expect(button(first, "reveal", "Security number")).toHaveCount(0);
  await expect(button(first, "copy", "Security number")).toHaveCount(0);
  await expect(first.getByRole("textbox")).toHaveAttribute(
    "placeholder",
    "Kein Wert",
  );
  const required = page.locator('[data-field-id="6"]');
  await button(required, "edit", "Required secret").click();
  await expect(required.getByRole("checkbox")).toHaveCount(0);
  await expect(button(required, "save", "Required secret")).toBeDisabled();
});

test("copy and reveal failures remain retryable without false success", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/");
  await openFields(page);
  const secret = row(page, "Security number");
  state.failReveal = true;
  await button(secret, "reveal", "Security number").click();
  await expect(
    page.getByText("Synthetic reveal denied", { exact: true }),
  ).toBeVisible();
  await expect(secret.getByRole("textbox")).toHaveValue(mask);
  state.failReveal = false;
  await page.evaluate(() => {
    window.fieldClipboardFail = true;
  });
  await button(secret, "copy", "Security number").click();
  await expect(
    page.getByText("Synthetic clipboard failure", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("In die Zwischenablage kopiert.", { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.fieldClipboard)).toEqual([]);
  await page.evaluate(() => {
    window.fieldClipboardFail = false;
  });
  await button(secret, "copy", "Security number").click();
  await expect(
    page.getByText("In die Zwischenablage kopiert.", { exact: true }),
  ).toBeVisible();
  await expect(secret.getByRole("textbox")).toHaveValue(mask);
});

for (const action of ["reveal", "copy", "save"] as const) {
  test(`late ${action} cannot affect a closed tab or another account`, async ({
    page,
  }) => {
    await fixture(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const path = `/api/v1/accounts/1/fields/2${action === "save" ? "" : "/secret"}`;
    await page.route(`**${path}`, async (route) => {
      requests++;
      await pending;
      await route.fulfill(
        action === "save"
          ? { status: 204 }
          : { json: { value: "late synthetic secret" } },
      );
    });
    await page.goto("/");
    await openFields(page);
    const secret = row(page, "Security number");
    const response = page.waitForResponse(
      (result) => new URL(result.url()).pathname === path,
    );
    try {
      if (action === "save") {
        await button(secret, "edit", "Security number").click();
        await secret.locator("input").first().fill("late replacement");
      }
      await button(secret, action, "Security number").click();
      await expect.poll(() => requests).toBe(1);
      if (action === "save") {
        await expect(
          button(secret, "cancel", "Security number"),
        ).toBeDisabled();
        await secret.locator("form").dispatchEvent("submit");
      } else {
        await expect(button(secret, "edit", "Security number")).toBeDisabled();
        await expect(button(secret, "copy", "Security number")).toBeDisabled();
      }
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Konten", exact: true })
        .click();
      await expect(page.locator(".custom-fields")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openFields(page, "de_DE", 2);
    } finally {
      release();
    }
    await (await response).finished();
    await expect(row(page, "Security number").getByRole("textbox")).toHaveValue(
      mask,
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Konten", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Zusatzfelder", exact: true })
      .click();
    await expect(row(page, "Security number").getByRole("textbox")).toHaveValue(
      mask,
    );
    expect(requests).toBe(1);
    expect(await page.evaluate(() => window.fieldClipboard)).toEqual([]);
    await expect(page.getByText("Gespeichert", { exact: true })).toHaveCount(0);
  });
}

test("read, edit and secret replacement permissions stay independent", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const permissions of [
    { edit: false, secret: false, editSecret: false },
    { edit: false, secret: true, editSecret: false },
    { edit: true, secret: false, editSecret: true },
    { edit: true, secret: true, editSecret: false },
    { edit: true, secret: false, editSecret: false },
  ]) {
    state.permissions = permissions;
    await page.goto("/");
    await openFields(page);
    const secret = row(page, "Security number");
    await expect(button(secret, "reveal", "Security number")).toHaveCount(
      permissions.secret ? 1 : 0,
    );
    await expect(button(secret, "copy", "Security number")).toHaveCount(
      permissions.secret ? 1 : 0,
    );
    await expect(button(secret, "edit", "Security number")).toHaveCount(
      permissions.edit && permissions.editSecret ? 1 : 0,
    );
    await expect(button(row(page, "Location"), "edit", "Location")).toHaveCount(
      permissions.edit ? 1 : 0,
    );
    if (permissions.editSecret) {
      await button(secret, "edit", "Security number").click();
      await secret.locator("input").first().fill("write-only replacement");
      await button(secret, "save", "Security number").click();
      await expect(button(secret, "edit", "Security number")).toBeVisible();
    }
  }
  expect(state.reads).toEqual([]);
  expect(state.writes).toEqual([
    { path: "accounts/1/fields/2", value: "write-only replacement" },
  ]);
});

test("administration and API-token dialogs discard field state on close", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const section of ["categories", "tokens"]) {
    await page.goto(`/manage/${section}`);
    const open = () =>
      section === "categories"
        ? page
            .locator("main")
            .getByRole("button", { name: "Bearbeiten", exact: true })
            .click()
        : page
            .locator("main")
            .getByRole("button", { name: "Zusatzfelder", exact: true })
            .click();
    await open();
    await expect(page.locator(".custom-field-row")).toHaveCount(
      definitions.length,
    );
    const secret = row(page, "Security number");
    await button(secret, "reveal", "Security number").click();
    await expect(secret.getByRole("textbox")).toHaveValue("synthetic secret");
    await button(row(page, "Location"), "edit", "Location").click();
    await row(page, "Location")
      .getByRole("textbox")
      .fill("discarded administration draft");
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", {
        name: section === "categories" ? "Abbrechen" : "Schließen",
        exact: true,
      })
      .click();
    await expect(page.locator(".custom-fields")).toHaveCount(0);
    await open();
    await expect(row(page, "Security number").getByRole("textbox")).toHaveValue(
      mask,
    );
    await expect(row(page, "Location").getByRole("textbox")).toHaveValue(
      "Rack A",
    );
  }
  expect(state.writes).toEqual([]);
});

test("all locales, themes, mobile layout and accessible field controls", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const language of languages) {
    state.language = language;
    await page.goto("/");
    await openFields(page, language);
    const secret = row(page, "Security number");
    await expect(
      button(secret, "copy", "Security number", language),
    ).toBeVisible();
    await button(secret, "reveal", "Security number", language).click();
    await expect(
      button(secret, "fieldHide", "Security number", language),
    ).toBeVisible();
    await button(secret, "edit", "Security number", language).click();
    await expect(
      secret.getByText(messages[language]!.fieldReplacementHelp, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(secret.getByRole("checkbox")).toContainText(
      messages[language]!.fieldClear,
    );
  }
  state.language = "de_DE";
  await page.goto("/");
  await openFields(page);
  await accessible(page);
  await page
    .getByRole("dialog")
    .screenshot({ path: "output/playwright/custom-fields-light.png" });
  await button(row(page, "Security number"), "edit", "Security number").click();
  await accessible(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dunkel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await openFields(page);
    await accessible(page);
    await button(
      row(page, "Security number"),
      "edit",
      "Security number",
    ).click();
    await accessible(page);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    if (width === 390) {
      await row(page, "Location").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "output/playwright/custom-fields-mobile-dark.png",
      });
    }
    await page.keyboard.press("Escape");
  }
});
