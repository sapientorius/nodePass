export function serializePhp(value: unknown): string {
  if (value === null) return "N;";
  if (typeof value === "boolean") return `b:${Number(value)};`;
  if (typeof value === "number")
    return `${Number.isInteger(value) ? "i" : "d"}:${value};`;
  if (typeof value === "string")
    return `s:${Buffer.byteLength(value)}:"${value}";`;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  return `a:${entries.length}:{${entries.map(([k, v]) => serializePhp(k) + serializePhp(v)).join("")}}`;
}
