import { describe, expect, it, vi } from "vitest";
import { refreshReleaseHistory } from "../packages/server/src/services/release-history.js";
import {
  UpdateFailure,
  UpdateSource,
  type ReleaseCache,
  type KnownRelease,
} from "../packages/server/src/services/update-source.js";
import { updateFixture } from "./update-fixtures.js";
const signal = () => new AbortController().signal;
const now = () => 1700000000000;
function fixture(versions: string[]) {
  const files = versions.map((v, i) => {
    const f = updateFixture(v, { format: "nodepass-security-1", fixes: [] });
    f.row.id = i + 1;
    f.row.assets[0]!.id = i + 1000;
    return f;
  });
  const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    const asset = /\/assets\/(\d+)$/.exec(String(url));
    return asset
      ? new Response(
          files.find((f) => f.row.assets[0]!.id === Number(asset[1]))!.data,
        )
      : new Response(JSON.stringify(files.map((f) => f.row)), {
          headers: { etag: '"test"' },
        });
  });
  const source = new UpdateSource(request, now);
  return { source, request, files };
}
const refresh = (
  source: UpdateSource,
  installed: string,
  cache: ReleaseCache,
  latest: KnownRelease | null,
  budget = 10,
) =>
  refreshReleaseHistory(
    source,
    installed,
    cache,
    null,
    latest,
    budget,
    signal(),
    now,
  );

