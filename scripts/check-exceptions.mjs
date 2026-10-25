import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
const exceptions = JSON.parse(
    await readFile("security/static-exceptions.json", "utf8"),
  ),
  seen = new Set();
const normalize = (value) => value.replace(/\s+/g, "");
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name).replaceAll("\\", "/");
    if (item.isDirectory()) await walk(path);
    else if (/\.(?:ts|vue|mjs)$/.test(path)) {
      const lines = (await readFile(path, "utf8")).split("\n");
      for (let n = 0; n < lines.length; n++) {
        const match = /^\s*\/\/\s*nosemgrep:\s*([\w.-]+)\s*$/.exec(lines[n]);
        if (!match) continue;
        const code = lines
            .slice(n + 1)
            .find((line) => line.trim() && !line.trim().startsWith("//")),
          exception = exceptions.find(
            (e) =>
              e.file === path &&
              e.rule === match[1] &&
              normalize(e.code) === normalize(code ?? ""),
          );
        if (
          !exception ||
          !exception.owner ||
          !exception.reason ||
          !Number.isFinite(Date.parse(exception.expiresAt)) ||
          Date.parse(exception.expiresAt) <= Date.now()
        )
          throw new Error(
            `Unreviewed or expired static suppression: ${path}:${n + 1}`,
          );
        seen.add(exception);
      }
    }
  }
}
for (const root of ["packages/server/src", "packages/web/src", "scripts"])
  await walk(root);
if (seen.size !== exceptions.length)
  throw new Error("Stale static exception entry");
console.log(`Verified ${seen.size} exact, time-limited static exception.`);
const zap = JSON.parse(await readFile("security/zap-exceptions.json", "utf8"));
for (const exception of [...exceptions, ...zap]) {
  const remaining = Date.parse(exception.expiresAt) - Date.now();
  if (
    !exception.owner ||
    !exception.reason ||
    !Number.isFinite(remaining) ||
    remaining <= 0
  )
    throw new Error("Unreviewed or expired scanner exception");
  if (remaining <= 30 * 86400000)
    console.warn(
      `Scanner exception ${exception.rule ?? exception.alertRef} expires on ${exception.expiresAt}; reassess its exact scope before expiry.`,
    );
}
