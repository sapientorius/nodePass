import { createHash } from "node:crypto";
import {
  compareVersions,
  type ReleaseInformation,
  type UpdateError,
} from "@nodepass/contracts";
import {
  UpdateFailure,
  releaseUrl,
  sameRelease,
  type KnownRelease,
  type Release,
  type ReleaseCache,
  type UpdateSource,
} from "./update-source.js";

interface StoredEntry {
  identity: Release;
  manifestChecked: boolean;
  notesHash: string | null;
  info: ReleaseInformation;
}
export interface StoredHistory {
  latestVersion: string | null;
  installedPublished: boolean;
  checkedAt: number;
  entries: Record<string, StoredEntry>;
  error: UpdateError | null;
  retryAt: number;
}

/** Historical text failures are independent of the update/security decision. */
export async function refreshReleaseHistory(
  source: Pick<UpdateSource, "manifest">,
  installed: string,
  cache: ReleaseCache,
  previous: StoredHistory | null,
  latest: KnownRelease | null,
  budget: number,
  signal: AbortSignal,
  now: () => number,
): Promise<StoredHistory> {
  const catalog = Object.values(cache)
    .flatMap((page) => page.releases)
    .filter((r) => installed.includes("-") || !r.version.includes("-"))
    .sort((a, b) => compareVersions(b.version, a.version));
  const selected = catalog.filter(
    (r) => compareVersions(r.version, installed) >= 0,
  );
  const priority = [...selected].sort((a, b) =>
    a.version === installed
      ? -1
      : b.version === installed
        ? 1
        : compareVersions(b.version, a.version),
  );
  const entries: StoredHistory["entries"] = {};
  let error: UpdateError | null = null,
    retryAt = 0,
    network = true;
  for (const release of priority) {
    const old = previous?.entries[release.version];
    const identity: Release = {
      version: release.version,
      id: release.id,
      immutable: release.immutable,
      asset: release.asset ? { ...release.asset } : null,
    };
    const changed = old && !sameRelease(old.identity, identity);
    const entry: StoredEntry = {
      identity: changed ? old.identity : identity,
      manifestChecked: !changed && !!old?.manifestChecked,
      notesHash: !changed ? (old?.notesHash ?? null) : null,
      info: {
        version: release.version,
        publishedAt: release.publishedAt ?? null,
        url: releaseUrl(release.version),
        notes: old?.info.notes ?? null,
        verifiedAt: old?.info.verifiedAt ?? null,
        notesStatus: "pending",
      },
    };
    entries[release.version] = entry;
    if (
      changed ||
      !release.immutable ||
      !release.asset ||
      typeof release.notes !== "string"
    ) {
      entry.info.notesStatus = "unavailable";
      continue;
    }
    if (
      latest &&
      sameRelease(latest.release, release) &&
      latest.notesSha256 !== undefined
    ) {
      entry.manifestChecked = true;
      entry.notesHash = latest.notesSha256;
    }
    if (!entry.manifestChecked && budget > 0 && network && !signal.aborted) {
      budget--;
      try {
        const manifest = await source.manifest(release, signal);
        entry.manifestChecked = true;
        entry.notesHash =
          typeof manifest.notesSha256 === "string" &&
          manifest.notesSha256.length === 64 &&
          /^[a-f0-9]{64}$/.test(manifest.notesSha256)
            ? manifest.notesSha256
            : null;
      } catch (failure) {
        entry.info.notesStatus = "unavailable";
        if (
          failure instanceof UpdateFailure &&
          failure.code === "rate-limited"
        ) {
          error = "rate-limited";
          retryAt = failure.retryAt;
          network = false;
        } else if (signal.aborted) {
          error = "unavailable";
          network = false;
        }
        continue;
      }
    }
    if (!entry.manifestChecked) continue;
    if (!entry.notesHash) {
      entry.info.notesStatus = "unavailable";
      continue;
    }
    if (
      createHash("sha256").update(release.notes, "utf8").digest("hex") !==
      entry.notesHash
    ) {
      entry.info.notesStatus = "mismatch";
      continue;
    }
    entry.info.notes = release.notes;
    entry.info.notesStatus = "verified";
    entry.info.verifiedAt = now();
  }
  return {
    latestVersion: catalog[0]?.version ?? null,
    installedPublished: catalog.some((r) => r.version === installed),
    checkedAt: now(),
    entries,
    error,
    retryAt,
  };
}
