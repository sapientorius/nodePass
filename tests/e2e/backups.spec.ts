import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  languages,
  type Language,
  type RestoreTicket,
  type BackupSummary,
} from "@nodepass/contracts";
const firstName = "nodepass-1793000000000-abcdefgh.npb";
async function fixture(page: Page) {
  const state = {
    language: "en_US" as Language,
    admin: true,
    viewerReady: true,
    maintenance: false,
    failBeforeReplacement: false,
    sessionRequests: 0,
    rows: [
      {
        name: firstName,
        createdAt: 1793000000000,
        size: 12345,
        origin: "manual",
        inUse: false,
      },
    ] as BackupSummary[],
    job: null as null | {
      id: string;
      state: string;
      step: string;
      name?: string;
    },
    schedule: {
      enabled: false,
      days: 1,
      time: "02:00",
      timezone: "Europe/Berlin",
      keep: 7,
      configured: true,
      nextAt: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      error: null,
    },
    restore: null as RestoreTicket | null,
    checkFailure: false,
    confirmationFailures: 0,
    confirmations: [] as Record<string, unknown>[],
    commits: [] as Record<string, unknown>[],
    schedules: [] as Record<string, unknown>[],
    chunks: [] as { offset: number; bytes: number; final: boolean }[],
    downloads: 0,
    deletes: 0,
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1/", "");
    const method = request.method(),
      data = ["GET", "DELETE"].includes(method) ? {} : request.postDataJSON();
    let result: unknown = {},
      status = 200;
    if (path === "status")
      result = {
        setupRequired: false,
        maintenance: state.maintenance,
        legacy: false,
        sso: false,
        version: "0.1.4",
      };
    else if (path === "auth/session") {
      state.sessionRequests++;
      if (!state.viewerReady) {
        status = 401;
        result = { message: "Synthetic session revoked" };
      } else
        result = {
          accessRevision: "synthetic-backups",
          id: 1,
          name: "Synthetic backup administrator",
          login: "synthetic-admin",
          phase: "ready",
          isAdmin: state.admin,
          isAppAdmin: state.admin,
          isAccountAdmin: false,
          directory: false,
          language: state.language,
          csrf: "synthetic-csrf",
          needsMfa: false,
          permissions: { accView: true, configBackup: true },
        };
    } else if (path === "auth/policy") result = { minLength: 15, minScore: 3 };
    else if (path === "auth/confirm" && method === "GET")
      result = { methods: ["password"] };
    else if (path === "backups" && method === "GET")
      result = {
        total: state.rows.length,
        skip: Number(url.searchParams.get("skip") ?? 0),
        limit: 25,
        data: state.rows,
      };
    else if (path.startsWith("backups/") && method === "GET") {
      state.downloads++;
      await route.fulfill({
        contentType: "application/octet-stream",
        headers: {
          "content-disposition": `attachment; filename="${path.split("/")[1]}"`,
        },
        body: Buffer.from("NPB1synthetic-browser-download"),
      });
      return;
    } else if (path.startsWith("backups/") && method === "DELETE") {
      state.deletes++;
      state.rows = state.rows.filter((r) => r.name !== path.split("/")[1]);
      status = 204;
    } else if (path === "backup-jobs" && method === "POST") {
      state.job = { id: "b".repeat(43), state: "running", step: "creating" };
      result = state.job;
      status = 202;
    } else if (path.startsWith("backup-jobs/")) result = state.job;
    else if (path === "backup-schedule") {
      if (method === "PATCH") {
        state.schedules.push(data);
        state.schedule = { ...state.schedule, ...data };
      }
      result = state.schedule;
    } else if (path === "backup-restores" && method === "GET")
      result =
        state.restore && !["complete", "failed"].includes(state.restore.state)
          ? state.restore
          : null;
    else if (path === "backup-restores" && method === "POST") {
      state.restore = {
        id: "r".repeat(43),
        statusToken: "t".repeat(43),
        state: "upload",
        step: "upload",
        offset: data.name ? 12345 : 0,
        uploadComplete: !!data.name,
        database: "synthetic_test",
        confirmation: "DELETE AND RESTORE synthetic_test",
      };
      result = state.restore;
      status = 202;
    } else if (path.endsWith("/upload")) {
      const bytes = Buffer.from(data.content, "base64").length;
      state.chunks.push({ offset: data.offset, bytes, final: data.final });
      state.restore = {
        ...state.restore!,
        offset: data.offset + bytes,
        uploadComplete: data.final,
      };
      result = state.restore;
    } else if (path.endsWith("/check")) {
      state.restore = {
        ...state.restore!,
        state: state.checkFailure ? "upload" : "ready",
        step: state.checkFailure ? "upload" : "ready",
        error: state.checkFailure ? "verification" : undefined,
        createdAt: 1793000000000,
        counts: { Account: 7, User: 3 },
      };
      result = state.restore;
      status = 202;
    } else if (path.endsWith("/confirm")) {
      state.confirmations.push(data);
      if (state.confirmationFailures > 0) {
        state.confirmationFailures--;
        status = 403;
        result = {
          code: "CONFIRMATION_INVALID",
          message: "Synthetic rejected identity",
        };
      } else result = { confirmed: true, authorization: "g".repeat(43) };
    } else if (path.endsWith("/commit")) {
      state.commits.push(data);
      state.maintenance = !state.failBeforeReplacement;
      state.restore = {
        ...state.restore!,
        state: state.failBeforeReplacement ? "failed" : "running",
        step: state.failBeforeReplacement ? "unavailable" : "maintenance",
        error: state.failBeforeReplacement ? "unavailable" : undefined,
      };
      result = state.restore;
      status = 202;
    } else if (path.endsWith("/status")) result = state.restore;
    else if (path.startsWith("backup-restores/") && method === "DELETE") {
      state.restore = null;
      status = 204;
    } else if (
      ["notifications", "categories", "clients", "tags"].includes(path)
    )
      result = [];
    else if (path === "accounts")
      result = { total: 0, limit: 12, skip: 0, data: [] };
    else if (path === "updates")
      result = {
        installedVersion: "0.1.4",
        channel: "stable",
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextCheckAt: 0,
        error: null,
        stale: false,
        available: null,
        mail: { enabled: false, missingAddresses: 0, pending: 0, failed: 0 },
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      ...(status === 204 ? {} : { body: JSON.stringify(result) }),
    });
  });
  return state;
}
const row = (page: Page, name = firstName) =>
  page.locator(".backup-row").filter({ hasText: name });
