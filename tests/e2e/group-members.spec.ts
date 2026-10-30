import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { languages, type Language } from "@nodepass/contracts";

async function fixture(page: Page) {
  page.setDefaultTimeout(10000);
  const state = {
    language: "en_US" as Language,
    admin: false,
    users: true,
    revision: 1,
    failPrimary: false,
    hold: false,
    pending: [] as (() => Promise<void>)[],
    requests: [] as string[],
    writes: [] as string[],
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1/", "");
    state.requests.push(path + url.search);
    if (route.request().method() !== "GET") state.writes.push(path);
    const groups = [
      { id: 1, name: "Group 10", description: "Alpha description" },
      { id: 2, name: "Group 2", description: "Zulu description" },
      { id: 3, name: "Empty group", description: "Middle description" },
    ];
    const base = {
      userProfileId: 1,
      groups: [],
      management: { canEdit: true, canResetPassword: false },
    };
    const users = [
      {
        ...base,
        id: 3,
        name: "User10",
        login: "z",
        email: "z@example.test",
        isDisabled: 1,
        userGroupId: 5000,
        primaryGroup: { id: 5000, name: "Zulu" },
        additionalGroups: [
          { id: 10, name: "Team 10" },
          { id: 11, name: "Team 2" },
        ],
      },
      {
        ...base,
        id: 1,
        name: "User2",
        login: "c",
        email: "t@example.test",
        isDisabled: 0,
        userGroupId: 1,
        primaryGroup: { id: 1, name: "Alpha" },
        additionalGroups: [{ id: 12, name: "Alpha" }],
      },
      {
        ...base,
        id: 4,
        name: "user2",
        login: "a",
        email: "a@example.test",
        isDisabled: 0,
        userGroupId: 2,
        primaryGroup: { id: 2, name: "alpha" },
        additionalGroups: [{ id: 13, name: "Beta" }],
      },
      {
        ...base,
        id: 2,
        name: "Alpha",
        login: "b",
        email: "b@example.test",
        isDisabled: 1,
        userGroupId: null,
        primaryGroup: null,
        additionalGroups: [],
      },
    ];
    let result: unknown = [],
      status = 200;
    if (path === "status")
      result = {
        setupRequired: false,
        legacy: false,
        version: "0.1.4",
        sso: false,
      };
    else if (path === "auth/session")
      result = {
        accessRevision: `members-${state.revision}`,
        id: 50,
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
        permissions: { mgmUsers: state.users, mgmGroups: true, accView: true },
      };
    else if (path === "auth/policy") result = { minLength: 15, minScore: 3 };
    else if (path === "updates")
      result = {
        channel: "stable",
        state: "current",
        installedVersion: "0.1.4",
      };
    else if (path === "users") result = users;
    else if (path === "groups") result = groups;
    else if (path === "profiles")
      result = [
        { id: 1, name: "Profile 10", profile: {} },
        { id: 2, name: "Profile 2", profile: {} },
        { id: 3, name: "Empty profile", profile: {} },
      ];
    else if (path === "accounts")
      result = { total: 0, limit: 12, skip: 0, data: [] };
    else if (/^(groups|profiles)\/\d+\/members$/.test(path)) {
      const id = Number(path.split("/")[1]);
      const kind = path.startsWith("profiles/")
        ? "profile"
        : url.searchParams.get("membership");
      const skip = Number(url.searchParams.get("skip"));
      const total = id === 3 ? 0 : kind === "additional" ? 26 : 27;
      if (state.failPrimary && kind !== "additional") {
        status = 500;
        result = { message: "Synthetic membership failure" };
      } else
        result = {
          total,
          skip,
          limit: 25,
          data: Array.from(
            { length: Math.min(25, Math.max(total - skip, 0)) },
            (_, index) => ({
              id: skip + index + 100,
              name: `${id === 2 ? "Second" : "First"} ${kind} ${skip + index + 1}`,
              login: `synthetic.${kind}.${skip + index + 1}`,
            }),
          ),
        };
      if (state.hold)
        await new Promise<void>((resolve) =>
          state.pending.push(async () => {
            await route.fulfill({
              status,
              contentType: "application/json",
              body: JSON.stringify(result),
            });
            resolve();
          }),
        );
      else
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(result),
        });
      return;
    } else if (
      !["notifications", "categories", "clients", "tags", "events"].includes(
        path,
      ) &&
      !path.endsWith("fields")
    )
      throw new Error(`Unexpected synthetic API request: ${path}`);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  return state;
}
const groupRow = (page: Page, name: string) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });
const openMembers = (page: Page, name = "Group 10") =>
  groupRow(page, name)
    .getByRole("button", { name: "Members", exact: true })
    .click();
