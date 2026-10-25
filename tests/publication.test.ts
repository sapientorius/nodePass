import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  forbiddenPublicationPath,
  publicationFiles,
  checkDocumentation,
} from "../scripts/publication-policy.mjs";

describe("publication boundary", () => {
  it.each([
    ".agents/CONTEXT.md",
    "AGENTS.MD",
    "docs/Agents.md",
    ".env",
    ".env.production",
    "packages/web/.env.local",
    ".cache/preview/secrets.env",
    "secrets/deployment-key",
    "data/dump.sql",
    "dump.sql",
    "backup.npb",
    "private-input/migration.json",
    "output/playwright/session.json",
    ".playwright-cli/snapshot.yml",
    "packages/web/dist/index.html",
    "operator-recovery-123.txt",
    "config.xml",
    "docs/ACCEPTANCE.md",
    "scripts/prepare-legacy.mjs",
    "../outside",
    "C:/outside",
  ])("rejects private/generated path %s", (path) => {
    expect(forbiddenPublicationPath(path)).toBe(true);
  });
  it.each([
    ".env.example",
    "tests/fixtures/config.xml",
    "tests/fixtures/reference.json",
    "tests/fixtures/syspass-account-crypt.xml",
    "tests/fixtures/phpmyadmin-schema-tail.sql",
    "packages/server/resources/schema.sql",
    "security/zap-exceptions.json",
    ".github/workflows/nodepass.yml",
    "packages/web/src/App.vue",
  ])("allows public source %s", (path) => {
    expect(forbiddenPublicationPath(path)).toBe(false);
  });
  it("rejects force-added ignored files, keeps current untracked source and skips deleted tracked files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodepass-publication-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    try {
      git("init", "--quiet");
      await writeFile(join(root, "package.json"), "{}");
      await writeFile(join(root, "README.md"), "# Public\n");
      await writeFile(
        join(root, ".gitignore"),
        ".agents/\n.env*\n!.env.example\n",
      );
      await writeFile(
        join(root, ".env.example"),
        "PUBLIC_URL=https://example.invalid\n",
      );
      await mkdir(join(root, ".agents"));
      await writeFile(join(root, ".agents", "private.md"), "private notes");
      await writeFile(join(root, "deleted.md"), "old");
      git("add", "README.md", "deleted.md");
      await rm(join(root, "deleted.md"));
      const files = await publicationFiles(root);
      expect(files).toContain("package.json");
      expect(files).toContain(".env.example");
      expect(files).not.toContain("deleted.md");
      expect(files).not.toContain(".agents/private.md");
      git("add", "--force", ".agents/private.md");
      await expect(publicationFiles(root)).rejects.toThrow("Private/generated");
      await rm(join(root, ".agents", "private.md"));
      await expect(publicationFiles(root)).rejects.toThrow("Private/generated");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects private files and links in a pristine filesystem export", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodepass-publication-"));
    try {
      await writeFile(join(root, "package.json"), "{}");
      await writeFile(join(root, "README.md"), "# Public\n");
      await writeFile(join(root, "AGENTS.md"), "private");
      await expect(publicationFiles(root, { tree: true })).rejects.toThrow(
        "Private/generated",
      );
      await rm(join(root, "AGENTS.md"));
      await mkdir(join(root, "target"));
      await symlink(
        join(root, "target"),
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(publicationFiles(root, { tree: true })).rejects.toThrow(
        "Symbolic link",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("checks relative documentation targets and anchors without allowing private links", async () => {
    const root = await mkdtemp(join(tmpdir(), "nodepass-publication-"));
    try {
      const files = ["README.md", "guide.md"];
      await writeFile(join(root, "guide.md"), "# Guide\n\n## Setup\n");
      await writeFile(
        join(root, "README.md"),
        "# Public\n\n[Install](guide.md#setup)\n[Home](#public)\n",
      );
      await expect(checkDocumentation(root, files)).resolves.toBeUndefined();
      await writeFile(join(root, "README.md"), "[Bad](guide.md#missing)");
      await expect(checkDocumentation(root, files)).rejects.toThrow("anchor");
      await writeFile(join(root, "README.md"), "[Private](.agents/private.md)");
      await expect(checkDocumentation(root, files)).rejects.toThrow(
        "private documentation target",
      );
      await writeFile(join(root, "README.md"), "[Outside](../outside.md)");
      await expect(checkDocumentation(root, files)).rejects.toThrow(
        "documentation target",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
