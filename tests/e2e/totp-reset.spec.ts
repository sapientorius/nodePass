import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languages, type Language, type MfaMethod } from "@nodepass/contracts";
import { totpResetMessages } from "../../packages/web/src/totp-reset-translations";

async function fixture(page: Page) {
  const state = {
    admin: true,
    language: "en_US" as Language,
    revision: 1,
    phase: "ready",
    methods: [] as MfaMethod[],
    resetPending: false,
    requireConfirmation: false,
    confirmed: false,
    failReset: false,
    holdReset: false,
    releaseReset: () => {},
    resets: [] as { path: string; body: unknown }[],
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/api/v1/",
      "",
    );
    const method = route.request().method();
    const viewer = {
      id: 1,
      name: "Synthetic administrator",
      login: "admin",
      language: state.language,
      isAdmin: state.admin,
      isAppAdmin: state.admin,
      isAccountAdmin: false,
      directory: false,
      accessRevision: `synthetic-${state.revision}`,
      csrf: "synthetic-csrf",
      phase: state.phase,
      needsMfa: state.phase !== "ready",
      mfaMethods: state.methods,
      mfaResetPending: state.resetPending,
      permissions: { mgmUsers: true, accView: true },
    };
    let status = 200,
      data: unknown = [];
    if (path === "status")
      data = {
        setupRequired: false,
        legacy: false,
        sso: false,
        version: "0.1.7",
      };
    else if (path === "auth/session") data = viewer;
    else if (path === "auth/policy") data = { minLength: 15, minScore: 3 };
    else if (path === "auth/confirm" && method === "GET")
      data = { methods: ["password"] };
    else if (path === "auth/confirm") {
      state.confirmed = true;
      data = { confirmed: true };
    } else if (path === "users")
      data = [
        {
          id: 1,
          name: "Synthetic administrator",
          login: "admin",
          management: {
            canEdit: true,
            canResetPassword: true,
            canResetTotp: false,
          },
        },
        {
          id: 2,
          name: "Synthetic reader",
          login: "reader",
          management: {
            canEdit: true,
            canResetPassword: true,
            canResetTotp: state.admin,
          },
        },
      ];
    else if (path.endsWith("/totp-reset")) {
      state.resets.push({ path, body: route.request().postDataJSON() });
      if (state.holdReset)
        await new Promise<void>((resolve) => {
          state.releaseReset = resolve;
        });
      if (state.requireConfirmation && !state.confirmed) {
        status = 403;
        data = {
          code: "REAUTHENTICATION_REQUIRED",
          message: "Confirm your identity again",
        };
      } else if (state.failReset) {
        status = 500;
        data = { message: "Synthetic failure" };
      } else status = 204;
    } else if (path === "accounts")
      data = { total: 0, limit: 12, skip: 0, data: [] };
    await route.fulfill({
      status,
      ...(status === 204
        ? {}
        : { contentType: "application/json", body: JSON.stringify(data) }),
    });
  });
  return state;
}
const action = (page: Page, label = "Reset 2FA app") =>
  page
    .getByRole("row")
    .filter({ hasText: "Synthetic reader" })
    .getByRole("button", { name: label, exact: true });

test("names the target, cancels safely and reuses identity confirmation with the exact reset body", async ({
  page,
}) => {
  const state = await fixture(page);
  state.requireConfirmation = true;
  await page.goto("/manage/users");
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Synthetic administrator" })
      .getByRole("button", { name: "Reset 2FA app" }),
  ).toHaveCount(0);
  await action(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Reset 2FA app",
    exact: true,
  });
  await expect(dialog).toContainText("Synthetic reader (reader)");
  await expect(dialog).toContainText("Existing passkeys remain valid");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(state.resets).toHaveLength(0);
  await expect(action(page)).toBeFocused();
  await action(page).click();
  await dialog
    .getByRole("button", { name: "Reset 2FA app", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirm your identity",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Reset 2FA app", exact: true })
    .click();
  await confirmation
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic confirmation password");
  await confirmation
    .getByRole("textbox", { name: "Password", exact: true })
    .press("Enter");
  await expect(dialog).toBeHidden();
  expect(state.resets).toEqual(
    Array(3).fill({ path: "users/2/totp-reset", body: {} }),
  );
  await expect(
    page.getByText("The 2FA app has been reset.", { exact: true }),
  ).toBeVisible();
});

test("blocks duplicate requests, retries failures and discards the dialog on role loss", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failReset = true;
  state.holdReset = true;
  await page.goto("/manage/users");
  await action(page).click();
  const dialog = page.getByRole("dialog", {
    name: "Reset 2FA app",
    exact: true,
  });
  const submit = dialog.getByRole("button", {
    name: "Reset 2FA app",
    exact: true,
  });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(state.resets).toHaveLength(1);
  state.holdReset = false;
  state.releaseReset();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText("The 2FA app has been reset.", { exact: true }),
  ).toHaveCount(0);
  state.failReset = false;
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(state.resets).toHaveLength(2);
  await action(page).click();
  state.admin = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toBeHidden();
  await expect(action(page)).toHaveCount(0);
});

test("cancels a deferred reset when access changes during confirmation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.requireConfirmation = true;
  await page.goto("/manage/users");
  await action(page).click();
  await page
    .getByRole("dialog", { name: "Reset 2FA app", exact: true })
    .getByRole("button", { name: "Reset 2FA app", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirm your identity",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  state.admin = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(confirmation).toBeHidden();
  expect(state.resets).toHaveLength(1);
});

test("translates reset dialogs in every locale with light/dark mobile layout and Axe", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const language of languages) {
    state.language = language;
    await page.setViewportSize({
      width: language === "en_US" ? 1440 : language === "de_DE" ? 320 : 390,
      height: 1000,
    });
    await page.addInitScript(
      (dark) => localStorage.setItem("nodepass-theme", dark ? "dark" : "light"),
      language !== "en_US",
    );
    await page.goto("/manage/users");
    const label = totpResetMessages[language]!.totpReset!;
    await action(page, label).click();
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    await expect(dialog).toContainText(
      totpResetMessages[language]!.totpResetHelp!,
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    if (["en_US", "de_DE", "ja_JP"].includes(language)) {
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: `output/playwright/totp-reset-${language}.png`,
        animations: "disabled",
      });
    }
  }
});

test("requires a new factor after reset and offers only the retained passkey when present", async ({
  page,
}) => {
  const state = await fixture(page);
  state.phase = "enroll";
  state.resetPending = true;
  await page.goto("/");
  await expect(
    page.getByText(totpResetMessages.en_US!.totpResetPending!, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authenticator app", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Verification code", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: "output/playwright/totp-reset-enrollment-mobile.png",
    animations: "disabled",
  });
  state.phase = "verify";
  state.resetPending = false;
  state.methods = ["passkey"];
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sign in with a passkey", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Verification code", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Emergency access: use a recovery code",
      exact: true,
    }),
  ).toHaveCount(0);
});
