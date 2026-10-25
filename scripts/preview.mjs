import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { resetPreview } from "./preview-reset.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  directory = resolve(root, ".cache/preview"),
  envFile = resolve(directory, "secrets.env"),
  action = process.argv[2] ?? "start",
  names = ["DB_PASSWORD", "ROOT_PASSWORD", "DEPLOYMENT_KEY", "SETUP_TOKEN"],
  prefix = "NODEPASS_PREVIEW_";
process.chdir(root);

function docker(args, capture = false, optional = false) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (capture) {
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.resume();
    }
    child.once("error", () =>
      reject(
        new Error(
          "Docker ist nicht erreichbar. Bitte Docker Desktop mit Linux-Containern starten.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0 || optional
        ? resolve({ code, output })
        : reject(
            new Error(
              "Docker-Befehl fehlgeschlagen. Bitte die Ausgabe, Docker Desktop und einen möglichen Portkonflikt auf Port 3000 prüfen.",
            ),
          ),
    );
  });
}

try {
  if (
    !new Set(["start", "stop", "logs", "reset"]).has(action) ||
    process.argv.length > 3
  )
    throw new Error(
      "Befehle: npm run preview, npm run preview:stop, npm run preview:logs, npm run preview:reset",
    );
  const engine = await docker(["info", "--format", "{{.OSType}}"], true);
  if (engine.output.trim() !== "linux")
    throw new Error("Bitte Docker Desktop auf Linux-Container umstellen.");
  await docker(["compose", "version"], true);
  if (action === "reset") {
    await resetPreview(docker);
    console.log(
      "Preview-Testdaten einschließlich Benutzer, MFA, Konten und Backups gelöscht. Die Secret-Datei bleibt erhalten.",
    );
    console.log(
      "Frisch starten: npm run preview. Danach die Browserseite neu laden und Neu installieren wählen.",
    );
  } else {
    let secrets;
    try {
      secrets = parseEnv(await readFile(envFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (action !== "start")
        throw new Error(
          "Noch keine Vorschau eingerichtet. Zuerst npm run preview ausführen.",
          { cause: error },
        );
      for (const volume of [
        "nodepass-preview_data",
        "nodepass-preview_database",
      ]) {
        const existing = await docker(
          ["volume", "inspect", volume],
          true,
          true,
        );
        if (existing.code === 0)
          throw new Error(
            "Vorschau-Daten existieren, aber .cache/preview/secrets.env fehlt. Die ursprüngliche Secret-Datei wiederherstellen; Schlüssel werden nicht ersetzt.",
            { cause: error },
          );
      }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      secrets = Object.fromEntries(
        names.map((name) => [
          prefix + name,
          randomBytes(32).toString(
            name === "DEPLOYMENT_KEY" ? "base64" : "hex",
          ),
        ]),
      );
      await writeFile(
        envFile,
        Object.entries(secrets)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
        { mode: 0o600, flag: "wx" },
      );
    }
    if (
      Object.keys(secrets).length !== names.length ||
      names.some(
        (name) =>
          !secrets[prefix + name] ||
          (name === "DEPLOYMENT_KEY"
            ? !/^[A-Za-z0-9+/]{43}=$/.test(secrets[prefix + name])
            : !/^[a-f0-9]{64}$/.test(secrets[prefix + name])),
      )
    )
      throw new Error(
        "Ungültige Vorschau-Secrets. Die ursprüngliche .cache/preview/secrets.env wiederherstellen.",
      );
    const compose = [
      "compose",
      "--env-file",
      envFile,
      "--project-name",
      "nodepass-preview",
      "-f",
      "docker-compose.preview.yml",
    ];
    // An explicitly supplied env file still loses to shell variables in Compose.
    // Remove only preview variables so the persisted deployment key always wins.
    for (const name of names) delete process.env[prefix + name];
    if (action === "stop") {
      await docker([...compose, "stop"]);
      console.log(
        "Vorschau gestoppt. Testdaten und Schlüssel bleiben erhalten.",
      );
    } else if (action === "logs") {
      await docker([
        ...compose,
        "logs",
        "--follow",
        "--timestamps",
        "--tail",
        "100",
        "app",
      ]);
    } else {
      console.log(
        "nodePass-Vorschau wird vorbereitet. Der erste Start lädt Images und baut die Anwendung.",
      );
      await docker([
        ...compose,
        "up",
        "--detach",
        "--build",
        "--wait",
        "--wait-timeout",
        "240",
      ]);
      const response = await fetch("http://localhost:3000/api/v1/status", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          "Vorschau-Status nicht erreichbar. npm run preview:logs zeigt die Anwendungsausgabe.",
        );
      const status = await response.json();
      console.log("\nnodePass öffnen: http://localhost:3000");
      if (status.setupRequired) {
        console.log("Einrichtungstoken: " + secrets[prefix + "SETUP_TOKEN"]);
        console.log(
          "Im Browser: Neu installieren, eigenen Admin anlegen und Passkey oder TOTP einrichten.",
        );
      } else console.log("Mit deinem bereits eingerichteten Zugang anmelden.");
      console.log("Stoppen: npm run preview:stop · Logs: npm run preview:logs");
      console.log(
        "Nur lokale Testdaten verwenden. .cache/preview/secrets.env für spätere Starts beibehalten.",
      );
    }
  }
} catch (error) {
  console.error(
    error instanceof Error && !error.code
      ? error.message
      : "Vorschau konnte nicht gestartet werden. Docker und .cache/preview/secrets.env prüfen.",
  );
  process.exitCode = 1;
}
