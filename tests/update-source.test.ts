import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  isReleaseVersion,
  validateReleaseSecurity,
} from "../packages/contracts/src/updates.js";
import {
  UpdateSource,
  releaseUrl,
  type KnownRelease,
} from "../packages/server/src/services/update-source.js";
import { updateFixture, securityFixture } from "./update-fixtures.js";

const signal = () => new AbortController().signal;
const json = (value: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(value), { headers });
function sourceFor(f = updateFixture()) {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes("/assets/")
        ? new Response(f.data)
        : json([f.row], { etag: '"page-1"' }),
    );
  return { source: new UpdateSource(request, () => 1000), request, f };
}

describe("release versions and explicit security metadata", () => {
  it("orders numeric versions and release candidates without lossy integer conversion", () => {
    const ordered = [
      "0.1.0-rc.1",
      "0.1.0-rc.2",
      "0.1.0-rc.10",
      "0.1.0",
      "0.2.0",
      "1.0.0",
      "2.0.0",
      "999999999999999999.0.0",
    ];
    for (const [i, a] of ordered.entries())
      for (const [j, b] of ordered.entries())
        expect(compareVersions(a, b)).toBe(Math.sign(i - j));
    for (const v of [
      null,
      "01.0.0",
      "1.0",
      "1.0.0-rc.0",
      "1.0.0-rc.01",
      "1.0.0+test",
      "1.0.0\nx",
      "1.0.0\n",
      "1".repeat(81),
    ]) {
      expect(isReleaseVersion(v)).toBe(false);
      expect(() => compareVersions(v as string, "1.0.0")).toThrow();
    }
    expect(() => releaseUrl("javascript:alert(1)")).toThrow();
  });
  it("requires unique identifiers and sorted nonempty half-open intervals bounded by the release", () => {
    expect(validateReleaseSecurity(securityFixture, "0.3.0")).toEqual(
      securityFixture,
    );
    expect(
      validateReleaseSecurity(
        { format: "nodepass-security-1", fixes: [] },
        "0.3.0",
      ).fixes,
    ).toEqual([]);
    const fix = securityFixture.fixes[0]!;
    for (const data of [
      null,
      {},
      { ...securityFixture, extra: true },
      { ...securityFixture, fixes: Array(2001).fill(fix) },
      { ...securityFixture, fixes: [fix, fix] },
      { ...securityFixture, fixes: [null] },
      ...["", "bad\r\n", "../path"].map((id) => ({
        ...securityFixture,
        fixes: [{ ...fix, id }],
      })),
      ...[
        [],
        [{ introduced: "0.2.0", fixed: "0.2.0" }],
        [{ introduced: "bad", fixed: "0.2.0" }],
        [{ introduced: "0.1.0", fixed: "0.4.0" }],
        Array(21).fill(fix.affected[0]),
        [
          { introduced: "0.1.0", fixed: "0.3.0" },
          { introduced: "0.2.0", fixed: "0.3.0" },
        ],
        [{ introduced: "0.1.0", fixed: "0.2.0", extra: true }],
        [null],
      ].map((affected) => ({
        ...securityFixture,
        fixes: [{ ...fix, affected }],
      })),
    ])
      expect(() => validateReleaseSecurity(data, "0.3.0")).toThrow();
  });
});

