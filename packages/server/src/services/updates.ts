import { createHash } from "node:crypto";
import { Conflict } from "@feathersjs/errors";
import {
  compareVersions,
  version,
  type UpdateStatus,
  type UpdateError,
  type ReleaseHistory,
} from "@nodepass/contracts";
import { getSetting, putSetting, type Database } from "../db.js";
import type { Integrations } from "./integrations.js";
import {
  releaseUrl,
  UpdateSource,
  UpdateFailure,
  type KnownRelease,
  type ReleaseCache,
  sameRelease,
} from "./update-source.js";
import {
  refreshReleaseHistory,
  type StoredHistory,
} from "./release-history.js";

interface State {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number;
  error: UpdateError | null;
  latest: KnownRelease | null;
  cache: ReleaseCache;
}
interface Delivery {
  sent: boolean;
  failed: boolean;
  retryAt: number;
  attempts: number;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** A single mailbox only; never interpret stored user data as an address list/header. */
export function adminMailbox(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 80 &&
    ![...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) &&
    /^[^\s@<>,;:"\\()[\]]+@[^\s@<>,;:"\\()[\]]+$/.test(value.trim())
    ? value.trim()
    : null;
}

export class Updates {
  private checking?: Promise<void>;
  private delivering?: Promise<void>;
  private controller = new AbortController();
  private stopped = false;
  constructor(
    readonly db: Database,
    readonly integrations: Pick<Integrations, "configuration" | "mailTo">,
    readonly source = new UpdateSource(),
    readonly installed = version,
    readonly now = Date.now,
  ) {}

  private load(): Promise<State> {
    return getSetting(this.db, "updates/state", {
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextCheckAt: 0,
      error: null,
      latest: null,
      cache: {},
    });
  }
  private available(
    state: State,
  ): Omit<NonNullable<UpdateStatus["available"]>, "acknowledged"> | null {
    const latest = state.latest;
    if (
      !latest ||
      compareVersions(latest.release.version, this.installed) <= 0 ||
      (!this.installed.includes("-") && latest.release.version.includes("-"))
    )
      return null;
    const fixes = latest.security.fixes
      .filter((fix) =>
        fix.affected.some(
          (range) =>
            compareVersions(this.installed, range.introduced) >= 0 &&
            compareVersions(this.installed, range.fixed) < 0,
        ),
      )
      .map((f) => f.id)
      .sort();
    return {
      version: latest.release.version,
      critical: fixes.length > 0,
      fixes,
      url: releaseUrl(latest.release.version),
      id: hash(JSON.stringify([this.installed, latest.release.version, fixes])),
    };
  }
  private async recipients() {
    const rows = await this.db("User")
      .where({ isAdminApp: 1, isDisabled: 0 })
      .select("id", "email")
      .orderBy("id");
    const addresses = new Map<string, string>();
    let missing = 0;
    for (const row of rows) {
      const email = adminMailbox(row.email);
      if (!email) missing++;
      else addresses.set(email.toLowerCase(), email);
    }
    return { addresses: [...addresses.values()], missing };
  }
  private mailKey(target: string, email: string) {
    return "updates/mail/" + hash(target + "\0" + email.toLowerCase());
  }
  private delivery(target: string, email: string): Promise<Delivery> {
    return getSetting(this.db, this.mailKey(target, email), {
      sent: false,
      failed: false,
      retryAt: 0,
      attempts: 0,
    });
  }
  async status(userId: number): Promise<UpdateStatus> {
    const state = await this.load(),
      available = this.available(state);
    const { addresses, missing } = await this.recipients();
    const enabled = !!(await this.integrations.configuration("smtp")).enabled;
    let pending = 0,
      failed = 0;
    if (available)
      for (const email of addresses) {
        const delivery = await this.delivery(available.version, email);
        if (!delivery.sent) pending++;
        if (!delivery.sent && delivery.failed) failed++;
      }
    return {
      installedVersion: this.installed,
      channel: this.installed.includes("-") ? "rc" : "stable",
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      nextCheckAt: state.nextCheckAt,
      error: state.error,
      stale:
        state.lastSuccessAt === null ||
        this.now() - state.lastSuccessAt > 7200000,
      available: available
        ? {
            ...available,
            acknowledged:
              (await getSetting(this.db, `updates/ack/${userId}`, "")) ===
              available.id,
          }
        : null,
      mail: { enabled, missingAddresses: missing, pending, failed },
    };
  }
  async acknowledge(userId: number, id: string): Promise<void> {
    if (this.available(await this.load())?.id !== id)
      throw new Conflict("Update notification changed");
    await putSetting(this.db, `updates/ack/${userId}`, id);
  }

