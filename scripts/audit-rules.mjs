import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { parse } from "yaml";
const root = resolve(process.argv[2] ?? ".cache/semgrep-rules", "javascript"),
  rules = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await walk(path);
    else if (item.name.endsWith(".yaml")) {
      const data = parse(await readFile(path, "utf8"));
      for (const rule of data.rules ?? [])
        if (rule.metadata?.category === "security")
          rules.push({
            ...rule,
            id:
              "upstream." +
              relative(root, path).replace(/[^\w.]/g, ".") +
              "." +
              rule.id,
          });
    }
  }
}
await walk(root);
if (rules.length < 100 || new Set(rules.map((r) => r.id)).size !== rules.length)
  throw new Error("Incomplete or duplicate upstream security rules");
await mkdir(".cache", { recursive: true });
await writeFile(
  ".cache/semgrep-security.json",
  JSON.stringify({ rules }, null, 2),
);
console.log(
  `Prepared ${rules.length} upstream JavaScript security rules from the pinned rules checkout.`,
);
