import { resolve } from "node:path";
import { publicationFiles, checkDocumentation } from "./publication-policy.mjs";

const root = resolve(import.meta.dirname, "..");
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--tree"))
    throw new Error("Usage: node scripts/check-publication.mjs [--tree]");
  const files = await publicationFiles(root, { tree: args.includes("--tree") });
  await checkDocumentation(root, files);
  console.log(
    `Publication paths and local documentation links verified (${files.length} source files).`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
