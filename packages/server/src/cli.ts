import { mkdir, readFile, writeFile, chown, chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.js";
import { database, migrate } from "./db.js";
import { Vault } from "./security/vault.js";
import { Migration } from "./migration/service.js";
import { backup } from "./migration/backup.js";
import { restore } from "./migration/restore.js";
import { emergencyRecovery } from "./security/recovery.js";
import { BackupFiles } from "./services/backup-files.js";
const [command, ...args] = process.argv.slice(2);
const option = (name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1]!;
};
async function main(): Promise<void> {
  if (command === "init-secrets") {
    const directory = resolve(
      args.includes("--directory") ? option("--directory") : "secrets",
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const password = randomBytes(32).toString("base64url");
    for (const [name, value, owner] of [
      ["deployment-key", randomBytes(32).toString("base64"), 65532],
      ["setup-token", randomBytes(32).toString("base64url"), 65532],
      ["db-password-app", password, 65532],
      ["db-password", password, 999],
      ["db-root-password", randomBytes(32).toString("base64url"), 999],
    ] as const) {
      const path = resolve(directory, name);
      await writeFile(path, value + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      if (args.includes("--container-owners")) await chown(path, owner, owner);
    }
    console.log(
      `Secret files created in ${directory}. Keep the deployment key separately backed up.`,
    );
    if (args.includes("--container-owners")) await chmod(directory, 0o711);
    return;
  }
  const config = loadConfig(),
    db = database(config),
    vault = new Vault(db, config.deploymentKey),
    migration = new Migration(db, vault, config);
  try {
    if (await db.schema.hasTable("nodepass_keyring")) await vault.load();
    if (command === "preflight")
      console.log(JSON.stringify(await migration.preflight(), null, 2));
    else if (command === "install" || command === "migrate") {
      const input = JSON.parse(await readFile(option("--input"), "utf8"));
      if (command === "install")
        await migration.fresh({ ...input, token: config.setupToken });
      else
        console.log(
          JSON.stringify(
            await migration.takeover({ ...input, token: config.setupToken }),
          ),
        );
      console.log("Complete. Sign in and configure an administrator factor.");
    } else if (command === "import-dump") {
      await migration.importDump(await readFile(option("--file"), "utf8"));
      console.log("Dump imported. Run preflight and migrate to activate it.");
    } else if (command === "backup") {
      const files = new BackupFiles(config.dataDir);
      await files.initialize();
      const name = files.name();
      await files.metadata(name, { origin: "manual" });
      console.log(
        await backup(
          db,
          resolve(config.dataDir, "backups"),
          config.deploymentKey,
          { legacy: config.legacy, publicUrl: config.publicUrl },
          name,
        ),
      );
    } else if (command === "restore") {
      const source = args.includes("--source-key-file")
        ? Buffer.from(
            (await readFile(option("--source-key-file"), "utf8")).trim(),
            "base64",
          )
        : config.deploymentKey;
      await restore(
        db,
        option("--file"),
        source,
        config.deploymentKey,
        resolve(config.dataDir, "restore"),
      );
      console.log("Restore complete. All browser sessions have been revoked.");
    } else if (command === "recover-factor") {
      const input = JSON.parse(await readFile(option("--input"), "utf8")),
        code = await emergencyRecovery(db, vault, input),
        path = resolve(
          config.dataDir,
          `operator-recovery-${Date.now()}-${randomBytes(4).toString("hex")}.txt`,
        );
      await writeFile(path, code + "\n", { mode: 0o600, flag: "wx" });
      console.log(
        `One-use recovery code saved in ${path}. Read it over the deployment channel, sign in with the local administrator password, then remove this file.`,
      );
    } else if (command === "rotate-deployment-key") {
      await migrate(db);
      await vault.load();
      const key = Buffer.from(
        (await readFile(option("--new-key-file"), "utf8")).trim(),
        "base64",
      );
      await vault.rewrapDeployment(key);
      console.log(
        "Keyring rewrapped. Replace the deployment secret and restart all instances. Keep the previous key for older backups.",
      );
    } else
      throw new Error(
        "Commands: init-secrets, preflight, install --input, migrate --input, import-dump --file, backup, restore --file, recover-factor --input, rotate-deployment-key --new-key-file",
      );
  } finally {
    vault.destroy();
    await db.destroy();
  }
}
main().catch((error) => {
  const failure = error as {
    code?: number;
    message?: string;
    data?: Record<string, unknown>;
  };
  console.error(
    typeof failure.code === "number" &&
      failure.code >= 400 &&
      failure.code < 500
      ? JSON.stringify({
          message: failure.message,
          details: Object.fromEntries(
            Object.entries(failure.data ?? {}).filter(([key]) =>
              ["id", "table", "userId", "columns"].includes(key),
            ),
          ),
        })
      : "Command failed. Check input format, database/schema access and secret files.",
  );
  process.exitCode = 1;
});
