import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { harness } from "./harness.js";
import { Integrations } from "../packages/server/src/services/integrations.js";
import { deliverBatch, jobs } from "../packages/server/src/services/jobs.js";
import { audit, getSetting } from "../packages/server/src/db.js";
import type { Updates } from "../packages/server/src/services/updates.js";
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "configured integration protocols and durable delivery",
  () => {
    let r: Awaited<ReturnType<typeof harness>>, integrations: Integrations;
    beforeAll(async () => {
      r = await harness();
      integrations = new Integrations(r.db, r.vault, {});
      mocks.createTransport.mockReturnValue({
        sendMail: mocks.sendMail,
        close: mocks.close,
      });
      mocks.sendMail.mockResolvedValue({
        accepted: ["synthetic@example.test"],
        rejected: [],
      });
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      await r?.dispose();
    });
    it("requires TLS for mail, escapes header control characters and closes transports even on delivery failure", async () => {
      await integrations.save(
        "smtp",
        {
          enabled: true,
          host: "mail.example.test",
          port: 587,
          user: "mailer",
          password: "synthetic smtp secret",
          from: "vault@example.test",
          recipients: "team@example.test, ops@example.test",
          secure: false,
        },
        1,
      );
      await integrations.mail("Alert\r\nInjected", "Event without a secret");
      expect(mocks.createTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          requireTLS: true,
          tls: { rejectUnauthorized: true },
          disableFileAccess: true,
          disableUrlAccess: true,
          auth: { user: "mailer", pass: "synthetic smtp secret" },
        }),
      );
      expect(mocks.sendMail).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subject: "Alert  Injected",
          to: ["team@example.test", "ops@example.test"],
        }),
      );
      mocks.sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
      await expect(integrations.mail("Alert", "Safe event")).rejects.toThrow(
        "unavailable",
      );
      expect(mocks.close).toHaveBeenCalledTimes(2);
      await integrations.save("smtp", { secure: true }, 1);
      await integrations.mail("Alert", "Safe event");
      expect(mocks.createTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({ secure: true, requireTLS: false }),
      );
      expect(JSON.stringify(await integrations.view("smtp"))).not.toContain(
        "synthetic smtp secret",
      );
    });
    it("sends bounded syslog messages only to the explicitly configured endpoint", async () => {
      const socket = createSocket("udp4");
      socket.bind(0, "127.0.0.1");
      await once(socket, "listening");
      const address = socket.address();
      try {
        await integrations.save(
          "syslog",
          { enabled: true, host: "127.0.0.1", port: address.port },
          1,
        );
        const packet = once(socket, "message");
        await integrations.syslog(
          "auth.failed\nInjected",
          null,
          "12\r\nsecret",
        );
        const [data] = await packet;
        expect(data.toString()).toMatch(/^<134>1 /);
        expect(data.toString()).toContain(
          "auth.failedInjected user=- target=12secret",
        );
        expect(data.toString()).not.toContain("\n");
      } finally {
        socket.close();
      }
    });
    it("delivers explicit update recipients independently of the audit list and refuses rejected delivery", async () => {
      await integrations.save("smtp", { enabled: false }, 1);
      expect(
        await integrations.mailTo(
          "Update",
          "Synthetic notice",
          "admin@example.test",
        ),
      ).toBe(false);
      await integrations.save("smtp", { enabled: true, recipients: "" }, 1);
      expect(
        await integrations.mailTo(
          "Update",
          "Synthetic notice",
          "admin@example.test",
        ),
      ).toBe(true);
      expect(mocks.sendMail).toHaveBeenLastCalledWith(
        expect.objectContaining({
          to: ["admin@example.test"],
          text: "Synthetic notice",
        }),
      );
      mocks.sendMail.mockResolvedValueOnce({
        accepted: [],
        rejected: ["admin@example.test"],
      });
      await expect(
        integrations.mailTo("Update", "Synthetic notice", "admin@example.test"),
      ).rejects.toThrow("not accepted");
    });
    it("limits wiki requests to HTTPS XML-RPC and rejects redirects, entities, malformed or oversized responses", async () => {
      await integrations.save(
        "wiki",
        {
          enabled: true,
          url: "https://wiki.example.test/lib/exe/xmlrpc.php",
          user: "reader",
          password: "synthetic wiki secret",
        },
        1,
      );
      const fetchMock = vi
        .fn()
        .mockImplementation(
          () =>
            new Response(
              "<methodResponse><params><param><value><string>Result</string></value></param></params></methodResponse>",
            ),
        );
      vi.stubGlobal("fetch", fetchMock);
      expect(
        await integrations.wiki("search", "safe & <query>"),
      ).toHaveProperty("methodResponse");
      expect(fetchMock.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "text/xml",
          authorization:
            "Basic " +
            Buffer.from("reader:synthetic wiki secret").toString("base64"),
        },
      });
      expect(fetchMock.mock.calls[0]![1].body).toContain(
        "safe &amp; &lt;query&gt;",
      );
      await integrations.wiki("page", "operations:start");
      expect(fetchMock.mock.calls[1]![1].body).toContain("wiki.getPage");
      for (const response of [
        new Response("not XML"),
        new Response('<!DOCTYPE data [<!ENTITY bad "value">]><data/>'),
        new Response("x", { status: 403 }),
        new Response("x".repeat(2 * 1024 ** 2 + 1)),
      ]) {
        fetchMock.mockResolvedValueOnce(response);
        await expect(integrations.wiki("page", "test")).rejects.toThrow();
      }
      vi.unstubAllGlobals();
    });
    it("keeps update checks and update mail independent of failed audit delivery and stops all workers", async () => {
      await audit(r.db, 1, "security.test");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const failedAudit = vi
        .spyOn(integrations, "syslog")
        .mockRejectedValue(
          new Error("Synthetic unavailable audit destination"),
        );
      let callback!: () => void;
      const interval = vi.spyOn(global, "setInterval").mockImplementation(((
        fn: () => void,
      ) => {
        callback = fn;
        return { unref() {} };
      }) as any);
      const clear = vi
        .spyOn(global, "clearInterval")
        .mockImplementation(() => {});
      const worker = {
        checkDue: vi.fn().mockRejectedValue(new Error("offline")),
        deliver: vi.fn().mockRejectedValue(new Error("offline")),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      try {
        const stop = jobs(r.db, integrations, worker as unknown as Updates);
        callback();
        callback();
        await stop();
        callback();
        expect(worker.checkDue).toHaveBeenCalledTimes(3);
        expect(worker.deliver).toHaveBeenCalledTimes(2);
        expect(worker.stop).toHaveBeenCalledOnce();
        expect(errors).toHaveBeenCalled();
      } finally {
        interval.mockRestore();
        clear.mockRestore();
        failedAudit.mockRestore();
        errors.mockRestore();
      }
    });
    it("retries delivery without losing its cursor and cleans up expired session and challenge data", async () => {
      const last = await r.db("nodepass_audit").max({ n: "id" }).first();
      await r.db("nodepass_settings").insert({
        id: "notificationCursor",
        value: JSON.stringify(Number(last!.n)),
      });
      await audit(r.db, null, "auth.failed");
      await audit(r.db, 1, "account.view", 12);
      const forward = {
        syslog: vi.fn(),
        mail: vi.fn().mockRejectedValueOnce(new Error("Retry later")),
      };
      await expect(deliverBatch(r.db, forward)).rejects.toThrow("Retry later");
      expect(await getSetting(r.db, "notificationCursor", 0)).toBe(
        Number(last!.n),
      );
      await r
        .db("nodepass_challenges")
        .insert({ id: "expired", kind: "test", value: "sealed", expiresAt: 1 });
      await r
        .db("nodepass_limits")
        .insert({ id: "expired", resetAt: 1, attempts: 1 });
      await r.db("nodepass_sessions").insert({
        id: "expired",
        csrf: "test",
        userId: 1,
        complete: 1,
        verifiedAt: 0,
        createdAt: 1,
        lastSeen: 1,
      });
      await deliverBatch(r.db, forward);
      expect(forward.syslog).toHaveBeenCalledTimes(3);
      expect(forward.mail).toHaveBeenCalledTimes(2);
      expect(forward.mail).toHaveBeenLastCalledWith(
        "nodePass · auth.failed",
        expect.stringContaining("User: -\nTarget: -"),
      );
      expect(
        await r.db("nodepass_challenges").where({ id: "expired" }),
      ).toHaveLength(0);
      expect(
        await r.db("nodepass_limits").where({ id: "expired" }),
      ).toHaveLength(0);
      expect(
        await r.db("nodepass_sessions").where({ id: "expired" }),
      ).toHaveLength(0);
      await deliverBatch(r.db, forward);
      expect(forward.syslog).toHaveBeenCalledTimes(3);
      let callback!: () => void;
      const interval = vi.spyOn(global, "setInterval").mockImplementation(((
          fn: () => void,
        ) => {
          callback = fn;
          return { unref: () => {} };
        }) as any),
        clear = vi.spyOn(global, "clearInterval").mockImplementation(() => {});
      const stop = jobs(r.db, integrations);
      callback();
      callback();
      await stop();
      callback();
      expect(clear).toHaveBeenCalled();
      interval.mockRestore();
      clear.mockRestore();
    });
  },
);