describe("bounded official GitHub update source", () => {
  it("selects the highest eligible version and uses credential-free conditional requests", async () => {
    const { source, request, f } = sourceFor();
    request.mockResolvedValueOnce(
      json(
        [
          updateFixture("0.4.0-rc.1").row,
          f.row,
          { draft: true },
          { tag_name: "other" },
        ],
        { etag: '"page-1"' },
      ),
    );
    const result = await source.check("0.1.0", null, {}, signal());
    expect(result.latest?.release.version).toBe("0.3.0");
    expect(result.latest?.security).toEqual(securityFixture);
    expect(request.mock.calls[0]![0]).toBe(
      "https://api.github.com/repos/sapientorius/nodePass/releases?per_page=100&page=1",
    );
    expect(request.mock.calls[0]![1]).toMatchObject({
      redirect: "manual",
      credentials: "omit",
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain("Authorization");
    request.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect(
      (await source.check("0.1.0", result.latest, result.cache, signal()))
        .latest,
    ).toEqual(result.latest);
    expect(request.mock.calls[2]![1]!.headers).toMatchObject({
      "If-None-Match": '"page-1"',
    });
    expect(request).toHaveBeenCalledTimes(3);
    const rc = sourceFor(updateFixture("0.4.0-rc.10"));
    expect(
      (await rc.source.check("0.4.0-rc.2", null, {}, signal())).latest?.release
        .version,
    ).toBe("0.4.0-rc.10");
    expect((await source.check("0.3.0", null, {}, signal())).latest).toBeNull();
  });
  it("paginates even when a full page contains ignored tags and preserves its cached length", async () => {
    const { source, request, f } = sourceFor();
    request
      .mockResolvedValueOnce(json(Array(100).fill({ tag_name: "ignored" })))
      .mockResolvedValueOnce(json([f.row]));
    const first = await source.check("0.1.0", null, {}, signal());
    expect(first.cache["1"]!.count).toBe(100);
    request
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    await source.check("0.1.0", first.latest, first.cache, signal());
    expect(request).toHaveBeenCalledTimes(5);
    request.mockImplementation(async () =>
      json(Array(100).fill({ tag_name: "ignored" })),
    );
    await expect(
      source.check("0.1.0", null, {}, signal()),
    ).rejects.toMatchObject({ code: "invalid" });
  });
  it("rejects mutable releases, ambiguous identities, missing hashes and unexpected manifest sources", async () => {
    const badRows = [
      null,
      { ...updateFixture().row, id: 0 },
      { ...updateFixture().row, draft: "false" },
      { ...updateFixture().row, prerelease: true },
      { ...updateFixture().row, html_url: "https://evil.test" },
      { ...updateFixture().row, immutable: false },
      { ...updateFixture().row, assets: [] },
      {
        ...updateFixture().row,
        assets: [updateFixture().row.assets[0], updateFixture().row.assets[0]],
      },
      ...[
        { id: -1 },
        { size: 0 },
        { size: 1024 ** 2 + 1 },
        { digest: "untrusted" },
      ].map((a) => ({
        ...updateFixture().row,
        assets: [{ ...updateFixture().row.assets[0], ...a }],
      })),
    ];
    for (const row of badRows) {
      const { source, request } = sourceFor();
      request.mockResolvedValueOnce(json([row]));
      await expect(
        source.check("0.1.0", null, {}, signal()),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    for (const value of [
      {},
      Array(101).fill({}),
      [updateFixture().row, updateFixture().row],
    ]) {
      const { source, request } = sourceFor();
      request.mockResolvedValueOnce(json(value));
      await expect(
        source.check("0.1.0", null, {}, signal()),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    for (const change of [
      { version: "9.0.0" },
      { source: { repository: "evil/repo" } },
      { security: {} },
      { format: "other" },
    ]) {
      const f = updateFixture();
      Object.assign(f.manifest, change);
      f.data = Buffer.from(JSON.stringify(f.manifest));
      const { createHash } = await import("node:crypto");
      f.row.assets[0]!.size = f.data.length;
      f.row.assets[0]!.digest =
        "sha256:" + createHash("sha256").update(f.data).digest("hex");
      await expect(
        sourceFor(f).source.check("0.1.0", null, {}, signal()),
      ).rejects.toThrow();
    }
  });
  it("limits redirects to one HTTPS GitHub asset host and verifies exact bytes", async () => {
    const { source, request, f } = sourceFor();
    request
      .mockResolvedValueOnce(json([f.row]))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/asset?token=synthetic",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(f.data));
    expect(
      (await source.check("0.1.0", null, {}, signal())).latest,
    ).not.toBeNull();
    expect(request.mock.calls[2]![1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
    expect(request.mock.calls[2]![1]!.headers).toBeUndefined();
    for (const location of [
      "https://evil.test/file",
      "http://release-assets.githubusercontent.com/file",
      "https://user@release-assets.githubusercontent.com/file",
      "https://release-assets.githubusercontent.com:444/file",
      "https://release-assets.githubusercontent.com/file#hash",
    ]) {
      request
        .mockResolvedValueOnce(json([f.row]))
        .mockResolvedValueOnce(
          new Response(null, { status: 302, headers: { location } }),
        );
      await expect(
        source.check("0.1.0", null, {}, signal()),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    for (const response of [
      new Response("tampered"),
      new Response("x", { status: 404 }),
      new Response(null, { status: 204 }),
      new Response("x", {
        headers: { "content-length": String(1024 ** 2 + 1) },
      }),
      new Response("x".repeat(1024 ** 2 + 1)),
    ]) {
      request
        .mockResolvedValueOnce(json([f.row]))
        .mockResolvedValueOnce(response);
      await expect(source.check("0.1.0", null, {}, signal())).rejects.toThrow();
    }
  });
  it("retains monotonic release identities and cumulative security information", async () => {
    const { source, request } = sourceFor();
    const known = (await source.check("0.1.0", null, {}, signal())).latest!;
    const missing = sourceFor(
      updateFixture("0.4.0", { format: "nodepass-security-1", fixes: [] }),
    );
    await expect(
      missing.source.check("0.1.0", known, {}, signal()),
    ).rejects.toMatchObject({ code: "invalid" });
    request.mockResolvedValueOnce(json([]));
    await expect(
      source.check("0.1.0", known, {}, signal()),
    ).rejects.toMatchObject({ code: "invalid" });
    const changed = structuredClone(known);
    changed.release.asset!.digest = "sha256:" + "0".repeat(64);
    await expect(
      source.check("0.1.0", changed, {}, signal()),
    ).rejects.toMatchObject({ code: "invalid" });
    const priorRc = {
      ...known,
      release: { ...known.release, version: "0.4.0-rc.1" },
    } as KnownRelease;
    expect(
      (await source.check("0.3.0", priorRc, {}, signal())).latest,
    ).toBeNull();
  });
  it("respects polling and rate-limit headers and rejects failed/list-body responses", async () => {
    const { source, request, f } = sourceFor();
    request.mockResolvedValueOnce(json([f.row], { "x-poll-interval": "7200" }));
    expect((await source.check("0.1.0", null, {}, signal())).nextCheckAt).toBe(
      7201000,
    );
    for (const headers of [
      { "retry-after": "7200" },
      { "retry-after": new Date(7201000).toUTCString() },
      { "x-ratelimit-reset": "7201" },
    ]) {
      request.mockResolvedValueOnce(
        new Response(null, { status: 429, headers }),
      );
      await expect(
        source.check("0.1.0", null, {}, signal()),
      ).rejects.toMatchObject({
        code: "rate-limited",
        retryAt: expect.any(Number),
      });
    }
    for (const response of [
      new Response(null, { status: 500 }),
      new Response(null, { status: 304 }),
      new Response(null, { status: 204 }),
      new Response("bad JSON"),
      new Response("x", {
        headers: { "content-length": String(2 * 1024 ** 2 + 1) },
      }),
    ]) {
      request.mockResolvedValueOnce(response);
      await expect(source.check("0.1.0", null, {}, signal())).rejects.toThrow();
    }
  });
});