  async releases(): Promise<ReleaseHistory> {
    const state = await this.load();
    const history = await getSetting<StoredHistory | null>(
      this.db,
      "updates/history",
      null,
    );
    const catalog = Object.values(state.cache)
      .flatMap((page) => page.releases)
      .filter((r) => this.installed.includes("-") || !r.version.includes("-"))
      .sort((a, b) => compareVersions(b.version, a.version));
    const releases = catalog
      .filter((r) => compareVersions(r.version, this.installed) >= 0)
      .map((release) => {
        const entry = history?.entries[release.version];
        if (!entry)
          return {
            version: release.version,
            publishedAt: release.publishedAt ?? null,
            url: releaseUrl(release.version),
            notes: null,
            verifiedAt: null,
            notesStatus: "pending" as const,
          };
        const status = !sameRelease(entry.identity, release)
          ? "unavailable"
          : entry.info.notesStatus === "verified" &&
              entry.info.notes !== release.notes
            ? "pending"
            : entry.info.notesStatus;
        return {
          version: release.version,
          publishedAt: release.publishedAt ?? null,
          url: releaseUrl(release.version),
          notes: entry.info.notes,
          verifiedAt: entry.info.verifiedAt,
          notesStatus: status,
        };
      });
    const stale =
      state.lastSuccessAt === null ||
      this.now() - state.lastSuccessAt > 7200000;
    const error = state.error ?? history?.error ?? null;
    return {
      installedVersion: this.installed,
      latestVersion: catalog[0]?.version ?? null,
      installedPublished:
        state.lastSuccessAt === null
          ? null
          : catalog.some((r) => r.version === this.installed),
      channel: this.installed.includes("-") ? "rc" : "stable",
      lastSuccessAt: state.lastSuccessAt,
      nextCheckAt: state.nextCheckAt,
      error,
      stale,
      complete:
        !stale &&
        !error &&
        !!history &&
        history.checkedAt >= (state.lastSuccessAt ?? 0) &&
        releases.every((r) => r.notesStatus === "verified"),
      releases,
    };
  }

  checkDue(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.checking) return this.checking;
    this.checking = this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private async check(): Promise<void> {
    const state = await this.load();
    if (this.now() < state.nextCheckAt) return;
    state.lastAttemptAt = this.now();
    state.nextCheckAt = this.now() + 3600000;
    // Persist the schedule before network I/O, including on process restart/crash.
    await putSetting(this.db, "updates/state", state);
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(60000),
    ]);
    let historyBudget: number | null = null;
    try {
      const result = await this.source.check(
        this.installed,
        state.latest,
        state.cache,
        signal,
      );
      state.latest = result.latest;
      state.cache = result.cache;
      state.nextCheckAt = result.nextCheckAt;
      state.lastSuccessAt = this.now();
      state.error = null;
      historyBudget = 10 - result.manifestFetches;
    } catch (error) {
      if (this.stopped) return;
      state.error =
        error instanceof UpdateFailure
          ? error.code
          : error instanceof SyntaxError ||
              (error instanceof Error && error.message.startsWith("Invalid"))
            ? "invalid"
            : "unavailable";
      if (error instanceof UpdateFailure)
        state.nextCheckAt = Math.max(state.nextCheckAt, error.retryAt);
      console.error(
        JSON.stringify({ event: "updates.check.failed", code: state.error }),
      );
    }
    await putSetting(this.db, "updates/state", state);
    // Publish the security decision before historical I/O. Mail delivery stays independent.
    if (historyBudget !== null && !this.stopped) {
      try {
        const previous = await getSetting<StoredHistory | null>(
          this.db,
          "updates/history",
          null,
        );
        const history = await refreshReleaseHistory(
          this.source,
          this.installed,
          state.cache,
          previous,
          state.latest,
          historyBudget,
          signal,
          this.now,
        );
        if (this.stopped) return;
        await putSetting(this.db, "updates/history", history);
        if (history.retryAt > state.nextCheckAt) {
          state.nextCheckAt = history.retryAt;
          await putSetting(this.db, "updates/state", state);
        }
      } catch {
        console.error(JSON.stringify({ event: "updates.history.failed" }));
      }
    }
  }
  deliver(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.delivering) return this.delivering;
    this.delivering = this.send().finally(() => {
      this.delivering = undefined;
    });
    return this.delivering;
  }
  private async send(): Promise<void> {
    if (!(await this.integrations.configuration("smtp")).enabled) return;
    const available = this.available(await this.load());
    if (!available) return;
    const { addresses } = await this.recipients();
    let attempted = 0;
    for (const email of addresses) {
      if (this.stopped || attempted >= 20) break;
      const delivery = await this.delivery(available.version, email);
      if (delivery.sent || this.now() < delivery.retryAt) continue;
      // Recheck roles, addresses and target immediately before each delivery.
      if (
        !(await this.recipients()).addresses.includes(email) ||
        this.available(await this.load())?.id !== available.id
      )
        continue;
      attempted++;
      try {
        const sent = await this.integrations.mailTo(
          `nodePass · ${available.critical ? "CRITICAL SECURITY UPDATE" : "Update available"} · ${available.version}`,
          `Installed version: ${this.installed}\nAvailable version: ${available.version}\n` +
            (available.critical
              ? `Critical: this update fixes security vulnerabilities affecting the installed version.\nFixes: ${available.fixes.join(", ")}\n`
              : "A new nodePass release is available.\n") +
            `\nRelease and installation information: ${available.url}\nVerify the release artifacts and follow the documented update procedure.`,
          email,
        );
        if (!sent) return;
        delivery.sent = true;
        delivery.failed = false;
      } catch {
        delivery.failed = true;
        delivery.attempts++;
        delivery.retryAt =
          this.now() +
          Math.min(3600000, 60000 * 2 ** Math.min(delivery.attempts - 1, 6));
        console.error(JSON.stringify({ event: "updates.mail.failed" }));
      }
      await putSetting(
        this.db,
        this.mailKey(available.version, email),
        delivery,
      );
    }
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.controller.abort();
    await Promise.allSettled([this.checking, this.delivering]);
  }
}
