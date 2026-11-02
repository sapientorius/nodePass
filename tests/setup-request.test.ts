import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, setCsrf } from "../packages/web/src/api";
import { setupRequest } from "../packages/web/src/setup-request";
import { setupErrorMessage } from "../packages/web/src/setup-errors";
import { cancelConfirmation } from "../packages/web/src/confirmation";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  setCsrf("");
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["setup/import", "setup/jobs/synthetic-job"])(
  "ends a stalled %s exchange with an explicit uncertain-outcome error and no retry",
  async (path) => {
    let signal!: AbortSignal;
    fetcher.mockImplementationOnce((_url, options) => {
      signal = options!.signal!;
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    });
    const pending = setupRequest(
      path,
      path.endsWith("import") ? "POST" : "GET",
      undefined,
      { "x-setup-token": "synthetic-setup-token" },
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(59999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const failure = await pending;
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).failure.code).toBe("SETUP_RESPONSE_TIMEOUT");
    expect((failure as ApiError).message).toContain("may still be processing");
    expect(setupErrorMessage((failure as ApiError).failure, "de_DE")).toContain(
      "noch laufen",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("clears the deadline after a queued job and keeps authorization headers", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ job: "synthetic-job" }), { status: 202 }),
  );
  expect(
    await setupRequest(
      "setup/import",
      "POST",
      { dump: "synthetic dump" },
      { "x-setup-token": "synthetic-setup-token" },
    ),
  ).toEqual({ job: "synthetic-job" });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/setup/import",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "x-setup-token": "synthetic-setup-token",
      }),
      signal: expect.any(AbortSignal),
    }),
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a server failure and clears its deadline", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        code: "DUMP_SYNTAX",
        message: "Synthetic invalid dump",
      }),
      { status: 400 },
    ),
  );
  await expect(setupRequest("setup/import", "POST", {})).rejects.toMatchObject({
    status: 400,
    failure: { code: "DUMP_SYNTAX" },
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("blocks the browser workspace when a stale app reports a changed installation", async () => {
  const blocked = vi.fn();
  const maintenance = vi.fn();
  window.addEventListener("nodepass-maintenance", maintenance);
  window.addEventListener("nodepass-restart-required", () => {
    blocked();
    cancelConfirmation();
  });
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        code: "SETUP_STATE_CHANGED",
        message: "Restart this app",
      }),
      { status: 503 },
    ),
  );
  await expect(setupRequest("status")).rejects.toMatchObject({
    status: 503,
    failure: { code: "SETUP_STATE_CHANGED" },
  });
  expect(blocked).toHaveBeenCalledTimes(1);
  expect(maintenance).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a response body that stalls after its headers arrive", async () => {
  fetcher.mockImplementationOnce(async (_url, options) => {
    const response = new Response("{}");
    vi.spyOn(response, "json").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener(
            "abort",
            () => reject(options!.signal!.reason),
            { once: true },
          ),
        ),
    );
    return response;
  });
  const pending = setupRequest("setup/jobs/synthetic-job").catch(
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(60000);
  expect(await pending).toMatchObject({
    failure: { code: "SETUP_RESPONSE_TIMEOUT" },
  });
  expect(vi.getTimerCount()).toBe(0);
});
