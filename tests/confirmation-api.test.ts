import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, download, setCsrf } from "../packages/web/src/api";
import {
  ActionCancelled,
  cancelConfirmation,
  confirmation,
  finishConfirmation,
} from "../packages/web/src/confirmation";

const required = () =>
  new Response(
    JSON.stringify({
      message: "Confirm your identity again",
      code: "REAUTHENTICATION_REQUIRED",
    }),
    { status: 403 },
  );
const accepted = () => new Response(JSON.stringify({ saved: true }));
const fetcher = vi.fn<typeof fetch>();
const open = () => vi.waitFor(() => expect(confirmation.open).toBe(true));
const complete = () => finishConfirmation(confirmation.revision);

beforeEach(() => {
  cancelConfirmation();
  setCsrf("synthetic-csrf");
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  cancelConfirmation();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("confirmation and bounded request replay", () => {
  it.each([
    ["accounts/1/secret", undefined, 1],
    ["auth/password", "MFA_REQUIRED", 1],
    ["auth/session", undefined, 0],
    ["auth/confirm", "CONFIRMATION_INVALID", 0],
  ])(
    "refreshes once without replay or recursive auth refresh for %s (%s)",
    async (path, code, count) => {
      const refresh = vi.fn();
      window.addEventListener("nodepass-refresh", refresh);
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: "Denied", ...(code ? { code } : {}) }),
          { status: 403 },
        ),
      );
      await expect(api(path as string, "POST", {})).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(refresh).toHaveBeenCalledTimes(Number(count));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(confirmation.open).toBe(false);
    },
  );
  it("pauses and replays the exact submitted body and headers once", async () => {
    fetcher.mockResolvedValueOnce(required()).mockResolvedValueOnce(accepted());
    const data = { minLength: 12, nested: { value: "original" } };
    const headers = { "x-test": "original" };
    const promise = api("security", "PATCH", data, headers);
    await open();
    data.minLength = 15;
    data.nested.value = "changed";
    headers["x-test"] = "changed";
    complete();
    await expect(promise).resolves.toEqual({ saved: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0]);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      minLength: 12,
      nested: { value: "original" },
    });
  });
  it("shares one dialog between concurrent requests, including a delayed original denial", async () => {
    let deny!: (response: Response) => void;
    fetcher
      .mockResolvedValueOnce(required())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            deny = resolve;
          }),
      )
      .mockImplementation(async () => accepted());
    const first = api("security", "PATCH", {});
    const second = api("account-access", "PATCH", {});
    await open();
    const revision = confirmation.revision;
    complete();
    await first;
    deny(required());
    await expect(second).resolves.toEqual({ saved: true });
    expect(confirmation.revision).toBe(revision);
    expect(confirmation.open).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("shares an open dialog and rejects every waiter on cancellation", async () => {
    fetcher.mockImplementation(async () => required());
    const first = api("one", "POST", {}).catch((error: unknown) => error);
    const second = api("two", "POST", {}).catch((error: unknown) => error);
    await open();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const revision = confirmation.revision;
    cancelConfirmation();
    finishConfirmation(revision);
    expect(await first).toBeInstanceOf(ActionCancelled);
    expect(await second).toBeInstanceOf(ActionCancelled);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["navigation", "logout", "another session"])(
    "discards a waiting action after %s",
    async (reason) => {
      fetcher.mockResolvedValue(required());
      const outcome = api("security", "PATCH", {}).catch(
        (error: unknown) => error,
      );
      await open();
      const revision = confirmation.revision;
      if (reason === "navigation") cancelConfirmation();
      else setCsrf(reason === "logout" ? "" : "other-synthetic-csrf");
      finishConfirmation(revision);
      expect(await outcome).toBeInstanceOf(ActionCancelled);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("ignores an initial denial that arrives after navigation", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const outcome = api("security", "PATCH", {}).catch(
      (error: unknown) => error,
    );
    cancelConfirmation();
    resolve(required());
    expect(await outcome).toBeInstanceOf(ActionCancelled);
    expect(confirmation.open).toBe(false);
  });
  it("does not loop when the replay still requires confirmation", async () => {
    fetcher.mockImplementation(async () => required());
    const outcome = api("security", "PATCH", {}).catch(
      (error: unknown) => error,
    );
    await open();
    complete();
    expect(await outcome).toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(confirmation.open).toBe(false);
  });
  it("never opens a nested dialog for confirmation endpoints", async () => {
    fetcher.mockResolvedValue(required());
    await expect(
      api("auth/confirm", "POST", { password: "synthetic" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      api("auth/confirm/passkey-options", "POST", {}),
    ).rejects.toBeInstanceOf(ApiError);
    expect(confirmation.open).toBe(false);
  });
  it("keeps ordinary permission and network errors out of the confirmation flow", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    );
    await expect(api("security", "PATCH", {})).rejects.toMatchObject({
      failure: { message: "Forbidden" },
    });
    fetcher.mockRejectedValueOnce(new TypeError("Synthetic network failure"));
    await expect(api("security", "PATCH", {})).rejects.toThrow(
      "network failure",
    );
    expect(confirmation.open).toBe(false);
  });
  it("discards a late response body after the context changes", async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        new Promise((done) => {
          resolve = done;
        }),
    } as Response);
    const outcome = api("security").catch((error: unknown) => error);
    await vi.waitFor(() => expect(resolve).toBeDefined());
    cancelConfirmation();
    resolve({ saved: true });
    expect(await outcome).toBeInstanceOf(ActionCancelled);
  });
  it("only expires the current session, never a late response from an old one", async () => {
    const expired = vi.fn();
    window.addEventListener("nodepass-expired", expired);
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Session expired" }), {
        status: 401,
      }),
    );
    await expect(api("security")).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const outcome = api("security").catch((error: unknown) => error);
    setCsrf("other-synthetic-csrf");
    resolve(new Response("{}", { status: 401 }));
    expect(await outcome).toBeInstanceOf(ActionCancelled);
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it.each(["GET", "POST"])(
    "confirms and downloads through the same transport using %s",
    async (method) => {
      const click = vi.fn();
      const anchor = { href: "", download: "", click };
      vi.stubGlobal("document", { createElement: () => anchor });
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      fetcher.mockResolvedValueOnce(required()).mockResolvedValueOnce(
        new Response("synthetic download", {
          headers: {
            "content-disposition": 'attachment; filename="nodepass-test.npb"',
          },
        }),
      );
      const promise = download(
        "backups/test",
        method === "GET" ? undefined : { format: "syspass" },
        method,
      );
      await open();
      expect(click).not.toHaveBeenCalled();
      complete();
      await promise;
      expect(click).toHaveBeenCalledTimes(1);
      expect(anchor.download).toBe("nodepass-test.npb");
      expect(fetcher.mock.calls[1]![1]!.method).toBe(method);
    },
  );
});