const logins = (page: Page) =>
  page
    .locator(".n-data-table-tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelectorAll("td")[1]?.textContent),
    );

test("user group names, empty values and all user columns sort naturally in both directions", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/users");
  await expect(
    page.getByRole("columnheader", { name: /E-mail|Email/ }),
  ).toBeVisible();
  const row = groupRow(page, "User10");
  await expect(row).toContainText("Zulu");
  await expect(row.locator(".user-table-groups .n-tag")).toHaveText([
    "Team 2",
    "Team 10",
  ]);
  expect(
    await row
      .locator(".user-table-groups")
      .evaluate((element) => getComputedStyle(element).flexWrap),
  ).toBe("wrap");
  await page.screenshot({
    path: "output/playwright/group-columns-desktop-light.png",
    animations: "disabled",
  });
  await expect(groupRow(page, "Alpha").getByRole("cell").nth(3)).toHaveText(
    "—",
  );
  const cases: [string, string[], string[]][] = [
    ["Name", ["b", "c", "a", "z"], ["z", "c", "a", "b"]],
    ["Username", ["a", "b", "c", "z"], ["z", "c", "b", "a"]],
    ["Email", ["a", "b", "c", "z"], ["z", "c", "b", "a"]],
    ["Primary group", ["b", "c", "a", "z"], ["z", "c", "a", "b"]],
    ["Additional groups", ["b", "c", "a", "z"], ["z", "a", "c", "b"]],
    ["Sign in", ["c", "a", "b", "z"], ["b", "z", "c", "a"]],
  ];
  for (const [label, ascending, descending] of cases) {
    if (label !== "Name")
      await page
        .getByRole("button", {
          name: `Sort by: ${label} · Ascending`,
          exact: true,
        })
        .click();
    await expect.poll(() => logins(page)).toEqual(ascending);
    const button = page.getByRole("button", {
      name: `Sort by: ${label} · Descending`,
      exact: true,
    });
    await button.focus();
    await button.press("Enter");
    await expect.poll(() => logins(page)).toEqual(descending);
    await expect(
      page
        .getByRole("button", {
          name: `Sort by: ${label} · Ascending`,
          exact: true,
        })
        .locator("xpath=ancestor::th"),
    ).toHaveAttribute("aria-sort", "descending");
    await page
      .getByRole("button", {
        name: `Sort by: ${label} · Ascending`,
        exact: true,
      })
      .press("Space");
    await expect.poll(() => logins(page)).toEqual(ascending);
  }
  await page.reload();
  await expect.poll(() => logins(page)).toEqual(["c", "a", "b", "z"]);
  const beforeRefresh = state.requests.filter(
    (request) => request === "users",
  ).length;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => state.requests.filter((request) => request === "users").length)
    .toBe(beforeRefresh + 1);
  await expect.poll(() => logins(page)).toEqual(["c", "a", "b", "z"]);
  await expect(
    page
      .getByRole("button", {
        name: "Sort by: Sign in · Descending",
        exact: true,
      })
      .locator("xpath=ancestor::th"),
  ).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("link", { name: "Groups", exact: true }).click();
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect.poll(() => logins(page)).toEqual(["b", "c", "a", "z"]);
});

