/** Release versions deliberately match the product's stable/RC release policy. */
export function isReleaseVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    value.trim() === value &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/.test(value)
  );
}

export function compareVersions(left: string, right: string): number {
  if (!isReleaseVersion(left) || !isReleaseVersion(right))
    throw new Error("Invalid release version");
  const parts = (v: string) => v.split(/\.|-rc\./).map(BigInt);
  const a = parts(left),
    b = parts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  if (a.length === 3) return b.length === 3 ? 0 : 1;
  if (b.length === 3) return -1;
  return a[3]! < b[3]! ? -1 : a[3]! > b[3]! ? 1 : 0;
}

export interface SecurityFix {
  id: string;
  affected: { introduced: string; fixed: string }[];
}
export interface ReleaseSecurity {
  format: "nodepass-security-1";
  fixes: SecurityFix[];
}

/** Half-open version intervals include RCs by their actual semantic ordering. */
export function validateReleaseSecurity(
  input: unknown,
  released: string,
): ReleaseSecurity {
  const data = input as ReleaseSecurity | null;
  if (
    !data ||
    data.format !== "nodepass-security-1" ||
    Object.keys(data).sort().join() !== "fixes,format" ||
    !Array.isArray(data.fixes) ||
    data.fixes.length > 2000
  )
    throw new Error("Invalid release security metadata");
  const ids = new Set<string>();
  for (const fix of data.fixes) {
    if (
      !fix ||
      typeof fix.id !== "string" ||
      fix.id.trim() !== fix.id ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(fix.id) ||
      ids.has(fix.id) ||
      Object.keys(fix).sort().join() !== "affected,id" ||
      !Array.isArray(fix.affected) ||
      !fix.affected.length ||
      fix.affected.length > 20
    )
      throw new Error("Invalid security fix");
    ids.add(fix.id);
    let previous: string | undefined;
    for (const interval of fix.affected) {
      if (
        !interval ||
        Object.keys(interval).sort().join() !== "fixed,introduced" ||
        !isReleaseVersion(interval.introduced) ||
        !isReleaseVersion(interval.fixed) ||
        compareVersions(interval.introduced, interval.fixed) >= 0 ||
        compareVersions(interval.fixed, released) > 0 ||
        (previous !== undefined &&
          compareVersions(previous, interval.introduced) > 0)
      )
        throw new Error("Invalid affected version interval");
      previous = interval.fixed;
    }
  }
  return {
    format: "nodepass-security-1",
    fixes: data.fixes
      .map((fix) => ({
        id: fix.id,
        affected: fix.affected.map((interval) => ({
          introduced: interval.introduced,
          fixed: interval.fixed,
        })),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export type UpdateError = "unavailable" | "invalid" | "rate-limited";
export interface UpdateStatus {
  installedVersion: string;
  channel: "stable" | "rc";
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  error: UpdateError | null;
  stale: boolean;
  available: null | {
    version: string;
    critical: boolean;
    fixes: string[];
    url: string;
    id: string;
    acknowledged: boolean;
  };
  mail: {
    enabled: boolean;
    missingAddresses: number;
    pending: number;
    failed: number;
  };
}

export interface ReleaseInformation {
  version: string;
  publishedAt: number | null;
  url: string;
  notes: string | null;
  notesStatus: "verified" | "pending" | "unavailable" | "mismatch";
  verifiedAt: number | null;
}
export interface ReleaseHistory {
  installedVersion: string;
  latestVersion: string | null;
  installedPublished: boolean | null;
  channel: "stable" | "rc";
  lastSuccessAt: number | null;
  nextCheckAt: number;
  error: UpdateError | null;
  stale: boolean;
  complete: boolean;
  releases: ReleaseInformation[];
}
