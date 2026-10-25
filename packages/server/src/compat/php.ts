/** Data-only PHP serialization reader. Never constructs PHP or JS class instances. */
export type PhpValue = null | boolean | number | string | PhpMap;
export interface PhpMap {
  [key: string]: PhpValue;
}
const classes = new Set([
  "SP\\DataModel\\ProfileData",
  "SP\\DataModel\\UserPreferencesData",
  "SP\\DataModel\\CustomFieldBaseData",
  "SP\\Core\\Crypt\\Vault",
  "SP\\DataModel\\AccountData",
  "SP\\Modules\\Web\\Plugins\\Authenticator\\Models\\AuthenticatorData",
  "SP\\DataModel\\ItemPreset\\AccountPermission",
  "SP\\DataModel\\ItemPreset\\AccountPrivate",
  "SP\\DataModel\\ItemPreset\\Password",
  "SP\\DataModel\\ItemPreset\\SessionTimeout",
]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function readPhp(input: Buffer | string): PhpValue {
  const source = Buffer.from(input);
  if (source.length > 4_000_000) throw new Error("PHP data too large");
  let at = 0,
    nodes = 0;
  const take = (text: string): void => {
    if (source.subarray(at, at + text.length).toString() !== text)
      throw new Error("Malformed PHP data");
    at += text.length;
  };
  const until = (end: string): string => {
    const next = source.indexOf(end, at);
    if (next < at || next - at > 200) throw new Error("Malformed PHP token");
    const s = source.subarray(at, next).toString();
    at = next + end.length;
    return s;
  };
  const number = (end: string): number => {
    const s = until(end);
    if (!/^-?\d+$/.test(s) || !Number.isSafeInteger(Number(s)))
      throw new Error("Invalid PHP integer");
    return Number(s);
  };
  const string = (): string => {
    const length = number(":");
    if (length < 0 || length > source.length - at - 2)
      throw new Error("Invalid PHP length");
    take('"');
    const value = source.subarray(at, at + length).toString("utf8");
    at += length;
    take('"');
    return value;
  };
  const parse = (depth: number): PhpValue => {
    if (depth > 20 || ++nodes > 10000)
      throw new Error("PHP data limit exceeded");
    const type = source.subarray(at++, at).toString();
    if (type === "N") {
      take(";");
      return null;
    }
    take(":");
    if (type === "b") {
      const n = number(";");
      if (n !== 0 && n !== 1) throw new Error("Invalid PHP boolean");
      return n === 1;
    }
    if (type === "i") return number(";");
    if (type === "d") {
      const raw = until(";");
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw))
        throw new Error("Invalid PHP number");
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error("Invalid PHP number");
      return n;
    }
    if (type === "s") {
      const s = string();
      take(";");
      return s;
    }
    if (type !== "a" && type !== "O") throw new Error("Unsupported PHP type");
    if (type === "O") {
      const name = string();
      if (!classes.has(name)) throw new Error(`Unsupported PHP class: ${name}`);
      take(":");
    }
    const count = number(":");
    if (count < 0 || count > 10000) throw new Error("Invalid PHP map size");
    take("{");
    const result: PhpMap = Object.create(null) as PhpMap;
    for (let i = 0; i < count; i++) {
      const raw = parse(depth + 1);
      if (typeof raw !== "string" && typeof raw !== "number")
        throw new Error("Invalid PHP map key");
      // PHP protected/private names contain a NUL-delimited declaring class.
      const key = String(raw).split("\0").at(-1)!;
      if (forbidden.has(key) || Object.hasOwn(result, key))
        throw new Error("Unsafe or duplicate PHP key");
      result[key] = parse(depth + 1);
    }
    take("}");
    return result;
  };
  const result = parse(0);
  if (at !== source.length) throw new Error("Trailing PHP data");
  return result;
}
export function phpMap(input: Buffer | string | null | undefined): PhpMap {
  if (!input) return Object.create(null) as PhpMap;
  const value = readPhp(input);
  if (!value || typeof value !== "object")
    throw new Error("Expected PHP object");
  return value;
}
