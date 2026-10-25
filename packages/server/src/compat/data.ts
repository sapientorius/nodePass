import { phpMap } from "./php.js";
export function mapData(
  value: Buffer | string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  const text = Buffer.from(value).toString();
  if (!text.startsWith("NPJ1:")) return phpMap(value);
  const data = JSON.parse(text.slice(5));
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some((k) =>
      ["__proto__", "prototype", "constructor"].includes(k),
    )
  )
    throw new Error("Invalid structured data");
  return data as Record<string, unknown>;
}
