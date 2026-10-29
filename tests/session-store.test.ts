import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Viewer } from "@nodepass/contracts";
import {
  cancelConfirmation,
  confirmAction,
  ActionCancelled,
} from "../packages/web/src/confirmation";
import { setCsrf } from "../packages/web/src/api";

let useSession: typeof import("../packages/web/src/stores/session").useSession;
let useAccounts: typeof import("../packages/web/src/stores/accounts").useAccounts;
const fetcher = vi.fn<typeof fetch>();
const viewer = (
  patch: Partial<Viewer & { phase: string }> = {},
): Viewer & { phase: string } => ({
  id: 1,
  name: "Synthetic user",
  login: "synthetic",
  isAdmin: false,
  isAppAdmin: false,
  isAccountAdmin: false,
  directory: false,
  needsMfa: false,
  language: "en_US",
  csrf: "synthetic-csrf",
  permissions: { accView: true },
  phase: "ready",
  accessRevision: "initial",
  ...patch,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  cancelConfirmation();
  setCsrf("");
  setActivePinia(createPinia());
  ({ useSession } = await import("../packages/web/src/stores/session"));
  ({ useAccounts } = await import("../packages/web/src/stores/accounts"));
});
afterEach(() => {
  cancelConfirmation();
  vi.unstubAllGlobals();
});

it("coalesces concurrent refreshes and keeps unchanged rights and confirmation drafts intact", async () => {
  const session = useSession();
  session.accept(viewer());
  const accounts = useAccounts();
  accounts.search = "retained";
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = session.refresh(),
    second = session.refresh();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const pending = confirmAction().catch((error: unknown) => error);
  finish(response(viewer({ name: "Renamed user", login: "renamed" })));
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(session.viewer?.login).toBe("renamed");
  expect(session.accessEpoch).toBe(0);
  expect(accounts.search).toBe("retained");
  cancelConfirmation();
  expect(await pending).toBeInstanceOf(ActionCancelled);
});

it("a committed save requests a new snapshot and ignores an older in-flight refresh", async () => {
  const session = useSession();
  session.accept(viewer());
  let finish!: (response: Response) => void;
  fetcher
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response(viewer({ login: "after-save" })));
  const stale = session.refresh();
  expect(await session.refresh(true)).toBe(true);
  finish(response(viewer({ login: "before-save" })));
  expect(await stale).toBe(false);
  expect(session.viewer?.login).toBe("after-save");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(["logout", "new login"])(
  "a late snapshot cannot resurrect or replace a session after %s",
  async (reason) => {
    const session = useSession();
    session.accept(viewer());
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = session.refresh();
    session.clear();
    if (reason === "new login")
      session.accept(viewer({ id: 2, csrf: "new-synthetic-csrf" }));
    finish(response(viewer()));
    expect(await pending).toBe(false);
    expect(session.viewer?.id ?? null).toBe(reason === "new login" ? 2 : null);
  },
);

it("access changes discard cached accounts and waiting confirmations but retain filters and sort", async () => {
  const session = useSession();
  session.accept(viewer());
  const accounts = useAccounts();
  accounts.search = "retained";
  accounts.sort = "login";
  accounts.sortDirection = "desc";
  accounts.total = 5;
  const pending = confirmAction().catch((error: unknown) => error);
  fetcher.mockResolvedValueOnce(
    response(viewer({ accessRevision: "different-group" })),
  );
  expect(await session.refresh()).toBe(true);
  expect(await pending).toBeInstanceOf(ActionCancelled);
  expect(accounts.total).toBe(0);
  expect([accounts.search, accounts.sort, accounts.sortDirection]).toEqual([
    "retained",
    "login",
    "desc",
  ]);
  expect(session.accessEpoch).toBe(1);
  expect(session.accessNotice).toBe(true);
});

it("completing MFA changes the view context without claiming that permissions changed", () => {
  const session = useSession();
  session.accept(viewer({ phase: "enroll", needsMfa: true }));
  session.accept(viewer());
  expect(session.accessEpoch).toBe(1);
  expect(session.accessNotice).toBe(false);
});

it.each(["network", "server", "expired"])(
  "handles %s refresh failures without false authentication transitions",
  async (failure) => {
    const session = useSession();
    session.accept(viewer());
    if (failure === "network")
      fetcher.mockRejectedValueOnce(new TypeError("Synthetic network failure"));
    else
      fetcher.mockResolvedValueOnce(
        response(
          { message: "Synthetic failure" },
          failure === "server" ? 500 : 401,
        ),
      );
    expect(await session.refresh()).toBe(false);
    expect(session.viewer?.id ?? null).toBe(failure === "expired" ? null : 1);
    if (failure !== "expired") expect(session.error).toContain("Synthetic");
  },
);
