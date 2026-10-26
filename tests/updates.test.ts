import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { harness } from "./harness.js";
import {
  Updates,
  adminMailbox,
} from "../packages/server/src/services/updates.js";
import {
  UpdateSource,
  UpdateFailure,
} from "../packages/server/src/services/update-source.js";
import { getSetting } from "../packages/server/src/db.js";
import { updateFixture } from "./update-fixtures.js";

describe("administrator mailbox input", () => {
  it("accepts individual addresses and refuses lists, headers and display-name syntax", () => {
    expect(adminMailbox(" admin+updates@example.test ")).toBe(
      "admin+updates@example.test",
    );
    for (const value of [
      null,
      "",
      "no-at",
      "a@b\r\nBcc:x@y",
      "a@b\u0000",
      "a@b\u007f",
      "a@b,c@d",
      "Name <a@b>",
      "a@b(comment)",
      "a@b;c@d",
      "a".repeat(81),
    ])
      expect(adminMailbox(value)).toBeNull();
  });
});

describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "durable update checks and admin delivery",
  () => {
    let r: Awaited<ReturnType<typeof harness>>, service: Updates;
    let now: number, enabled: boolean;
    const request = vi.fn<typeof fetch>();
    const mailTo = vi.fn();
    const configuration = vi.fn(async () => ({ enabled }));
    const source = () => new UpdateSource(request, () => now);
    const make = (installed = "0.1.0") =>
      new Updates(
        r.db,
        { configuration, mailTo },
        source(),
        installed,
        () => now,
      );
    beforeAll(async () => {
      r = await harness();
      await r.updates.stop();
    });
    beforeEach(async () => {
      await service?.stop();
      await r.db("nodepass_settings").where("id", "like", "updates/%").delete();
      await r.db("User").whereNot({ id: 1 }).delete();
      await r
        .db("User")
        .where({ id: 1 })
        .update({ email: "admin@example.test", isAdminApp: 1, isDisabled: 0 });
      now = 1700000000000;
      enabled = true;
      mailTo.mockReset().mockResolvedValue(true);
      configuration.mockClear();
      request.mockReset();
      const f = updateFixture();
      request.mockImplementation(async (url) =>
        String(url).includes("/assets/")
          ? new Response(f.data)
          : new Response(JSON.stringify([f.row])),
      );
      service = make();
    });
    afterAll(async () => {
      await service?.stop();
      await r?.dispose();
    });
    const user = async (login: string, email: string | null, flags = {}) => {
      const root = await r.db("User").where({ id: 1 }).first();
      const [id] = await r.db("User").insert({
        ...root,
        id: undefined,
        login,
        name: login,
        email,
        ...flags,
      });
      return id;
    };
    it("checks immediately, once per hour across restarts, with isolated acknowledgements", async () => {
      await Promise.all([service.checkDue(), service.checkDue()]);
      expect(request).toHaveBeenCalledTimes(2);
      const first = await service.status(1);
      expect(first.available).toMatchObject({
        version: "0.3.0",
        critical: true,
        fixes: ["NP-TEST-1"],
        acknowledged: false,
      });
      expect(first.error).toBeNull();
      expect(first.stale).toBe(false);
      await service.acknowledge(1, first.available!.id);
      expect((await service.status(1)).available!.acknowledged).toBe(true);
      expect((await service.status(2)).available!.acknowledged).toBe(false);
      await expect(service.acknowledge(1, "0".repeat(64))).rejects.toThrow(
        "changed",
      );
      const restarted = make();
      await restarted.checkDue();
      expect(request).toHaveBeenCalledTimes(2);
      now += 3600000;
      await restarted.checkDue();
      expect(request).toHaveBeenCalledTimes(3);
      await restarted.stop();
      const fixed = make("0.2.0"),
        current = make("0.3.0");
      expect((await fixed.status(1)).available!.critical).toBe(false);
      expect((await current.status(1)).available).toBeNull();
      await fixed.stop();
      await current.stop();
    });
    it("shows unknown/stale checks, keeps warnings on errors and resets acknowledgement for a new release", async () => {
      expect(await service.status(1)).toMatchObject({
        lastSuccessAt: null,
        stale: true,
        available: null,
      });
      await service.checkDue();
      const id = (await service.status(1)).available!.id;
      await service.acknowledge(1, id);
      for (const error of [
        new Error("offline secret detail"),
        new SyntaxError("bad JSON"),
        new Error("Invalid release metadata"),
        new UpdateFailure("rate-limited", now + 10000000),
      ]) {
        now += 11000000;
        request.mockRejectedValueOnce(error);
        await service.checkDue();
        const status = await service.status(1);
        expect(status.available!.id).toBe(id);
        expect(status.stale).toBe(true);
        expect(status.error).not.toBeNull();
        expect(JSON.stringify(status)).not.toContain("secret detail");
      }
      now += 11000000;
      const f = updateFixture("0.4.0");
      request.mockImplementation(async (url) =>
        String(url).includes("/assets/")
          ? new Response(f.data)
          : new Response(JSON.stringify([f.row])),
      );
      await service.checkDue();
      expect((await service.status(1)).available!.acknowledged).toBe(false);
      await expect(service.acknowledge(1, id)).rejects.toThrow("changed");
    });
    it("persists scheduling before I/O and aborts an active check on shutdown", async () => {
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      request.mockImplementation(async (_url, options) => {
        started();
        await new Promise((_, reject) =>
          options!.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
        throw new Error("unreachable");
      });
      const active = service.checkDue();
      await ready;
      expect(await getSetting(r.db, "updates/state", {})).toMatchObject({
        lastAttemptAt: now,
        nextCheckAt: now + 3600000,
      });
      await service.stop();
      await active;
      await service.checkDue();
      await service.deliver();
      expect(request).toHaveBeenCalledTimes(1);
    });
    it("sends individually to active application admins and deduplicates successful addresses across restarts", async () => {
      await user("second", "second@example.test");
      await user("same-mailbox", "ADMIN@example.test");
      await user("no-mail", "bad email");
      await user("disabled", "disabled@example.test", { isDisabled: 1 });
      await user("account-admin", "account@example.test", {
        isAdminApp: 0,
        isAdminAcc: 1,
      });
      await service.checkDue();
      expect((await service.status(1)).mail).toMatchObject({
        missingAddresses: 1,
        pending: 2,
      });
      await Promise.all([service.deliver(), service.deliver()]);
      expect(mailTo).toHaveBeenCalledTimes(2);
      expect(mailTo.mock.calls.map((c) => c[2].toLowerCase()).sort()).toEqual([
        "admin@example.test",
        "second@example.test",
      ]);
      expect(mailTo.mock.calls[0]![0]).toContain("CRITICAL SECURITY UPDATE");
      expect(mailTo.mock.calls[0]![1]).toContain("Installed version: 0.1.0");
      const restarted = make();
      await restarted.deliver();
      await restarted.stop();
      expect(mailTo).toHaveBeenCalledTimes(2);
      now += 86400000;
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(2);
      expect((await service.status(1)).mail.pending).toBe(0);
    });
    it("defers disabled SMTP, retries failures with backoff and catches new admins and addresses", async () => {
      enabled = false;
      await service.checkDue();
      await service.deliver();
      expect(mailTo).not.toHaveBeenCalled();
      expect((await service.status(1)).mail.enabled).toBe(false);
      enabled = true;
      mailTo.mockRejectedValueOnce(new Error("synthetic SMTP failure"));
      await service.deliver();
      expect((await service.status(1)).mail).toMatchObject({
        failed: 1,
        pending: 1,
      });
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(1);
      now += 60000;
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(2);
      expect((await service.status(1)).mail.failed).toBe(0);
      await user("new-admin", "new@example.test");
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(3);
      await r
        .db("User")
        .where({ id: 1 })
        .update({ email: "changed@example.test" });
      mailTo.mockResolvedValueOnce(false);
      await service.deliver();
      expect((await service.status(1)).mail.pending).toBe(1);
      await service.deliver();
      expect((await service.status(1)).mail.pending).toBe(0);
    });
    it("does not send without a known update, after an upgrade, or after a role changes during delivery", async () => {
      await service.deliver();
      expect(mailTo).not.toHaveBeenCalled();
      await service.checkDue();
      const second = await user("other", "other@example.test");
      mailTo.mockImplementationOnce(async () => {
        await r.db("User").where({ id: second }).update({ isAdminApp: 0 });
        return true;
      });
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(1);
      const upgraded = make("0.3.0");
      await upgraded.deliver();
      await upgraded.stop();
      expect(mailTo).toHaveBeenCalledTimes(1);
    });
    it("sends ordinary updates once too, and limits a delivery batch", async () => {
      await service.stop();
      service = make("0.2.0");
      await service.checkDue();
      for (let i = 0; i < 21; i++)
        await user(`admin-${i}`, `admin-${i}@example.test`);
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(20);
      expect(mailTo.mock.calls[0]![0]).toContain("Update available");
      await service.deliver();
      expect(mailTo).toHaveBeenCalledTimes(22);
    });
    it("reads version history without network I/O, including current and unpublished installations", async () => {
      expect(await service.releases()).toMatchObject({
        installedVersion: "0.1.0",
        latestVersion: null,
        installedPublished: null,
        stale: true,
      });
      await service.checkDue();
      const before = request.mock.calls.length;
      expect(await service.releases()).toMatchObject({
        latestVersion: "0.3.0",
        installedPublished: false,
        complete: true,
        releases: [{ version: "0.3.0", notesStatus: "verified" }],
      });
      await service.releases();
      expect(request).toHaveBeenCalledTimes(before);
      const saved = await getSetting<any>(r.db, "updates/history", null);
      saved.entries["0.3.0"].info.url = "javascript:alert(1)";
      saved.entries["0.3.0"].info.version = "untrusted cache label";
      await r
        .db("nodepass_settings")
        .where({ id: "updates/history" })
        .update({ value: JSON.stringify(saved) });
      expect((await service.releases()).releases[0]).toMatchObject({
        version: "0.3.0",
        url: "https://github.com/sapientorius/nodePass/releases/tag/nodepass-v0.3.0",
      });
      const current = make("0.3.0");
      expect(await current.releases()).toMatchObject({
        latestVersion: "0.3.0",
        installedPublished: true,
      });
      await current.stop();
    });
    it("isolates historical manifest failure from security updates and email delivery", async () => {
      const f = updateFixture();
      const old = updateFixture("0.1.0", {
        format: "nodepass-security-1",
        fixes: [],
      });
      old.row.assets[0]!.id = 456;
      request.mockImplementation(async (url) => {
        if (String(url).endsWith("/assets/456"))
          throw new Error("Synthetic historic outage");
        return String(url).includes("/assets/")
          ? new Response(f.data)
          : new Response(JSON.stringify([f.row, old.row]));
      });
      await service.checkDue();
      expect(await service.status(1)).toMatchObject({
        error: null,
        available: { critical: true },
      });
      expect(
        (await service.releases()).releases.find((r) => r.version === "0.1.0")!
          .notesStatus,
      ).toBe("unavailable");
      await service.deliver();
      expect(mailTo).toHaveBeenCalledOnce();
    });
  },
);
