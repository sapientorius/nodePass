import { readFile, writeFile } from "node:fs/promises";
import { releaseIdentity, workspaces } from "./release-policy.mjs";

const version = process.argv[2];
if (process.argv.length !== 3)
  throw new Error("Usage: npm run release:version -- VERSION");
releaseIdentity(version, "0".repeat(40));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const root = await json("package.json"),
  lock = await json("package-lock.json");
const updates = [["package.json", { ...root, version }]];
lock.version = version;
lock.packages[""].version = version;
for (const name of workspaces) {
  const path = `packages/${name}`,
    pkg = await json(`${path}/package.json`);
  pkg.version = version;
  lock.packages[path].version = version;
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (!dependency.startsWith("@nodepass/")) continue;
    pkg.dependencies[dependency] = version;
    lock.packages[path].dependencies[dependency] = version;
  }
  updates.push([`${path}/package.json`, pkg]);
}
updates.push(["package-lock.json", lock]);
for (const [path, value] of updates)
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
await writeFile(
  "packages/contracts/src/version.ts",
  `export const version = "${version}";\n`,
);
for (const path of ["README.md", "SECURITY.md"]) {
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace(
      path === "README.md"
        ? /nodePass is version \*\*[^*]+\*\*/
        : /The current project version is [^\s]+\./,
      path === "README.md"
        ? `nodePass is version **${version}**`
        : `The current project version is ${version}.`,
    ),
  );
}
console.log(
  `Updated product version to ${version}. Add the matching changelog entry before committing.`,
);
