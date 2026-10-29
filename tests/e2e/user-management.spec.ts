import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languages, type Language } from "@nodepass/contracts";

async function fixture(page: Page) {
  const state = {
    language: "en_US" as Language,
    reset: false,
    admin: false,
    revision: 1,
    requireConfirm: false,
    confirmed: false,
    writes: [] as { path: string; data: Record<string, unknown> }[],
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/",
      "",
    );
    const method = route.request().method();
    const data = method === "GET" ? {} : route.request().postDataJSON();
    const viewer = {
      accessRevision: `synthetic-${state.revision}`,
      id: 2,
      name: "Synthetic manager",
      login: "manager",
      isAdmin: state.admin,
      isAppAdmin: state.admin,
      isAccountAdmin: false,
      directory: false,
      language: state.language,
      phase: "ready",
      needsMfa: false,
      csrf: "synthetic-csrf",
      permissions: {
        mgmUsers: true,
        mgmUsersResetPassword: state.reset,
        accView: true,
      },
    };
    const base = {
      userGroupId: 1,
      userProfileId: 1,
      isDisabled: 0,
      isAdminApp: 0,
      isAdminAcc: 0,
      email: "synthetic@example.test",
      groups: [],
    };
    const users = [
      {
        ...base,
        id: 1,
        name: "Application admin",
        login: "admin",
        isAdminApp: 1,
        management: {
          canEdit: false,
          canResetPassword: false,
          reason: "administrator",
        },
      },
      {
        ...base,
        id: 2,
        name: "Synthetic manager",
        login: "manager",
        management: { canEdit: false, canResetPassword: false, reason: "self" },
      },
      {
        ...base,
        id: 3,
        name: "Scoped reader",
        login: "reader",
        management: { canEdit: true, canResetPassword: state.reset },
      },
      {
        ...base,
        id: 4,
        name: "Foreign user",
        login: "foreign",
        management: {
          canEdit: false,
          canResetPassword: false,
          reason: "groups",
        },
      },
      {
        ...base,
        id: 5,
        name: "Privileged user",
        login: "privileged",
        management: {
          canEdit: false,
          canResetPassword: false,
          reason: "profile",
        },
      },
    ];
    let result: unknown = {},
      status = 200;
    if (path === "status")
      result = {
        setupRequired: false,
        legacy: false,
        version: "0.1.3",
        sso: false,
      };
    else if (path === "auth/session") result = viewer;
    else if (path === "auth/policy") result = { minLength: 15, minScore: 3 };
    else if (path === "auth/confirm" && method === "GET")
      result = { methods: ["password"] };
    else if (path === "auth/confirm") {
      state.confirmed = true;
      result = { confirmed: true };
    } else if (path === "users" && method === "GET") result = users;
    else if (path.startsWith("users/") && method === "PATCH") {
      state.writes.push({ path, data });
      if (state.requireConfirm && !state.confirmed) {
        status = 403;
        result = {
          message: "Confirm your identity again",
          code: "REAUTHENTICATION_REQUIRED",
        };
      } else result = { ...users[2], ...data };
    } else if (path === "groups") result = [{ id: 1, name: "Primary group" }];
    else if (path === "profiles")
      result = [
        { id: 1, name: "Reader profile", profile: { mgmUsers: 1, accView: 1 } },
      ];
    else if (path.startsWith("profiles/") && method === "PATCH") {
      state.writes.push({ path, data });
      result = { id: 1, ...data };
    } else if (path === "accounts")
      result = { total: 0, limit: 12, skip: 0, data: [] };
    else if (
      ["notifications", "events", "categories", "clients", "tags"].includes(
        path,
      ) ||
      path.endsWith("fields")
    )
      result = [];
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return state;
}
const openReader = (page: Page) =>
  page
    .getByRole("row")
    .filter({ hasText: "Scoped reader" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();

test("delegated edit boundaries, no reset input without permission and initial password on creation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/users");
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Application admin",
    "Synthetic manager",
    "Foreign user",
    "Privileged user",
  ])
    await expect(
      page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name, exact: true }) })
        .getByRole("button", { name: "Edit", exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByText("Only application administrators can edit administrators.", {
      exact: true,
    }),
  ).toBeVisible();
  await openReader(page);
  const dialog = page.getByRole("dialog", { name: "Edit", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Edited metadata");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.data).not.toHaveProperty("password");
  expect(state.writes[0]!.data).not.toHaveProperty("isAdminApp");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Password", exact: true }),
  ).toBeVisible();
});

test("confirmation cancellation, exact retry, keyboard and live reset-permission revocation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.reset = true;
  state.requireConfirm = true;
  await page.goto("/manage/users");
  await openReader(page);
  const dialog = page.getByRole("dialog", { name: "Edit", exact: true });
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic browser reset password 946!");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirm your identity",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  expect(state.writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await confirmation
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic identity confirmation");
  await confirmation
    .getByRole("textbox", { name: "Password", exact: true })
    .press("Enter");
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(3);
  expect(state.writes.map((write) => write.data)).toEqual(
    Array(3).fill(state.writes[0]!.data),
  );
  await openReader(page);
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("discard this synthetic secret");
  state.reset = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toBeHidden();
  await openReader(page);
  await expect(
    dialog.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
});

test("new reset permission defaults off in all locales, with accessible responsive controls", async ({
  page,
}) => {
  const state = await fixture(page);
  state.admin = true;
  await page.addInitScript(() =>
    localStorage.setItem("nodepass-theme", "dark"),
  );
  for (const language of languages) {
    state.language = language;
    await page.setViewportSize({
      width: language === "en_US" ? 1440 : 390,
      height: 1000,
    });
    await page.goto("/manage/profiles");
    await page
      .getByRole("row")
      .filter({ hasText: "Reader profile" })
      .getByRole("button")
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    const permission = dialog.locator(
      '[data-permission="mgmUsersResetPassword"]',
    );
    await expect(permission.getByRole("checkbox")).not.toBeChecked();
    await expect(permission).not.toContainText("permission_");
    await permission.getByRole("button").click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (["en_US", "de_DE", "ja_JP"].includes(language)) {
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
  }
});

test("explicitly grants reset permission while preserving enabled numeric sysPass profile rights", async ({
  page,
}) => {
  const state = await fixture(page);
  state.admin = true;
  await page.goto("/manage/profiles");
  await page
    .getByRole("row")
    .filter({ hasText: "Reader profile" })
    .getByRole("button")
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.locator('[data-permission="mgmUsers"]').getByRole("checkbox"),
  ).toBeChecked();
  await expect(
    dialog.locator('[data-permission="accView"]').getByRole("checkbox"),
  ).toBeChecked();
  await dialog
    .locator('[data-permission="mgmUsersResetPassword"]')
    .getByRole("checkbox")
    .check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]!.data.profile).toEqual({
    mgmUsers: true,
    accView: true,
    mgmUsersResetPassword: true,
  });
});
