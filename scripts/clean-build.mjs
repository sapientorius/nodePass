import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
for (const relative of [
  "packages/contracts/dist",
  "packages/server/dist",
  "packages/web/dist",
]) {
  const target = resolve(root, relative);
  if (!target.startsWith(root + sep) || !target.endsWith(sep + "dist"))
    throw new Error("Build output escaped the workspace");
  await rm(target, { recursive: true, force: true });
}