describe("verified release information", () => {
  it("bounds serialized historical text without blocking the security decision", async () => {
    const f = fixture(Array.from({ length: 45 }, (_, i) => `0.${i + 1}.0`));
    for (const file of f.files) file.row.body = "\u0001".repeat(64 * 1024);
    const request = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (url, options) => {
      if (String(url).includes("/assets/")) return request(url, options);
      const page = Number(new URL(String(url)).searchParams.get("page"));
      const rows: object[] = f.files
        .slice((page - 1) * 5, page * 5)
        .map((file) => file.row);
      if (page < 9) rows.push(...Array(95).fill({ tag_name: "ignored" }));
      return new Response(JSON.stringify(rows));
    });
    const checked = await f.source.check("0.1.0", null, {}, signal());
    expect(checked.latest?.release.version).toBe("0.45.0");
    const releases = Object.values(checked.cache).flatMap(
      (page) => page.releases,
    );
    expect(releases.find((r) => r.version === "0.1.0")!.notes).not.toBeNull();
    expect(releases.find((r) => r.version === "0.45.0")!.notes).not.toBeNull();
    expect(releases.find((r) => r.version === "0.2.0")!.notes).toBeNull();
    expect(
      releases.reduce(
        (sum, r) => sum + Buffer.byteLength(JSON.stringify(r.notes ?? null)),
        0,
      ),
    ).toBeLessThan(4 * 1024 ** 2 + 1000);
  });
  it("includes the installed release and intermediate releases while respecting the channel", async () => {
    const f = fixture(["0.1.0", "0.2.0", "0.3.0", "0.4.0-rc.1"]);
    const checked = await f.source.check("0.1.0", null, {}, signal());
    const history = await refresh(
      f.source,
      "0.1.0",
      checked.cache,
      checked.latest,
      10 - checked.manifestFetches,
    );
    expect(history.latestVersion).toBe("0.3.0");
    expect(history.installedPublished).toBe(true);
    expect(Object.keys(history.entries).sort()).toEqual([
      "0.1.0",
      "0.2.0",
      "0.3.0",
    ]);
    expect(
      Object.values(history.entries).every(
        (e) => e.info.notesStatus === "verified",
      ),
    ).toBe(true);
    expect(history.entries["0.3.0"]!.info.notes).toBe(f.files[2]!.row.body);
    expect(
      f.request.mock.calls.filter((c) => String(c[0]).includes("/assets/")),
    ).toHaveLength(3);
    const rcCheck = await f.source.check(
      "0.2.0-rc.1",
      null,
      checked.cache,
      signal(),
    );
    const rc = await refresh(
      f.source,
      "0.2.0-rc.1",
      rcCheck.cache,
      rcCheck.latest,
    );
    expect(rc.latestVersion).toBe("0.4.0-rc.1");
    expect(rc.installedPublished).toBe(false);
    expect(rc.entries["0.4.0-rc.1"]!.info.notesStatus).toBe("verified");
  });
  it("identifies the latest published release when already current or ahead of publication", async () => {
    const f = fixture(["0.1.0", "0.2.0"]);
    const checked = await f.source.check("0.2.0", null, {}, signal());
    expect(checked.latest).toBeNull();
    const current = await refresh(
      f.source,
      "0.2.0",
      checked.cache,
      checked.latest,
    );
    expect(current.latestVersion).toBe("0.2.0");
    expect(current.installedPublished).toBe(true);
    expect(Object.keys(current.entries)).toEqual(["0.2.0"]);
    const development = await refresh(
      f.source,
      "0.3.0-rc.1",
      checked.cache,
      null,
    );
    expect(development.latestVersion).toBe("0.2.0");
    expect(development.installedPublished).toBe(false);
    expect(development.entries).toEqual({});
  });
  it("verifies legacy manifests without a security catalogue and compares exact UTF-8 bytes", async () => {
    const f = fixture(["0.2.0"]);
    const checked = await f.source.check("0.2.0", null, {}, signal());
    const release = checked.cache["1"]!.releases[0]!;
    const manifest = vi
      .spyOn(f.source, "manifest")
      .mockResolvedValue({ notesSha256: f.files[0]!.manifest.notesSha256 });
    release.notes = "# Unicode ü 日本語\r\n\n";
    const { createHash } = await import("node:crypto");
    manifest.mockResolvedValue({
      notesSha256: createHash("sha256")
        .update(release.notes, "utf8")
        .digest("hex"),
    });
    expect(
      (await refresh(f.source, "0.2.0", checked.cache, null)).entries["0.2.0"]!
        .info.notesStatus,
    ).toBe("verified");
    release.notes = release.notes.replace("\r\n", "\n");
    expect(
      (await refresh(f.source, "0.2.0", checked.cache, null)).entries["0.2.0"]!
        .info,
    ).toMatchObject({ notes: null, notesStatus: "mismatch" });
  });
  it("keeps the verified text on edits and caches manifests by immutable identity", async () => {
    const f = fixture(["0.2.0"]);
    const checked = await f.source.check("0.2.0", null, {}, signal());
    const first = await refresh(f.source, "0.2.0", checked.cache, null);
    f.request.mockClear();
    checked.cache["1"]!.releases[0]!.notes = "Unverified replacement";
    const next = await refreshReleaseHistory(
      f.source,
      "0.2.0",
      checked.cache,
      first,
      null,
      10,
      signal(),
      now,
    );
    expect(next.entries["0.2.0"]!.info).toMatchObject({
      notes: f.files[0]!.row.body,
      notesStatus: "mismatch",
      verifiedAt: now(),
    });
    expect(f.request).not.toHaveBeenCalled();
    checked.cache["1"]!.releases[0]!.asset!.digest = "sha256:" + "0".repeat(64);
    const changed = await refreshReleaseHistory(
      f.source,
      "0.2.0",
      checked.cache,
      first,
      null,
      10,
      signal(),
      now,
    );
    expect(changed.entries["0.2.0"]!.info).toMatchObject({
      notes: f.files[0]!.row.body,
      notesStatus: "unavailable",
    });
    expect(f.request).not.toHaveBeenCalled();
  });
  it("caps the shared manifest budget and gives installed information priority after the update check", async () => {
    const f = fixture(Array.from({ length: 15 }, (_, i) => `0.${i + 1}.0`));
    const checked = await f.source.check("0.1.0", null, {}, signal());
    const first = await refresh(
      f.source,
      "0.1.0",
      checked.cache,
      checked.latest,
      10 - checked.manifestFetches,
    );
    expect(
      f.request.mock.calls.filter((c) => String(c[0]).includes("/assets/")),
    ).toHaveLength(10);
    expect(first.entries["0.1.0"]!.info.notesStatus).toBe("verified");
    expect(first.entries["0.2.0"]!.info.notesStatus).toBe("pending");
    const next = await refreshReleaseHistory(
      f.source,
      "0.1.0",
      checked.cache,
      first,
      checked.latest,
      10,
      signal(),
      now,
    );
    expect(
      Object.values(next.entries).every(
        (e) => e.info.notesStatus === "verified",
      ),
    ).toBe(true);
    expect(
      f.request.mock.calls.filter((c) => String(c[0]).includes("/assets/")),
    ).toHaveLength(15);
  });
  it("handles missing manifests, invalid hashes, oversized text, mutable releases and retryable outages", async () => {
    const f = fixture(["0.2.0"]);
    const checked = await f.source.check("0.2.0", null, {}, signal());
    const release = checked.cache["1"]!.releases[0]!;
    for (const overrides of [
      { immutable: false },
      { asset: null },
      { notes: null },
    ]) {
      const cache = {
        "1": {
          ...checked.cache["1"]!,
          releases: [{ ...release, ...overrides }],
        },
      };
      expect(
        (await refresh(f.source, "0.2.0", cache, null)).entries["0.2.0"]!.info
          .notesStatus,
      ).toBe("unavailable");
    }
    const manifest = vi.spyOn(f.source, "manifest");
    for (const data of [
      {},
      { notesSha256: "bad" },
      { notesSha256: "a".repeat(64) + "\n" },
    ]) {
      manifest.mockResolvedValueOnce(data);
      expect(
        (await refresh(f.source, "0.2.0", checked.cache, null)).entries[
          "0.2.0"
        ]!.info.notesStatus,
      ).toBe("unavailable");
    }
    manifest.mockRejectedValueOnce(new Error("temporary failure"));
    expect(
      (await refresh(f.source, "0.2.0", checked.cache, null)).entries["0.2.0"]!
        .info.notesStatus,
    ).toBe("unavailable");
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await refreshReleaseHistory(
          f.source,
          "0.2.0",
          checked.cache,
          null,
          null,
          10,
          controller.signal,
          now,
        )
      ).entries["0.2.0"]!.info.notesStatus,
    ).toBe("pending");
  });
  it("stops further historical requests after rate limiting and reports the retry time", async () => {
    const f = fixture(["0.1.0", "0.2.0", "0.3.0"]);
    const checked = await f.source.check("0.1.0", null, {}, signal());
    const manifest = vi
      .spyOn(f.source, "manifest")
      .mockRejectedValueOnce(
        new UpdateFailure("rate-limited", now() + 7200000),
      );
    const history = await refresh(
      f.source,
      "0.1.0",
      checked.cache,
      checked.latest,
      9,
    );
    expect(history.error).toBe("rate-limited");
    expect(history.retryAt).toBe(now() + 7200000);
    expect(manifest).toHaveBeenCalledOnce();
    expect(history.entries["0.2.0"]!.info.notesStatus).toBe("pending");
    expect(history.entries["0.3.0"]!.info.notesStatus).toBe("verified");
  });
  it("refreshes legacy page caches without sending an old ETag and accepts changed release text identities", async () => {
    const f = fixture(["0.3.0"]);
    const old: ReleaseCache = {
      "1": {
        etag: '"old"',
        count: 1,
        releases: [
          {
            version: "0.3.0",
            id: 1,
            immutable: true,
            asset: f.files[0]!.row.assets[0]!,
          },
        ],
      },
    };
    const checked = await f.source.check("0.1.0", null, old, signal());
    expect(f.request.mock.calls[0]![1]!.headers).not.toHaveProperty(
      "If-None-Match",
    );
    f.files[0]!.row.body = "Edited title and body";
    const next = await f.source.check(
      "0.1.0",
      checked.latest,
      checked.cache,
      signal(),
    );
    expect(next.latest).toEqual(checked.latest);
    expect(next.cache["1"]!.releases[0]!.notes).toBe("Edited title and body");
    // Missing/oversized bodies affect history, never the release's security decision.
    f.files[0]!.row.body = "x".repeat(128 * 1024 + 1);
    const oversized = await f.source.check(
      "0.1.0",
      next.latest,
      next.cache,
      signal(),
    );
    expect(oversized.latest).toEqual(next.latest);
    expect(oversized.cache["1"]!.releases[0]!.notes).toBeNull();
  });
});