const keyValue = Buffer.alloc(32, 7).toString("base64");
async function prepare(page: Page) {
  await row(page).getByRole("button", { name: "Restore", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Original deployment key", exact: true })
    .fill(keyValue);
  await page
    .getByRole("button", { name: "Check file and key", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replace dataset", exact: true }),
  ).toBeVisible();
}
test("lists completed files after navigation, resumes creation, downloads and confirms deletion", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/backups");
  await expect(row(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create backup", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await page.locator('.sidebar a[href="/manage/backups"]').click();
  await expect(row(page)).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await row(page)
    .getByRole("button", { name: "Download", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe(firstName);
  expect(state.downloads).toBe(1);
  await page
    .getByRole("button", { name: "Create backup", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Create backup", exact: true }),
  ).toBeDisabled();
  const name = "nodepass-1793000000001-abcdefgh.npb";
  state.rows.unshift({ ...state.rows[0]!, name });
  state.job = { ...state.job!, state: "complete", step: "complete", name };
  await expect(row(page, name)).toBeVisible();
  await row(page, name)
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  expect(state.deletes).toBe(0);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row(page, name)).toHaveCount(0);
  expect(state.deletes).toBe(1);
});
test("saves a complete calendar schedule and keeps administrator controls scoped", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/backups");
  await page
    .getByRole("switch", { name: "Enable automatic backups", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Every X days", exact: true })
    .fill("3");
  await page.getByLabel("Time", { exact: true }).fill("04:15");
  await page
    .getByRole("textbox", {
      name: "Automatic versions to retain",
      exact: true,
    })
    .fill("12");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(state.schedules).toEqual([
    {
      enabled: true,
      days: 3,
      time: "04:15",
      timezone: "Europe/Berlin",
      keep: 12,
    },
  ]);
  state.admin = false;
  await page.reload();
  await expect(
    row(page).getByRole("button", { name: "Download", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
});
test("checks keys first, requires exact deletion text and fresh job-specific authentication", async ({
  page,
}) => {
  const state = await fixture(page);
  state.checkFailure = true;
  await page.goto("/manage/backups");
  await row(page).getByRole("button", { name: "Restore", exact: true }).click();
  const key = page.getByRole("textbox", {
    name: "Original deployment key",
    exact: true,
  });
  await key.fill(keyValue);
  await page
    .getByRole("button", { name: "Check file and key", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid or incompatible" }),
  ).toBeVisible();
  await expect(key).toHaveValue("");
  expect(state.commits).toHaveLength(0);
  state.checkFailure = false;
  await key.fill(keyValue);
  await page
    .getByRole("button", { name: "Check file and key", exact: true })
    .click();
  const replace = page.getByRole("button", {
    name: "Replace dataset",
    exact: true,
  });
  await expect(replace).toBeDisabled();
  const text = page.getByRole("textbox", { name: "Confirm", exact: true });
  await text.fill("wrong");
  await expect(replace).toBeDisabled();
  await text.fill("DELETE AND RESTORE synthetic_test");
  await replace.click();
  const dialog = page.getByRole("dialog", { name: "Confirm", exact: true });
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("discard this synthetic credential");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.commits).toHaveLength(0);
  await replace.click();
  await expect(
    dialog.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveValue("");
  state.confirmationFailures = 1;
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic rejected credential");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(state.commits).toHaveLength(0);
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic accepted credential");
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .press("Enter");
  await expect.poll(() => state.commits.length).toBe(1);
  expect(state.commits[0]).toEqual({
    confirmation: "DELETE AND RESTORE synthetic_test",
    authorization: "g".repeat(43),
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toMatch(/discard this|synthetic accepted|BwcHBw|gggggggg/);
});
test("uploads bounded sequential chunks and discards a key draft on navigation", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/backups");
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic.npb",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(8 * 1024 ** 2 + 32, 3),
  });
  await expect.poll(() => state.chunks.length).toBe(2);
  expect(state.chunks).toEqual([
    { offset: 0, bytes: 8 * 1024 ** 2, final: false },
    { offset: 8 * 1024 ** 2, bytes: 32, final: true },
  ]);
  const key = page.getByRole("textbox", {
    name: "Original deployment key",
    exact: true,
  });
  await expect(key).toBeVisible();
  await key.fill(keyValue);
  await page.getByRole("link", { name: "Accounts", exact: true }).click();
  await page.locator('.sidebar a[href="/manage/backups"]').click();
  await expect(key).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(key).toHaveCount(0);
});
test("keeps status through maintenance and reload, then returns to restored credentials", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/backups");
  await prepare(page);
  await page
    .getByRole("textbox", { name: "Confirm", exact: true })
    .fill("DELETE AND RESTORE synthetic_test");
  await page
    .getByRole("button", { name: "Replace dataset", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Confirm", exact: true });
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic password");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".backup-global")).toBeVisible();
  await page.reload();
  await expect(page.locator(".backup-global")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Password", exact: true }),
  ).toHaveCount(0);
  state.restore = { ...state.restore!, state: "complete", step: "complete" };
  state.maintenance = false;
  state.viewerReady = false;
  await expect(page.locator(".backup-global")).toContainText(
    "Sign in using credentials from the backup",
  );
  await page
    .locator(".backup-global")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Username", exact: true }),
  ).toBeVisible();
});
test("shows pre-replacement failures and closes them without clearing a valid session or drafts", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failBeforeReplacement = true;
  await page.goto("/manage/backups");
  await prepare(page);
  await page
    .getByRole("textbox", { name: "Automatic versions to retain", exact: true })
    .fill("22");
  await page
    .getByRole("textbox", { name: "Confirm", exact: true })
    .fill("DELETE AND RESTORE synthetic_test");
  await page
    .getByRole("button", { name: "Replace dataset", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Confirm", exact: true });
  await dialog
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("synthetic password");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".backup-global")).toContainText(
    "The backup operation could not be completed",
  );
  const sessions = state.sessionRequests;
  await page
    .locator(".backup-global")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".backup-global")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", {
      name: "Automatic versions to retain",
      exact: true,
    }),
  ).toHaveValue("22");
  expect(state.sessionRequests).toBe(sessions);
});
test("all fourteen languages, themes and small screens have accessible non-overflowing controls", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/backups");
  for (const theme of ["light", "dark"]) {
    for (const language of languages) {
      state.language = language;
      await page.evaluate(
        (theme) => localStorage.setItem("nodepass-theme", theme),
        theme,
      );
      await page.setViewportSize({
        width: language === "en_US" ? 1440 : language === "de_DE" ? 320 : 390,
        height: 1000,
      });
      await page.goto("/manage/backups");
      await expect(row(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.locator(".backup-settings").getByText(/^backup[A-Z][A-Za-z]+$/),
      ).toHaveCount(0);
      if (["en_US", "de_DE", "ja_JP"].includes(language)) {
        const audit = await new AxeBuilder({ page })
          .include(".backup-settings")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(audit.violations).toEqual([]);
      }
      if (language === "en_US")
        await page.screenshot({
          path: `output/playwright/backups-${theme}-desktop.png`,
          fullPage: true,
          animations: "disabled",
        });
      if (language === "de_DE")
        await page.screenshot({
          path: `output/playwright/backups-${theme}-mobile.png`,
          fullPage: true,
          animations: "disabled",
        });
    }
  }
});
