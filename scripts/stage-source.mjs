import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { publicationFiles, checkDocumentation } from "./publication-policy.mjs";
import { sha256 } from "./release-policy.mjs";

const root = resolve("."),
  target = resolve(".cache/security-source");
const files = await publicationFiles(root);
await checkDocumentation(root, files);
await mkdir(".cache", { recursive: true });
// Refuse an existing snapshot: a scan must describe this run's actual source bytes.
await mkdir(target);
const manifest = [];
for (const file of files) {
  const destination = join(target, file);
  await mkdir(join(destination, ".."), { recursive: true });
  await cp(join(root, file), destination, { errorOnExist: true, force: false });
  manifest.push({ path: file, sha256: await sha256(destination) });
}
await mkdir("output/security", { recursive: true });
await writeFile(
  "output/security/source-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Staged ${files.length} publication source files for security scans.`,
);