test("group sorting, independent membership paging, empty groups and read-only dialog", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/manage/groups");
  const names = () =>
    page.locator(".n-data-table-tbody tr td:first-child").allTextContents();
  await expect.poll(names).toEqual(["Empty group", "Group 2", "Group 10"]);
  await page
    .getByRole("button", { name: "Sort by: Name · Descending", exact: true })
    .click();
  await expect.poll(names).toEqual(["Group 10", "Group 2", "Empty group"]);
  await page
    .getByRole("button", { name: "Sort by: Name · Ascending", exact: true })
    .click();
  await expect.poll(names).toEqual(["Empty group", "Group 2", "Group 10"]);
  await page
    .getByRole("button", { name: "Sort by: Notes · Ascending", exact: true })
    .click();
  await expect.poll(names).toEqual(["Group 10", "Empty group", "Group 2"]);
  await page
    .getByRole("button", { name: "Sort by: Notes · Descending", exact: true })
    .press("Enter");
  await expect.poll(names).toEqual(["Group 2", "Empty group", "Group 10"]);
  await openMembers(page);
  const dialog = page.getByRole("dialog", {
    name: "Members: Group 10",
    exact: true,
  });
  const primary = dialog.locator('[data-membership="primary"]'),
    additional = dialog.locator('[data-membership="additional"]');
  await expect(primary).toContainText("27 members");
  await expect(additional).toContainText("26 members");
  await primary.getByText("2", { exact: true }).click();
  await expect(primary).toContainText("First primary 26");
  await expect(primary.getByRole("row")).toHaveCount(3);
  await expect(additional).toContainText("First additional 1");
  await additional.getByText("2", { exact: true }).click();
  await expect(additional).toContainText("First additional 26");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await openMembers(page, "Empty group");
  await expect(
    page.getByRole("dialog").getByText("0 members", { exact: true }),
  ).toHaveCount(2);
  expect(state.writes).toEqual([]);
});

test("membership errors retry independently, reopening discards late responses and rights changes close the dialog", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failPrimary = true;
  await page.goto("/manage/groups");
  await openMembers(page);
  const primary = page.locator('[data-membership="primary"]');
  await expect(primary.getByRole("alert")).toContainText(
    "The members could not be loaded.",
  );
  await expect(page.locator('[data-membership="additional"]')).toContainText(
    "26 members",
  );
  state.failPrimary = false;
  await primary.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(primary).toContainText("First primary 1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  state.hold = true;
  await openMembers(page);
  await expect.poll(() => state.pending.length).toBe(2);
  await page.keyboard.press("Escape");
  state.hold = false;
  await openMembers(page, "Group 2");
  await expect(primary).toContainText("Second primary 1");
  for (const release of state.pending.splice(0)) await release();
  await expect(primary).not.toContainText("First primary");
  state.users = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Members", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Groups", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Members", exact: true }),
  ).toHaveCount(0);
  state.admin = true;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Members", exact: true }),
  ).toHaveCount(3);
});

test("membership requests cannot repopulate a closed dialog after navigation or revoked access", async ({
  page,
}) => {
  const state = await fixture(page);
  state.hold = true;
  await page.goto("/manage/users");
  await page.getByRole("link", { name: "Groups", exact: true }).click();
  await openMembers(page);
  await expect.poll(() => state.pending.length).toBe(2);
  state.users = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toBeHidden();
  for (const release of state.pending.splice(0)) await release();
  await expect(page.getByRole("dialog")).toBeHidden();
  state.users = true;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await openMembers(page);
  await expect.poll(() => state.pending.length).toBe(2);
  await page.goBack();
  for (const release of state.pending.splice(0)) await release();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Sort by: Name · Descending",
      exact: true,
    }),
  ).toBeVisible();
});

