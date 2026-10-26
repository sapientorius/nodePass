import { createHash } from "node:crypto";
import {
  compareVersions,
  isReleaseVersion,
  validateReleaseSecurity,
  type ReleaseSecurity,
  type UpdateError,
} from "@nodepass/contracts";

export const updateRepository = "sapientorius/nodePass";
const api = `https://api.github.com/repos/${updateRepository}/`;
export const releaseUrl = (version: string): string => {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  return `https://github.com/${updateRepository}/releases/tag/nodepass-v${version}`;
};
export interface Release {
  version: string;
  id: number;
  immutable: boolean;
  asset: { id: number; size: number; digest: string } | null;
  notes?: string | null;
  publishedAt?: number | null;
}
export type ReleaseCache = Record<
  string,
  { etag: string | null; releases: Release[]; count: number; notesFor?: string }
>;
export interface KnownRelease {
  release: Release;
  security: ReleaseSecurity;
  notesSha256?: string | null;
}
export function sameRelease(a: Release, b: Release): boolean {
  return (
    a.version === b.version &&
    a.id === b.id &&
    a.immutable === b.immutable &&
    JSON.stringify(a.asset) === JSON.stringify(b.asset)
  );
}
export class UpdateFailure extends Error {
  constructor(
    readonly code: UpdateError,
    readonly retryAt = 0,
  ) {
    super("Update check " + code);
  }
}
const invalid = (): never => {
  throw new UpdateFailure("invalid");
};

async function bytes(response: Response, limit: number): Promise<Buffer> {
  if (
    !response.body ||
    Number(response.headers.get("content-length")) > limit
  ) {
    await response.body?.cancel();
    return invalid();
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) return invalid();
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function parseReleases(value: unknown): Release[] {
  if (!Array.isArray(value) || value.length > 100) return invalid();
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return invalid();
    if (row.draft === true) return [];
    const version =
      typeof row.tag_name === "string"
        ? row.tag_name.replace(/^nodepass-v/, "")
        : "";
    if (!isReleaseVersion(version) || row.tag_name !== `nodepass-v${version}`)
      return [];
    if (
      row.draft !== false ||
      row.prerelease !== version.includes("-") ||
      row.html_url !== releaseUrl(version) ||
      !Number.isSafeInteger(row.id) ||
      row.id < 1 ||
      typeof row.immutable !== "boolean" ||
      !Array.isArray(row.assets)
    )
      return invalid();
    const assets = row.assets.filter(
      (a: Record<string, unknown>) => a?.name === "release-manifest.json",
    );
    if (assets.length > 1) return invalid();
    const a = assets[0];
    if (
      a &&
      (!Number.isSafeInteger(a.id) ||
        a.id < 1 ||
        !Number.isSafeInteger(a.size) ||
        a.size < 1 ||
        a.size > 1024 ** 2 ||
        typeof a.digest !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(a.digest))
    )
      return invalid();
    return [
      {
        version,
        id: row.id,
        immutable: row.immutable,
        asset: a ? { id: a.id, size: a.size, digest: a.digest } : null,
        notes:
          typeof row.body === "string" &&
          Buffer.byteLength(row.body, "utf8") <= 128 * 1024
            ? row.body
            : null,
        publishedAt:
          typeof row.published_at === "string" &&
          Number.isFinite(Date.parse(row.published_at))
            ? Date.parse(row.published_at)
            : null,
      },
    ];
  });
}

export class UpdateSource {
  constructor(
    readonly request: typeof fetch = fetch,
    readonly now = Date.now,
  ) {}

  private async get(
    url: string,
    signal: AbortSignal,
    etag?: string | null,
    binary = false,
  ): Promise<Response> {
    const response = await this.request(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: {
        Accept: binary
          ? "application/octet-stream"
          : "application/vnd.github+json",
        "User-Agent": "nodePass-update-check",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    });
    if (response.status === 403 || response.status === 429) {
      const retry = response.headers.get("retry-after"),
        reset = Number(response.headers.get("x-ratelimit-reset"));
      const seconds =
        retry && /^\d+$/.test(retry)
          ? this.now() + Number(retry) * 1000
          : Date.parse(retry ?? "");
      await response.body?.cancel();
      if (
        [seconds, reset * 1000].some(
          (time) => Number.isFinite(time) && time > this.now() + 7 * 86400000,
        )
      )
        return invalid();
      throw new UpdateFailure(
        "rate-limited",
        Math.max(
          this.now() + 3600000,
          Number.isFinite(seconds) ? seconds : 0,
          Number.isFinite(reset) ? reset * 1000 : 0,
        ),
      );
    }
    return response;
  }

