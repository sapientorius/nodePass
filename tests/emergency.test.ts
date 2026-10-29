import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { harness, testPassword } from "./harness.js";
import { emergencyRecovery } from "../packages/server/src/security/recovery.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { putSetting } from "../packages/server/src/db.js";
import { digest } from "../packages/server/src/security/crypto.js";
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "offline operator recovery is explicit, audited and one-use",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    const input = {
      login: "admin",
      password: testPassword,
      maintenance: true,
      reason: "factor-loss",
    };
    beforeAll(async () => {
      r = await harness();
    });
    afterAll(async () => {
      await r?.dispose();
    });
    it.each([
      { ...input, maintenance: false },
      { ...input, reason: "unknown" },
      { ...input, root: true },
      { ...input, password: 7 },
      { ...input, password: "x".repeat(4097) },
    ])(
      "rejects missing maintenance declarations and unsafe fields",
      async (data) => {
        await expect(emergencyRecovery(r.db, r.vault, data)).rejects.toThrow(
          "input",
        );
      },
    );
    it("requires an initialized unlocked deployment and a valid active local app administrator", async () => {
      await expect(
        emergencyRecovery(r.db, new Vault(r.db, r.config.deploymentKey), input),
      ).rejects.toThrow("custody");
      await putSetting(r.db, "initialized", false);
      await expect(emergencyRecovery(r.db, r.vault, input)).rejects.toThrow(
        "custody",
      );
      await putSetting(r.db, "initialized", true);
      for (const patch of [
        { isDisabled: 1 },
        { isAdminApp: 0 },
        { isLdap: 1 },
      ]) {
        await r.db("User").where({ id: 1 }).update(patch);
        await expect(emergencyRecovery(r.db, r.vault, input)).rejects.toThrow(
          "administrator",
        );
        await r
          .db("User")
          .where({ id: 1 })
          .update({ isDisabled: 0, isAdminApp: 1, isLdap: 0 });
      }
      await expect(
        emergencyRecovery(r.db, r.vault, { ...input, password: "wrong" }),
      ).rejects.toThrow("administrator");
      await expect(
        emergencyRecovery(r.db, r.vault, { ...input, login: "unknown" }),
      ).rejects.toThrow("administrator");
    });
    it("keeps factors, stores only a hash, revokes sessions and records the operation", async () => {
      await r.db("nodepass_factors").insert({
        userId: 1,
        kind: "totp",
        name: "Lost device",
        data: r.vault.wrap("JBSWY3DPEHPK3PXP", "totp/1").toString("base64"),
        counter: 0,
        confirmed: 1,
      });
      const params = await r.params();
      expect(
        await r
          .db("nodepass_sessions")
          .where({ id: params.identity!.session.id })
          .first(),
      ).toBeDefined();
      const code = await emergencyRecovery(r.db, r.vault, input);
      expect(code.length).toBeGreaterThan(32);
      expect(await r.db("nodepass_sessions")).toHaveLength(0);
      expect(
        await r.db("nodepass_factors").where({ kind: "totp" }),
      ).toHaveLength(1);
      const factor = await r
        .db("nodepass_factors")
        .where({ kind: "recovery" })
        .first();
      expect(factor.data).toBe(digest(code));
      expect(factor.data).not.toBe(code);
      expect(
        await r
          .db("nodepass_audit")
          .where({ action: "auth.emergency.recovery" })
          .first(),
      ).toBeDefined();
    });
  },
);