test("profile members page independently of groups, sort profiles, retry failures and show empty profiles", async ({
  page,
}) => {
  const state = await fixture(page);
  state.admin = true;
  await page.goto("/manage/profiles");
  const names = () =>
    page.locator(".n-data-table-tbody tr td:first-child").allTextContents();
  await expect
    .poll(names)
    .toEqual(["Empty profile", "Profile 2", "Profile 10"]);
  await page
    .getByRole("button", { name: "Sort by: Name · Descending", exact: true })
    .press("Enter");
  await expect
    .poll(names)
    .toEqual(["Profile 10", "Profile 2", "Empty profile"]);
  await page
    .getByRole("button", { name: "Sort by: Name · Ascending", exact: true })
    .press("Space");
  state.failPrimary = true;
  await openMembers(page, "Profile 10");
  const dialog = page.getByRole("dialog", {
    name: "Members: Profile 10",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "The members could not be loaded.",
  );
  state.failPrimary = false;
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog).toContainText("27 members");
  await expect(dialog.locator("[data-membership]")).toHaveCount(1);
  await expect(dialog).toContainText("First profile 1");
  await dialog.getByText("2", { exact: true }).click();
  await expect(dialog).toContainText("First profile 26");
  await expect(dialog.getByRole("row")).toHaveCount(3);
  await page.screenshot({
    path: "output/playwright/profile-members-desktop-light.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await openMembers(page, "Empty profile");
  await expect(page.getByRole("dialog")).toContainText("0 members");
  await expect(
    page.getByRole("dialog").getByText("No entries yet", { exact: true }),
  ).toBeVisible();
  expect(
    state.requests.filter((request) => request.startsWith("profiles/")),
  ).toEqual([
    "profiles/1/members?limit=25&skip=0",
    "profiles/1/members?limit=25&skip=0",
    "profiles/1/members?limit=25&skip=25",
    "profiles/3/members?limit=25&skip=0",
  ]);
  expect(state.writes).toEqual([]);
});

test("late profile replies cannot replace another profile or survive revoked access and navigation", async ({
  page,
}) => {
  const state = await fixture(page);
  state.admin = true;
  await page.goto("/manage/profiles");
  state.hold = true;
  await openMembers(page, "Profile 10");
  await expect.poll(() => state.pending.length).toBe(1);
  await page.keyboard.press("Escape");
  state.hold = false;
  await openMembers(page, "Profile 2");
  await expect(page.getByRole("dialog")).toContainText("Second profile 1");
  for (const release of state.pending.splice(0)) await release();
  await expect(page.getByRole("dialog")).not.toContainText("First profile");
  await page.keyboard.press("Escape");
  state.hold = true;
  await openMembers(page, "Profile 10");
  await expect.poll(() => state.pending.length).toBe(1);
  state.admin = false;
  state.users = false;
  state.revision++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toBeHidden();
  for (const release of state.pending.splice(0)) await release();
  await expect(page.getByRole("dialog")).toBeHidden();
  state.admin = true;
  state.users = true;
  state.revision++;
  await page.goto("/manage/groups");
  await page.getByRole("link", { name: "Profiles", exact: true }).click();
  await openMembers(page, "Profile 10");
  await expect.poll(() => state.pending.length).toBe(1);
  await page.goBack();
  for (const release of state.pending.splice(0)) await release();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Groups", exact: true }),
  ).toBeVisible();
});

test("profile membership dialog supports all locales, both themes and accessible mobile scrolling", async ({
  page,
}) => {
  const state = await fixture(page);
  state.admin = true;
  for (const [index, language] of languages.entries()) {
    state.language = language;
    await page.setViewportSize({ width: index % 2 ? 320 : 390, height: 844 });
    await page.addInitScript(
      (theme) => localStorage.setItem("nodepass-theme", theme),
      index % 2 ? "dark" : "light",
    );
    await page.goto("/manage/profiles");
    const action = groupRow(page, "Profile 10").getByRole("button").first();
    await action.focus();
    await action.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".n-data-table-tbody tr")).toHaveCount(25);
    await expect(dialog.locator("[data-membership]")).toHaveCount(1);
    await expect(dialog).not.toContainText("memberCount");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const region = dialog.locator(".members-table-scroll");
    await region.focus();
    await region.press("ArrowDown");
    await expect
      .poll(() => region.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    if (["de_DE", "en_US", "ja_JP"].includes(language)) {
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
    if (language === "en_US")
      await page.screenshot({
        path: "output/playwright/profile-members-mobile-dark.png",
        animations: "disabled",
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(action).toBeFocused();
  }
});

test("all locales, both themes, keyboard focus, mobile layout and scoped accessibility", async ({
  page,
}) => {
  const state = await fixture(page);
  for (const [index, language] of languages.entries()) {
    state.language = language;
    await page.setViewportSize({ width: index % 2 ? 320 : 390, height: 844 });
    await page.addInitScript(
      (theme) => localStorage.setItem("nodepass-theme", theme),
      index % 2 ? "dark" : "light",
    );
    await page.goto("/manage/groups");
    const button = groupRow(page, "Group 10").getByRole("button").first();
    await expect(button).not.toHaveText("groupMembers");
    await button.focus();
    await button.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.locator('[data-membership="primary"] .n-data-table-tbody tr'),
    ).toHaveCount(25);
    await expect(dialog).not.toContainText("memberCount");
    await expect(dialog).not.toContainText("primaryMembers");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    if (["de_DE", "en_US", "ja_JP"].includes(language)) {
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
    if (language === "de_DE" || language === "en_US")
      await page.screenshot({
        path: `output/playwright/group-members-${language}-${index % 2 ? "dark" : "light"}.png`,
        animations: "disabled",
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await page.goto("/manage/users");
    await expect(page.getByRole("columnheader")).toHaveCount(7);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (language === "en_US") {
      const audit = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
    }
  }
});
