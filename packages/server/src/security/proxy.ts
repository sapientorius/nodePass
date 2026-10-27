import { BlockList, isIP } from "node:net";
import { Resolver } from "node:dns/promises";

/** Forwarded headers are accepted only from explicitly configured immediate peers. */
export function proxyMatcher(ranges: string[]): (address?: string) => boolean {
  const list = new BlockList();
  for (const range of ranges) {
    const [address, prefix] = range.split("/");
    const version = isIP(address!);
    if (!version || range.split("/").length > 2)
      throw new Error("Invalid TRUSTED_PROXIES address");
    const family = version === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) list.addAddress(address!, family);
    else {
      if (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128))
        throw new Error("Invalid TRUSTED_PROXIES subnet");
      list.addSubnet(address!, Number(prefix), family);
    }
  }
  return (address) => {
    if (!address) return false;
    const normalized = address.replace(/^::ffff:/i, "");
    const version = isIP(normalized);
    return (
      version !== 0 && list.check(normalized, version === 4 ? "ipv4" : "ipv6")
    );
  };
}

/** Resolve only configured proxy names, never a name supplied by a request. */
export function proxyPeerMatcher(
  peers: string[],
): (address?: string) => Promise<boolean> {
  const addresses: string[] = [],
    hosts: string[] = [];
  for (const peer of peers) {
    if (isIP(peer) || peer.includes("/")) addresses.push(peer);
    else {
      if (
        peer.length > 253 ||
        /[^a-z0-9.-]/i.test(peer) ||
        !/[a-z]/i.test(peer) ||
        !peer
          .split(".")
          .every((label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
          )
      )
        throw new Error("Invalid TRUSTED_PROXIES hostname");
      hosts.push(peer);
    }
  }
  const fixed = proxyMatcher(addresses);
  let resolving: Promise<ReturnType<typeof proxyMatcher>> | undefined;
  return async (address) => {
    if (fixed(address)) return true;
    if (!address || !isIP(address.replace(/^::ffff:/i, "")) || !hosts.length)
      return false;
    // Share only in-flight queries, without caching old addresses or failures.
    // Docker DNS follows the current container IP, including after a restart.
    if (!resolving) {
      const resolver = new Resolver({ timeout: 1000, tries: 1 });
      resolving = Promise.all(
        hosts.flatMap((host) => [
          resolver.resolve4(host).catch(() => []),
          resolver.resolve6(host).catch(() => []),
        ]),
      )
        .then((results) => proxyMatcher(results.flat()))
        .finally(() => {
          resolving = undefined;
        });
    }
    return (await resolving)(address);
  };
}
