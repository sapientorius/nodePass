import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep, basename } from "node:path";

// Source-path safeguards complement (and never replace) content secret scanning.
export function forbiddenPublicationPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    return true;
  if (
    parts.some((part) =>
      /^(?:\.git|\.agents|\.cache|\.playwright-cli|\.idea|\.vscode|node_modules|dist|coverage|output|playwright-report|test-results|data|secrets|backups|imports|private-input)$/i.test(
        part,
      ),
    )
  )
    return true;
  const name = parts.at(-1);
  if (/^agents\.md$/i.test(name)) return true;
  if (/^\.env/i.test(name) && normalized !== ".env.example") return true;
  if (
    /(?:\.log|\.tsbuildinfo|\.npb|\.partial|\.pem|\.key|\.dump|\.bak|\.sql\.gz|\.sql\.zip)$/i.test(
      name,
    )
  )
    return true;
  if (
    /^(?:sbom\.cdx\.json|operator-recovery-.*\.txt|config\.xml)$/i.test(name) &&
    normalized !== "tests/fixtures/config.xml"
  )
    return true;
  if (
    normalized === "docs/ACCEPTANCE.md" ||
    normalized === "scripts/prepare-legacy.mjs"
  )
    return true;
  // The only SQL files in the public application are its baseline and test fixtures.
  if (
    /\.sql$/i.test(name) &&
    normalized !== "packages/server/resources/schema.sql" &&
    !/^tests\/fixtures\/[^/]+\.sql$/.test(normalized)
  )
    return true;
  return false;
}

function inside(root, path) {
  const rel = relative(root, path);
  return (
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !resolve(path).startsWith(`\\\\`)
  );
}

export async function publicationFiles(root, { tree = false } = {}) {
  root = resolve(root);
  let candidates;
  if (tree) {
    candidates = [];
    const walk = async (directory) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const full = resolve(directory, item.name);
        const name = relative(root, full).replaceAll("\\", "/");
        if (forbiddenPublicationPath(name))
          throw new Error(`Private/generated path in export: ${name}`);
        if (item.isSymbolicLink())
          throw new Error(`Symbolic link in export: ${name}`);
        if (item.isDirectory()) await walk(full);
        else candidates.push(name);
      }
    };
    await walk(root);
  } else {
    const output = execFileSync(
      "git",
      [
        "-c",
        "core.excludesFile=",
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    candidates = output.split("\0").filter(Boolean);
  }
  const files = [];
  for (const name of [...new Set(candidates)].sort()) {
    const path = resolve(root, name);
    if (!inside(root, path))
      throw new Error(`Path escapes source root: ${name}`);
    // A private blob can remain staged even after its working-tree file is deleted.
    if (forbiddenPublicationPath(name))
      throw new Error(`Private/generated publication candidate: ${name}`);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    // Inspect ancestors too: a directory junction must not smuggle external files.
    let current = root;
    for (const part of name.split("/")) {
      current = resolve(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Symbolic link in publication candidate: ${name}`);
    }
    if (!stat.isFile()) throw new Error(`Not a regular source file: ${name}`);
    files.push(name);
  }
  if (!files.includes("package.json") || !files.includes("README.md"))
    throw new Error(
      "No nodePass publication source found; use a Git checkout or --tree on a pristine export",
    );
  return files;
}

function headings(markdown) {
  const seen = new Map();
  const ids = new Set();
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    const match = !fence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  return ids;
}

export async function checkDocumentation(root, files) {
  const known = new Set(files);
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const source = (await readFile(resolve(root, file), "utf8")).replace(
      /^```[^\n]*\n[\s\S]*?^```\s*$/gm,
      "",
    );
    const targets = [
      ...source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ].map((match) => match[1]);
    targets.push(
      ...[...source.matchAll(/\bsrc="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const target of targets) {
      if (/^(?:https?:|mailto:)/i.test(target)) continue;
      const [pathname, fragment] = target.split("#");
      const path = resolve(
        root,
        file,
        "..",
        decodeURIComponent(pathname || basename(file)),
      );
      const local = relative(root, path).replaceAll("\\", "/");
      if (!inside(resolve(root), path) || !known.has(local))
        throw new Error(
          `Missing or private documentation target in ${file}: ${target}`,
        );
      if (
        fragment &&
        local.endsWith(".md") &&
        !headings(await readFile(path, "utf8")).has(
          decodeURIComponent(fragment),
        )
      )
        throw new Error(`Missing documentation anchor in ${file}: ${target}`);
    }
  }
}