  async check(
    installed: string,
    previous: KnownRelease | null,
    oldCache: ReleaseCache,
    signal: AbortSignal,
  ): Promise<{
    latest: KnownRelease | null;
    cache: ReleaseCache;
    nextCheckAt: number;
    manifestFetches: number;
  }> {
    if (
      previous &&
      !installed.includes("-") &&
      previous.release.version.includes("-")
    )
      previous = null;
    let nextCheckAt = this.now() + 3600000;
    const cache: ReleaseCache = {},
      releases = new Map<string, Release>();
    for (let page = 1; ; page++) {
      if (page > 10) return invalid();
      const key = String(page),
        cached = oldCache[key];
      const enriched =
        cached?.notesFor === installed &&
        cached.releases.every(
          (r) => Object.hasOwn(r, "notes") && Object.hasOwn(r, "publishedAt"),
        );
      const response = await this.get(
        `${api}releases?per_page=100&page=${page}`,
        signal,
        enriched ? cached?.etag : null,
      );
      const poll = Number(response.headers.get("x-poll-interval"));
      if (Number.isFinite(poll) && poll > 7 * 86400) {
        await response.body?.cancel();
        return invalid();
      }
      if (Number.isFinite(poll) && poll > 0)
        nextCheckAt = Math.max(nextCheckAt, this.now() + poll * 1000);
      let rows: Release[], count: number;
      if (response.status === 304 && cached && enriched) {
        await response.body?.cancel();
        rows = cached.releases.map((release) => ({ ...release }));
        // Cache the original page length: ignored tags/drafts still occupy a page.
        count = cached.count;
        cache[key] = { ...cached, releases: rows };
      } else {
        if (!response.ok) {
          await response.body?.cancel();
          throw new UpdateFailure("unavailable");
        }
        const value: unknown = JSON.parse(
          (await bytes(response, 2 * 1024 ** 2)).toString("utf8"),
        );
        rows = parseReleases(value);
        count = (value as unknown[]).length;
        cache[key] = {
          etag: response.headers.get("etag"),
          releases: rows,
          count,
        };
      }
      for (const release of rows) {
        if (releases.has(release.version)) return invalid();
        releases.set(release.version, release);
      }
      if (count < 100) break;
    }
    // Historical text must not inflate the security state beyond DB/request limits.
    // Count serialized bytes as control characters can expand in JSON.
    let notesBytes = 0;
    for (const release of [...releases.values()].sort((a, b) =>
      a.version === installed
        ? -1
        : b.version === installed
          ? 1
          : compareVersions(b.version, a.version),
    )) {
      const size = Buffer.byteLength(
        JSON.stringify(release.notes ?? null),
        "utf8",
      );
      if (
        (!installed.includes("-") && release.version.includes("-")) ||
        compareVersions(release.version, installed) < 0 ||
        notesBytes + size > 4 * 1024 ** 2
      )
        release.notes = null;
      else notesBytes += size;
    }
    for (const page of Object.values(cache)) page.notesFor = installed;
    const candidate = [...releases.values()]
      .filter(
        (r) =>
          (installed.includes("-") || !r.version.includes("-")) &&
          compareVersions(r.version, installed) > 0,
      )
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    if (
      previous &&
      compareVersions(previous.release.version, installed) > 0 &&
      (!candidate ||
        compareVersions(candidate.version, previous.release.version) < 0)
    )
      return invalid();
    if (!candidate)
      return { latest: null, cache, nextCheckAt, manifestFetches: 0 };
    if (!candidate.immutable || !candidate.asset) return invalid();
    if (previous?.release.version === candidate.version) {
      if (!sameRelease(previous.release, candidate)) return invalid();
      return { latest: previous, cache, nextCheckAt, manifestFetches: 0 };
    }
    const manifest = await this.manifest(candidate, signal);
    const security = validateReleaseSecurity(
      manifest.security,
      candidate.version,
    );
    // Immutable releases carry the complete earlier catalogue, without silently dropping warnings.
    if (
      previous?.security.fixes.some(
        (fix) =>
          !security.fixes.some(
            (next) => JSON.stringify(next) === JSON.stringify(fix),
          ),
      )
    )
      return invalid();
    const notesSha256 =
      typeof manifest.notesSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(manifest.notesSha256) &&
      manifest.notesSha256.length === 64
        ? manifest.notesSha256
        : null;
    return {
      latest: { release: candidate, security, notesSha256 },
      cache,
      nextCheckAt,
      manifestFetches: 1,
    };
  }

  /** Only this bounded, identity-checked path is shared by update and history checks. */
  async manifest(
    candidate: Release,
    signal: AbortSignal,
  ): Promise<{ security?: unknown; notesSha256?: unknown }> {
    if (!candidate.immutable || !candidate.asset) return invalid();
    let response = await this.get(
      `${api}releases/assets/${candidate.asset.id}`,
      signal,
      null,
      true,
    );
    if (response.status === 302) {
      await response.body?.cancel();
      let url: URL;
      try {
        url = new URL(response.headers.get("location") ?? "invalid");
      } catch {
        return invalid();
      }
      if (
        url.origin !== "https://release-assets.githubusercontent.com" ||
        url.username ||
        url.password ||
        url.hash
      ) {
        return invalid();
      }
      response = await this.request(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new UpdateFailure("unavailable");
    }
    const data = await bytes(response, 1024 ** 2);
    if (
      data.length !== candidate.asset.size ||
      `sha256:${createHash("sha256").update(data).digest("hex")}` !==
        candidate.asset.digest
    )
      return invalid();
    const manifest = JSON.parse(data.toString("utf8"));
    if (
      manifest?.format !== "nodepass-release-1" ||
      manifest.version !== candidate.version ||
      manifest.tag !== `nodepass-v${candidate.version}` ||
      manifest.source?.repository !== updateRepository ||
      !/^[a-f0-9]{40}$/.test(manifest.source?.commit) ||
      manifest.source.commit.length !== 40 ||
      manifest.source.ref !== `refs/tags/nodepass-v${candidate.version}`
    )
      return invalid();
    return { security: manifest.security, notesSha256: manifest.notesSha256 };
  }
}
