import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languages, type Language } from "@nodepass/contracts";
import { messages } from "../../packages/web/src/i18n";

function data() {
  return {
    user: {
      id: 1,
      name: "Session administrator",
      login: "admin",
      email: "demo@example.invalid",
      userGroupId: 1,
      userProfileId: 1,
      groups: [] as number[],
      isAdminApp: true,
      isAdminAcc: false,
      isDisabled: false,
    },
    revision: "initial-access",
    permissions: {} as Record<string, boolean>,
    language: "en_US" as Language,
    phase: "ready",
    sessionStatus: 200,
    sessionFailure: false,
    revokeOnSave: false,
    saved: 0,
    sessions: 0,
    notifications: 0,
    secretStatus: 200,
    accounts: 0,
    delay: null as null | ((route: Route, viewer: unknown) => Promise<void>),
  };
}
async function fixture(page: Page, state = data()) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/",
      "",
    );
    const viewer = {
      ...state.user,
      isAppAdmin: state.user.isAdminApp,
      isAccountAdmin: state.user.isAdminAcc,
      isAdmin: state.user.isAdminApp || state.user.isAdminAcc,
      csrf: "synthetic-session-csrf",
      language: state.language,
      phase: state.phase,
      needsMfa: state.phase !== "ready",
      permissions: state.permissions,
      accessRevision: state.revision,
    };
    if (path === "auth/session") {
      state.sessions++;
      if (state.delay) {
        const delay = state.delay;
        state.delay = null;
        await delay(route, structuredClone(viewer));
        return;
      }
      if (state.sessionFailure) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: state.sessionStatus,
        json:
          state.sessionStatus === 200
            ? viewer
            : { message: "Synthetic session unavailable" },
      });
      return;
    }
    if (path === "auth/logout") {
      state.sessionStatus = 401;
      await route.fulfill({ status: 204 });
      return;
    }
    if (path === "users/1" && route.request().method() === "PATCH") {
      state.saved++;
      Object.assign(state.user, route.request().postDataJSON());
      if (state.revokeOnSave) state.sessionStatus = 401;
      await route.fulfill({ json: state.user });
      return;
    }
    if (path === "accounts/1/secret") {
      await route.fulfill({
        status: state.secretStatus,
        json:
          state.secretStatus === 200
            ? { password: "synthetic visible secret" }
            : {
                message: "Synthetic access denied",
                ...(state.phase !== "ready" ? { code: "MFA_REQUIRED" } : {}),
              },
      });
      return;
    }
    if (path === "notifications") state.notifications++;
    if (path === "accounts") state.accounts++;
    const account = {
      id: 1,
      name: "Session account",
      login: "demo",
      url: "",
      notes: "",
      categoryId: 1,
      clientId: 1,
      userGroupId: 1,
      userId: 1,
      version: 1,
      tags: [],
      permissions: { view: true, edit: true, secret: true, editSecret: true },
      categoryName: "Category",
      clientName: "Customer",
      groupName: "Group",
    };
    const responses: Record<string, unknown> = {
      status: {
        setupRequired: false,
        legacy: false,
        sso: false,
        version: "test",
      },
      "auth/policy": { minLength: 15, minScore: 3 },
      users: [state.user],
      profiles: [
        { id: 1, name: "Session profile", profile: state.permissions },
      ],
      groups: [
        { id: 1, name: "Group" },
        { id: 2, name: "Another group" },
      ],
      categories: [{ id: 1, name: "Category" }],
      clients: [{ id: 1, name: "Customer" }],
      accounts: { data: [account], total: 1, limit: 24, skip: 0 },
      "accounts/1": account,
      updates: {
        installedVersion: "0.1.3",
        channel: "stable",
        stale: false,
        available: null,
        error: null,
        mail: { enabled: false, pending: 0, failed: 0, missingAddresses: 0 },
      },
    };
    await route.fulfill({ json: responses[path] ?? [] });
  });
  return state;
}
async function ready(page: Page, state: ReturnType<typeof data>, path = "/") {
  const notifications = state.notifications;
  await page.goto(path);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect.poll(() => state.notifications).toBeGreaterThan(notifications);
}
async function activate(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function edit(page: Page) {
  await page
    .locator("main")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  return page.getByRole("dialog");
}

test("two sessions retain ordinary edits and unchanged polling preserves an open draft", async ({
  page,
  browser,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  await ready(page, state, "/manage/users");
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await fixture(second, state);
    await ready(second, state);
    const dialog = await edit(page);
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Renamed session user");
    await dialog
      .getByRole("textbox", { name: "Username", exact: true })
      .fill("renamed-login");
    const sessions = state.sessions;
    await page.clock.fastForward(60000);
    await expect.poll(() => state.sessions).toBeGreaterThan(sessions);
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Renamed session user");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".profile")).toContainText("renamed-login");
    await activate(second);
    await expect(second.locator(".profile")).toContainText(
      "Renamed session user",
    );
    await expect(second.locator(".profile")).toContainText("renamed-login");
    expect(state.saved).toBe(1);
    await expect(
      page.getByText(messages.en_US!.accessChanged!, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("successful self save is shown before a required logout", async ({
  page,
}) => {
  const state = await fixture(page);
  state.revokeOnSave = true;
  await ready(page, state, "/manage/users");
  const dialog = await edit(page);
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic replacement password");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".auth-card")).toBeVisible();
  await expect(
    page.getByText(messages.en_US!.saved!, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".global-error")).toHaveCount(0);
  expect(state.saved).toBe(1);
});

test("group-only changes clear secrets and dialogs while retaining account filters and sort", async ({
  page,
}) => {
  const state = await fixture(page);
  await ready(page, state);
  expect(state.sessions).toBe(1);
  await page
    .getByRole("textbox", { name: "Search your accounts …", exact: true })
    .fill("Session");
  await page
    .getByRole("button", { name: "Session account", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(dialog.locator('input[type="text"]')).toHaveValue(
    "synthetic visible secret",
  );
  state.revision = "group-only-change";
  const count = state.accounts;
  await activate(page);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Search your accounts …", exact: true }),
  ).toHaveValue("Session");
  await expect.poll(() => state.accounts).toBeGreaterThan(count);
  await expect(
    page.getByText(messages.en_US!.accessChanged!, { exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").innerHTML()).not.toContain(
    "synthetic visible secret",
  );
});

test("removed management rights redirect direct routes without logging out", async ({
  page,
}) => {
  const state = await fixture(page);
  state.user.isAdminApp = false;
  state.permissions = { mgmUsers: true };
  await ready(page, state, "/manage/users");
  await edit(page);
  state.permissions = {};
  state.revision = "revoked-management";
  await activate(page);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('.sidebar a[href="/manage/users"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.goto("/manage/users");
  await expect(page).toHaveURL("/");
});

test("403 refreshes once and does not retry a denied action; MFA switches to the existing challenge", async ({
  page,
}) => {
  const state = await fixture(page);
  await ready(page, state);
  state.secretStatus = 403;
  const count = state.sessions;
  await page
    .locator(".account-card")
    .getByRole("button", {
      name: "Copy password · Session account",
      exact: true,
    })
    .click();
  await expect.poll(() => state.sessions).toBe(count + 1);
  await expect(
    page.getByText("Synthetic access denied", { exact: true }),
  ).toBeVisible();
  state.phase = "enroll";
  await page
    .locator(".account-card")
    .getByRole("button", {
      name: "Copy password · Session account",
      exact: true,
    })
    .click();
  await expect(page.locator(".auth-card")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Login protection", exact: true }),
  ).toBeVisible();
});

test("network and server errors preserve the current session and allow retry", async ({
  page,
}) => {
  const state = await fixture(page);
  await ready(page, state, "/manage/users");
  const dialog = await edit(page);
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Retained draft");
  for (const status of [500, 429, 0]) {
    const count = state.sessions;
    state.sessionStatus = status || 200;
    state.sessionFailure = status === 0;
    await activate(page);
    await expect.poll(() => state.sessions).toBe(count + 1);
    await expect(page.locator(".global-error")).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Retained draft");
  }
  state.sessionFailure = false;
  state.sessionStatus = 200;
  await activate(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Retained draft");
});

test("overlapping refreshes coalesce and a late response cannot restore a logged-out session", async ({
  page,
}) => {
  const state = await fixture(page);
  await ready(page, state);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.delay = async (route, viewer) => {
    await pending;
    await route.fulfill({ json: viewer });
  };
  const count = state.sessions;
  await activate(page);
  await expect.poll(() => state.sessions).toBe(count + 1);
  await activate(page);
  expect(state.sessions).toBe(count + 1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".auth-card")).toBeVisible();
  release();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await activate(page);
  expect(state.sessions).toBe(count + 1);
});

test("late secrets cannot repopulate a view after access changes", async ({
  page,
}) => {
  const state = await fixture(page);
  await ready(page, state);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/v1/accounts/1/secret", async (route) => {
    calls++;
    await pending;
    await route.fulfill({ json: { password: "late forbidden secret" } });
  });
  await page
    .getByRole("button", { name: "Session account", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reveal", exact: true })
    .click();
  await expect.poll(() => calls).toBe(1);
  state.revision = "changed-access";
  await activate(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const response = page.waitForResponse("**/api/v1/accounts/1/secret");
  release();
  await (await response).finished();
  expect(await page.locator("body").innerHTML()).not.toContain(
    "late forbidden secret",
  );
});

test("all locales display the rights notice with accessible light and dark mobile layouts", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const language of languages) {
    state.language = language;
    await ready(page, state);
    state.revision += "x";
    await activate(page);
    await expect(
      page.getByText(messages[language]!.accessChanged!, { exact: true }),
    ).toBeVisible();
  }
  state.language = "en_US";
  for (const [theme, width] of [
    ["light", 1440],
    ["dark", 390],
    ["dark", 320],
  ] as const) {
    await page.evaluate(
      (theme) => localStorage.setItem("nodepass-theme", theme),
      theme,
    );
    await page.setViewportSize({ width, height: 900 });
    await ready(page, state);
    state.revision += "x";
    await activate(page);
    await expect(
      page.getByText(messages.en_US!.accessChanged!, { exact: true }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ target }) => target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width !== 320)
      await page.screenshot({
        path: `output/playwright/session-${theme}.png`,
        fullPage: true,
      });
  }
});

test("public routes never initiate a session refresh", async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto("/public/synthetic");
  const count = state.sessions;
  await activate(page);
  await page.clock.fastForward(60000);
  expect(state.sessions).toBe(count);
});
