import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  link,
  symlink,
  rmdir,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupFiles,
  atomicJson,
  readJson,
} from "../packages/server/src/services/backup-files.js";
describe("managed backup files", () => {
  let directory: string, files: BackupFiles;
  const names = [
    "nodepass-1700000000000-abcdefgh.npb",
    "nodepass-1700000000001-abcdefgh.npb",
    "nodepass-1700000000002-abcdefgh.npb",
    "nodepass-1700000000003-abcdefgh.npb",
  ];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "nodepass-backup-files-"));
    files = new BackupFiles(directory);
    await files.initialize();
  });
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const add = async (name: string) => {
    await writeFile(files.path(name), "NPB1synthetic", {
      flag: "wx",
      mode: 0o600,
    });
  };
  it("rediscovers files after navigation/restart and excludes partial/unrelated entries", async () => {
    for (const name of names) await add(name);
    await files.metadata(names[1]!, { origin: "manual" });
    await files.metadata(names[2]!, { origin: "automatic" });
    await files.metadata(names[3]!, { origin: "safety" });
    await writeFile(join(files.directory, "unrelated"), "private");
    await writeFile(`${files.path(names[0]!)}.partial`, "partial");
    const reopened = new BackupFiles(directory);
    await reopened.initialize();
    expect((await reopened.list(0, 2)).data.map((b) => b.origin)).toEqual([
      "safety",
      "automatic",
    ]);
    expect((await reopened.list(2, 2)).data.map((b) => b.origin)).toEqual([
      "manual",
      "existing",
    ]);
    expect((await reopened.list()).total).toBe(4);
    expect((await reopened.summary(names[0]!)).createdAt).toBe(1700000000000);
  });
  it("protects downloads and explicit restore leases until release", async () => {
    await add(names[0]!);
    const lease = await files.lease(names[0]!);
    expect((await files.summary(names[0]!)).inUse).toBe(true);
    await expect(files.remove(names[0]!)).rejects.toThrow("in use");
    await lease.release();
    await lease.release();
    files.protect(names[0]!);
    await expect(files.remove(names[0]!)).rejects.toThrow("in use");
    files.unprotect(names[0]!);
    await files.remove(names[0]!);
    await expect(files.remove(names[0]!)).rejects.toThrow("unavailable");
    await expect(files.lease(names[0]!)).rejects.toThrow("unavailable");
  });
  it("prunes only automatic copies and skips files with active consumers", async () => {
    for (const name of names) {
      await add(name);
      await files.metadata(name, { origin: "automatic" });
    }
    await files.metadata(names[1]!, { origin: "manual" });
    await files.metadata(names[2]!, { origin: "safety" });
    const lease = await files.lease(names[0]!);
    await files.prune(1);
    expect((await files.list()).total).toBe(4);
    await lease.release();
    await files.prune(1);
    expect((await files.list()).data.map((b) => b.origin)).toEqual([
      "automatic",
      "safety",
      "manual",
    ]);
  });
  it("never counts an unverified archive as an automatic retained version", async () => {
    for (const name of names.slice(0, 3)) await add(name);
    await files.metadata(names[0]!, { origin: "automatic", complete: true });
    await files.metadata(names[1]!, { origin: "automatic", complete: false });
    await files.metadata(names[2]!, { origin: "automatic", complete: true });
    await files.prune(1);
    const list = await files.list();
    expect(list.data.map((f) => f.origin)).toEqual(["automatic", "existing"]);
    expect(list.data.some((f) => f.name === names[1])).toBe(true);
  });
  it("rejects traversal, invalid pagination and hard links", async () => {
    expect(() => files.path("../outside.npb")).toThrow();
    expect(() => files.workPath("../outside")).toThrow();
    for (const [skip, limit] of [
      [-1, 25],
      [0, 0],
      [0, 101],
      [0.5, 25],
    ])
      await expect(files.list(skip, limit)).rejects.toThrow();
    await writeFile(join(directory, "outside"), "private");
    await link(join(directory, "outside"), files.path(names[0]!));
    await expect(files.stream(names[0]!)).rejects.toThrow("Unsafe");
    await expect(files.remove(names[0]!)).rejects.toThrow("Unsafe");
  });
  it("rejects redirected managed directories", async () => {
    await mkdir(join(directory, "other"));
    await rmdir(files.directory);
    await symlink(
      join(directory, "other"),
      files.directory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(files.list()).rejects.toThrow("Unsafe");
    await expect(new BackupFiles(directory).initialize()).rejects.toThrow(
      "Unsafe",
    );
  });
  it("writes durable JSON atomically and rejects oversized metadata", async () => {
    const path = files.workPath("state.json");
    expect(await readJson(path)).toBeUndefined();
    await atomicJson(path, { value: 1 });
    await atomicJson(path, { value: 2 });
    expect(await readJson(path)).toEqual({ value: 2 });
    expect(await readdir(files.work)).toEqual(["state.json"]);
    await writeFile(path, " ".repeat(1024 ** 2 + 1));
    await expect(readJson(path)).rejects.toThrow("Oversized");
  });
  it("reads complete metadata while a status writer publishes atomic replacements", async () => {
    const path = files.workPath("status.json");
    await atomicJson(path, { sequence: -1 });
    await Promise.all([
      (async () => {
        for (let sequence = 0; sequence < 20; sequence++)
          await atomicJson(path, { sequence });
      })(),
      (async () => {
        for (let i = 0; i < 100; i++)
          expect(
            Number.isInteger(
              (await readJson<{ sequence: number }>(path))?.sequence,
            ),
          ).toBe(true);
      })(),
    ]);
    expect(await readJson(path)).toEqual({ sequence: 19 });
  });
});
