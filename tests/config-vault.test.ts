import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../packages/server/src/config.js";
import { proxyMatcher } from "../packages/server/src/security/proxy.js";
import { Vault } from "../packages/server/src/security/vault.js";
import { seal } from "../packages/server/src/security/crypto.js";
import { harness } from "./harness.js";
describe("deployment configuration fails closed", () => {
  const base = {
    DEPLOYMENT_KEY: randomBytes(32).toString("base64"),
    SETUP_TOKEN: randomBytes(32).toString("hex"),
  };
  it("accepts explicit local development and HTTPS production origins", () => {
    expect(loadConfig(base).publicUrl).toBe("http://localhost:3000");
    expect(
      loadConfig({
        ...base,
        NODE_ENV: "production",
        PUBLIC_URL: "https://vault.example.org",
        TRUST_PROXY: "1",
        TRUSTED_PROXIES: "127.0.0.1,172.16.0.0/12",
      }).trustedProxies,
    ).toHaveLength(2);
  });
  it.each([
    { PUBLIC_URL: "https://vault.example.org/path" },
    { PUBLIC_URL: "https://user:pass@vault.example.org" },
    { PUBLIC_URL: "https://vault.example.org/?a=b" },
    { PUBLIC_URL: "https://vault.example.org/#a" },
    { NODE_ENV: "production", PUBLIC_URL: "http://localhost:3000" },
    { PUBLIC_URL: "http://public.example.org" },
    { DEPLOYMENT_KEY: "bad" },
    { DEPLOYMENT_KEY: randomBytes(31).toString("base64") },
    { SETUP_TOKEN: "short" },
    { PORT: "0" },
    { PORT: "65536" },
    { PORT: "abc" },
    { DB_PORT: "abc" },
    { DB_NAME: "unsafe-db" },
    { TRUST_PROXY: "1" },
    { TRUST_PROXY: "1", TRUSTED_PROXIES: "0.0.0.0/999" },
  ])("rejects invalid configuration %j", (env) =>
    expect(() => loadConfig({ ...base, ...env })).toThrow(),
  );
  it("loads secret files and original XML without fetching resources", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodepass-config-"));
    try {
      await writeFile(join(directory, "key"), base.DEPLOYMENT_KEY);
      await writeFile(join(directory, "setup"), base.SETUP_TOKEN);
      await writeFile(
        join(directory, "config.xml"),
        "<config><dbHost>old-db</dbHost><dbPass>a&amp;b</dbPass><dbName>syspass</dbName><dbSocket>/db/socket</dbSocket></config>",
      );
      const c = loadConfig({
        DEPLOYMENT_KEY_FILE: join(directory, "key"),
        SETUP_TOKEN_FILE: join(directory, "setup"),
        SYSPASS_CONFIG: join(directory, "config.xml"),
      });
      expect(c.database.host).toBe("old-db");
      expect(c.database.password).toBe("a&b");
      expect(c.database.socketPath).toBe("/db/socket");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("matches only explicit IPv4/IPv6 peers and rejects malformed ranges", () => {
    const match = proxyMatcher([
      "127.0.0.1",
      "172.20.0.0/16",
      "::1",
      "2001:db8::/32",
    ]);
    expect(match("::ffff:127.0.0.1")).toBe(true);
    expect(match("172.20.1.1")).toBe(true);
    expect(match("172.21.1.1")).toBe(false);
    expect(match("::1")).toBe(true);
    expect(match("2001:db8::7")).toBe(true);
    expect(match("invalid")).toBe(false);
    expect(match()).toBe(false);
    for (const range of ["host", "1.2.3.4/a", "1.2.3.4/33", "::1/129"])
      expect(() => proxyMatcher([range])).toThrow();
  });
});
describe.skipIf(process.env.NODEPASS_INTEGRATION !== "1")(
  "deployment key custody and rotation",
  () => {
    let r: Awaited<ReturnType<typeof harness>>;
    beforeAll(async () => {
      r = await harness();
    });
    afterAll(async () => {
      await r?.dispose();
    });
    it("never operates while locked, rejects missing legacy keys and duplicate initialization", async () => {
      const vault = new Vault(r.db, r.config.deploymentKey);
      expect(vault.unlocked).toBe(false);
      expect(() => vault.encrypt("x", "context")).toThrow("locked");
      expect(() => vault.wrap("x", "context")).toThrow("locked");
      expect(() => vault.unwrap(Buffer.alloc(0), "context")).toThrow("locked");
      await expect(vault.decrypt("x", "y", "context")).rejects.toThrow(
        "locked",
      );
      await expect(vault.initialize()).rejects.toThrow("initialized");
      await vault.load();
      await expect(vault.decrypt("legacy", "key", "context")).rejects.toThrow(
        "unavailable",
      );
      const secret = vault.encrypt("original", "record/1");
      expect(await vault.decrypt(secret.pass, secret.key, "record/1")).toBe(
        "original",
      );
      await expect(
        vault.decrypt(secret.pass, secret.key, "record/2"),
      ).rejects.toThrow();
      vault.destroy();
      expect(vault.unlocked).toBe(false);
    });
    it("rewraps every encrypted configuration atomically without changing account ciphertext", async () => {
      await r.vault.saveConfiguration("integration/smtp", {
        password: "synthetic password",
      });
      await r.vault.saveConfiguration("integration/smtp", {
        password: "changed synthetic password",
      });
      await expect(r.vault.saveConfiguration("vault", {})).rejects.toThrow();
      await expect(
        r.vault.saveConfiguration("x".repeat(81), {}),
      ).rejects.toThrow();
      expect(await r.vault.configuration("absent", { enabled: false })).toEqual(
        { enabled: false },
      );
      const secret = r.vault.encrypt("persisted", "field/1"),
        oldKey = Buffer.from(r.config.deploymentKey),
        next = randomBytes(32);
      await expect(r.vault.rewrapDeployment(Buffer.alloc(1))).rejects.toThrow();
      await r.vault.rewrapDeployment(next);
      await expect(new Vault(r.db, oldKey).load()).rejects.toThrow();
      const restarted = new Vault(r.db, next);
      await restarted.load();
      expect(await restarted.decrypt(secret.pass, secret.key, "field/1")).toBe(
        "persisted",
      );
      expect(
        await restarted.configuration("integration/smtp", {}),
      ).toHaveProperty("password", "changed synthetic password");
      await r.vault.rewrapDeployment(oldKey);
      restarted.destroy();
    });
    it("rejects malformed persisted key material and an unavailable keyring", async () => {
      const stored = await r
        .db("nodepass_keyring")
        .where({ id: "vault" })
        .first();
      await r
        .db("nodepass_keyring")
        .where({ id: "vault" })
        .update({
          value: seal(
            JSON.stringify({ key: Buffer.alloc(1).toString("base64") }),
            r.config.deploymentKey,
            "keyring/vault",
          ),
        });
      await expect(
        new Vault(r.db, r.config.deploymentKey).load(),
      ).rejects.toThrow("Invalid vault");
      await r.db("nodepass_keyring").where({ id: "vault" }).delete();
      const absent = new Vault(r.db, r.config.deploymentKey);
      await absent.load();
      expect(absent.unlocked).toBe(false);
      await r.db("nodepass_keyring").insert(stored);
    });
  },
);
