import { constants, type ReadStream } from "node:fs";
import {
  mkdir,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { resolve, dirname, basename, sep } from "node:path";
import { Conflict, BadRequest, NotFound } from "@feathersjs/errors";
import type { BackupOrigin, BackupSummary, Page } from "@nodepass/contracts";
import { token } from "../security/crypto.js";

export const backupPattern = /^nodepass-(\d+)-[A-Za-z0-9_-]{8}\.npb$/;
export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Unsafe backup directory");
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await privateDirectory(dirname(path));
  const temporary = `${path}.${token()}.partial`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          attempt >= 8 ||
          !["EPERM", "EBUSY", "EACCES"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        await new Promise((done) =>
          setTimeout(done, Math.min(250, 25 * 2 ** attempt)),
        );
      }
    }
    // Directory fsync is unavailable on some Windows filesystems.
    const directory = await open(dirname(path), "r").catch(
      (error: NodeJS.ErrnoException) => {
        if (
          process.platform !== "win32" ||
          !["EINVAL", "EPERM", "EISDIR", "EACCES"].includes(error.code ?? "")
        )
          throw error;
        return undefined;
      },
    );
    if (directory) {
      try {
        await directory.sync();
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EINVAL", "EPERM", "EISDIR", "EBADF"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      } finally {
        await directory.close();
      }
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function readJson<T>(path: string): Promise<T | undefined> {
  let file: FileHandle;
  for (let attempt = 0; ; attempt++) {
    try {
      file = await safeOpen(path);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      if (code !== "ESTALE" || attempt >= 8) throw error;
    }
  }
  try {
    if ((await file.stat()).size > 1024 * 1024)
      throw new Error("Oversized backup metadata");
    return JSON.parse(await file.readFile("utf8")) as T;
  } finally {
    await file.close();
  }
}
export async function safeOpen(path: string): Promise<FileHandle> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new Error("Unsafe backup file");
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const after = await file.stat();
  if (
    after.ino !== before.ino ||
    after.dev !== before.dev ||
    after.nlink !== 1
  ) {
    await file.close();
    throw Object.assign(new Error("Backup file changed"), { code: "ESTALE" });
  }
  return file;
}

interface Metadata {
  origin: BackupOrigin;
  complete?: boolean;
  slot?: number;
  job?: string;
}
export class BackupFiles {
  readonly directory: string;
  readonly work: string;
  private root = "";
  private leases = new Map<string, number>();
  private protectedNames = new Set<string>();
  private deleting = new Set<string>();
  constructor(readonly dataDir: string) {
    this.directory = resolve(dataDir, "backups");
    this.work = resolve(dataDir, "backup-work");
  }
  async initialize(): Promise<void> {
    await privateDirectory(this.dataDir);
    await privateDirectory(this.directory);
    await privateDirectory(this.work);
    this.root = await realpath(this.dataDir);
  }
  async check(): Promise<void> {
    if ((await realpath(this.dataDir)) !== this.root)
      throw new Error("Backup directory changed");
    for (const path of [this.directory, this.work]) {
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        dirname(await realpath(path)) !== this.root
      )
        throw new Error("Unsafe backup directory");
    }
  }
  name(): string {
    return `nodepass-${Date.now()}-${token().slice(0, 8)}.npb`;
  }
  path(name: string): string {
    if (!backupPattern.test(name)) throw new BadRequest("Invalid backup name");
    const path = resolve(this.directory, name);
    if (!path.startsWith(this.directory + sep))
      throw new BadRequest("Invalid backup path");
    return path;
  }
  protect(name: string): void {
    this.path(name);
    this.protectedNames.add(name);
  }
  unprotect(name: string): void {
    this.protectedNames.delete(name);
  }
  inUse(name: string): boolean {
    return this.protectedNames.has(name) || (this.leases.get(name) ?? 0) > 0;
  }
  async metadata(name: string, data: Metadata): Promise<void> {
    await this.check();
    await atomicJson(`${this.path(name)}.json`, data);
  }
  async summary(name: string): Promise<BackupSummary> {
    await this.check();
    const file = await safeOpen(this.path(name));
    try {
      const stat = await file.stat();
      const metadata = await readJson<Metadata>(`${this.path(name)}.json`);
      const origin =
        metadata &&
        metadata.complete !== false &&
        ["manual", "automatic", "safety"].includes(metadata.origin)
          ? metadata.origin
          : "existing";
      return {
        name,
        size: stat.size,
        createdAt: Number(backupPattern.exec(name)![1]),
        origin,
        inUse: this.inUse(name),
      };
    } finally {
      await file.close();
    }
  }
  async list(skip = 0, limit = 25): Promise<Page<BackupSummary>> {
    if (
      !Number.isInteger(skip) ||
      skip < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new BadRequest("Invalid backup pagination");
    await this.check();
    const entries = await readdir(this.directory, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && backupPattern.test(e.name))
      .map((e) => e.name)
      .sort(
        (a, b) =>
          Number(backupPattern.exec(b)![1]) -
            Number(backupPattern.exec(a)![1]) || b.localeCompare(a),
      );
    const data: BackupSummary[] = [];
    for (const name of names.slice(skip, skip + limit)) {
      try {
        data.push(await this.summary(name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { data, skip, limit, total: names.length };
  }
  async lease(
    name: string,
  ): Promise<{ file: FileHandle; release: () => Promise<void> }> {
    await this.check();
    if (this.deleting.has(name)) throw new Conflict("Backup is being deleted");
    this.leases.set(name, (this.leases.get(name) ?? 0) + 1);
    let file: FileHandle;
    try {
      file = await safeOpen(this.path(name));
    } catch (error) {
      this.leases.set(name, this.leases.get(name)! - 1);
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new NotFound("Backup unavailable");
      throw error;
    }
    let released = false;
    return {
      file,
      release: async () => {
        if (released) return;
        released = true;
        this.leases.set(name, this.leases.get(name)! - 1);
        await file.close();
      },
    };
  }
  async stream(
    name: string,
  ): Promise<{ stream: ReadStream; release: () => Promise<void> }> {
    const lease = await this.lease(name);
    const stream = lease.file.createReadStream({ autoClose: false });
    return { stream, release: lease.release };
  }
  async remove(name: string): Promise<void> {
    await this.check();
    if (this.inUse(name) || this.deleting.has(name))
      throw new Conflict("Backup is in use");
    this.deleting.add(name);
    try {
      const file = await safeOpen(this.path(name));
      await file.close();
      await unlink(this.path(name));
      await unlink(`${this.path(name)}.json`).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new NotFound("Backup unavailable");
      throw error;
    } finally {
      this.deleting.delete(name);
    }
  }
  async prune(keep: number): Promise<void> {
    let skip = 0;
    const automatic: BackupSummary[] = [];
    while (true) {
      const page = await this.list(skip, 100);
      automatic.push(...page.data.filter((b) => b.origin === "automatic"));
      skip += 100;
      if (skip >= page.total) break;
    }
    for (const item of automatic.slice(keep))
      if (!this.inUse(item.name)) await this.remove(item.name);
  }
  workPath(name: string): string {
    if (
      name.length > 200 ||
      name.split(".").some((part) => !part || !/^[A-Za-z0-9_-]+$/.test(part)) ||
      basename(name) !== name
    )
      throw new Error("Invalid work filename");
    return resolve(this.work, name);
  }
}
