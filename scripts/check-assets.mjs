import { readdir, readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("packages/web/dist");
let checked = 0;
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if ([".html", ".css", ".svg"].includes(extname(path))) {
      const source = await readFile(path, "utf8");
      if (
        /(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(source) ||
        /(?:@import\s+|url\(\s*["']?)(?:https?:)?\/\//i.test(source) ||
        /<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(source)
      )
        throw new Error(`External resource or inline script: ${path}`);
      checked++;
    }
  }
}
await walk(root);
console.log(
  `Checked ${checked} built assets: no remote resources or inline scripts.`,
);
