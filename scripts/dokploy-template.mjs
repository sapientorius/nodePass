import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

/** Dokploy imports switch to raw Compose, so they must use a published image. */
export async function dokployImport(root, image) {
  if (
    typeof image !== "string" ||
    /\s/.test(image) ||
    !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image)
  )
    throw new Error("A verified image reference pinned by sha256 is required");
  const compose = YAML.parse(
    await readFile(resolve(root, "docker-compose.dokploy.yml"), "utf8"),
  );
  delete compose.services.app.build;
  compose.services.app.image = image;
  compose.services.app.platform = "linux/amd64";
  const config = await readFile(resolve(root, "dokploy.toml"), "utf8");
  // Contains generator instructions, never generated or existing secrets.
  return (
    Buffer.from(
      JSON.stringify({ compose: YAML.stringify(compose), config }),
    ).toString("base64") + "\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3)
    throw new Error("Usage: npm run deploy:dokploy -- image@sha256:DIGEST");
  process.stdout.write(await dokployImport(process.cwd(), process.argv[2]));
}
