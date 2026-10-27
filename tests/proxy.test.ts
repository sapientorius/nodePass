import { afterEach, describe, expect, it, vi } from "vitest";
import { Resolver } from "node:dns/promises";
import {
  proxyMatcher,
  proxyPeerMatcher,
} from "../packages/server/src/security/proxy.js";

afterEach(() => vi.restoreAllMocks());

describe("named immediate proxy peers", () => {
  it("accepts only exact configured IPs and CIDRs without DNS", async () => {
    const resolve4 = vi.spyOn(Resolver.prototype, "resolve4"),
      match = proxyPeerMatcher(["127.0.0.1", "172.20.0.0/24", "2001:db8::/64"]);
    expect(await match("::ffff:127.0.0.1")).toBe(true);
    expect(await match("172.20.0.7")).toBe(true);
    expect(await match("2001:db8::1")).toBe(true);
    expect(await match("172.21.0.1")).toBe(false);
    expect(await match()).toBe(false);
    expect(await match("invalid")).toBe(false);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("resolves configured names only, including IPv6 and multiple proxies", async () => {
    const resolve4 = vi
      .spyOn(Resolver.prototype, "resolve4")
      .mockImplementation(async (host) =>
        host === "coolify-proxy" ? ["172.20.0.2"] : ["172.20.0.3"],
      );
    vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue(["2001:db8::2"]);
    const match = proxyPeerMatcher([
      "coolify-proxy",
      "ingress.internal",
      "127.0.0.1",
    ]);
    expect(await match("127.0.0.1")).toBe(true);
    expect(resolve4).not.toHaveBeenCalled();
    expect(await match("::ffff:172.20.0.2")).toBe(true);
    expect(await match("172.20.0.3")).toBe(true);
    expect(await match("2001:db8::2")).toBe(true);
    expect(await match("172.20.0.9")).toBe(false);
    expect(await match("coolify-proxy")).toBe(false);
    expect(await match()).toBe(false);
    expect(
      resolve4.mock.calls.every(([host]) =>
        ["coolify-proxy", "ingress.internal"].includes(host),
      ),
    ).toBe(true);
  });

  it("starts before the proxy exists, recovers and rejects a replaced proxy IP", async () => {
    const resolve4 = vi
      .spyOn(Resolver.prototype, "resolve4")
      .mockRejectedValue(new Error("ENOTFOUND"));
    const resolve6 = vi
      .spyOn(Resolver.prototype, "resolve6")
      .mockRejectedValue(new Error("ENODATA"));
    const match = proxyPeerMatcher(["coolify-proxy"]);
    expect(resolve4).not.toHaveBeenCalled();
    expect(await match("172.20.0.2")).toBe(false);
    resolve4.mockResolvedValue(["172.20.0.2"]);
    expect(await match("172.20.0.2")).toBe(true);
    resolve4.mockResolvedValue(["172.20.0.3"]);
    expect(await match("172.20.0.2")).toBe(false);
    expect(await match("172.20.0.3")).toBe(true);
    resolve4.mockRejectedValue(new Error("ETIMEOUT"));
    expect(await match("172.20.0.3")).toBe(false);
    resolve6.mockResolvedValue(["2001:db8::7"]);
    expect(await match("2001:db8::7")).toBe(true);
  });

  it("shares concurrent DNS queries without retaining stale trust", async () => {
    let release!: (addresses: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    const resolve4 = vi
      .spyOn(Resolver.prototype, "resolve4")
      .mockReturnValue(pending);
    vi.spyOn(Resolver.prototype, "resolve6").mockResolvedValue([]);
    const match = proxyPeerMatcher(["coolify-proxy"]);
    const first = match("172.20.0.2"),
      second = match("172.20.0.9");
    expect(resolve4).toHaveBeenCalledTimes(1);
    release(["172.20.0.2"]);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    resolve4.mockResolvedValue(["172.20.0.3"]);
    expect(await match("172.20.0.2")).toBe(false);
    expect(resolve4).toHaveBeenCalledTimes(2);
  });

  it.each([
    "*",
    "https://proxy",
    "proxy:3000",
    "proxy/24",
    "-proxy",
    "proxy-",
    "proxy..internal",
    "proxy.",
    "proxy_name",
    "proxy\n",
    "proxy\n.internal",
    "1.2.3.999",
    "a".repeat(64),
    "a.".repeat(127) + "a",
    "127.0.0.1/32/ignored",
    "::1/128/ignored",
  ])("rejects ambiguous or malformed entry %s", (peer) => {
    expect(() => proxyPeerMatcher([peer])).toThrow("TRUSTED_PROXIES");
  });

  it("keeps address-only matchers strict for session network policies", () => {
    expect(() => proxyMatcher(["coolify-proxy"])).toThrow("address");
  });
});
