import { BlockList, isIP } from "node:net";

/** Forwarded headers are accepted only from explicitly configured immediate peers. */
export function proxyMatcher(ranges: string[]): (address?: string) => boolean {
  const list = new BlockList();
  for (const range of ranges) {
    const [address, prefix] = range.split("/");
    const version = isIP(address!);
    if (!version) throw new Error("Invalid TRUSTED_PROXIES address");
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
