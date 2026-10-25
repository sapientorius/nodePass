import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import {
  checkVersions,
  releaseIdentity,
  repository,
  sha256,
  verifyOci,
} from "./release-policy.mjs";

export async function prepareRelease(root, identity, context) {
  const directory = join(root, ".cache/release"),
    assets = join(directory, "assets"),
    deployment = join(directory, "deployment");
  await mkdir(assets, { recursive: true });
  if ((await readdir(assets)).length)
    throw new Error(
      "Release asset directory must be empty; preserve earlier artifacts separately",
    );
  await mkdir(deployment, { recursive: true });
  const inspected = JSON.parse(
    await readFile(join(root, "output/security/image-manifest.json"), "utf8"),
  );
  const digest = await verifyOci(join(directory, "oci"), identity, inspected);
  const imageManifest = JSON.parse(
    await readFile(
      join(directory, "oci/blobs/sha256", digest.slice(7)),
      "utf8",
    ),
  );
  const configDigest = imageManifest.config.digest;
  const reference = `${identity.image}@${digest}`;
  for (const file of [
    "docker-compose.yml",
    "docker-compose.coolify.yml",
    "docker-compose.dokploy.yml",
  ]) {
    const compose = YAML.parse(await readFile(join(root, file), "utf8"));
    delete compose.services.app.build;
    compose.services.app.image = reference;
    compose.services.app.platform = "linux/amd64";
    await writeFile(join(deployment, file), YAML.stringify(compose));
  }
  for (const file of [
    ".env.example",
    "COPYING",
    "NOTICE.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docker-compose.existing.yml",
  ])
    await cp(join(root, file), join(deployment, file));
  await cp(
    join(root, ".github/rulesets"),
    join(deployment, ".github/rulesets"),
    { recursive: true },
  );
  await cp(join(root, "docs"), join(deployment, "docs"), {
    recursive: true,
    filter: (path) => !path.includes("screenshots"),
  });
  await writeFile(
    join(deployment, "README.md"),
    `# nodePass ${identity.version}\n\nVerified image: \`${reference}\`. Platform: Linux amd64.\n\nThese Compose files use the published image and contain no build step. Standard Compose starts with \`docker compose up --detach --no-build\`. Preserve existing secrets and volumes during updates.\n\n## Documentation\n\n- [Installation and secret initialization](docs/INSTALLATION.md)\n- [Release verification and updates](docs/RELEASES.md)\n- [Migration](docs/MIGRATION.md)\n- [Operations](docs/OPERATIONS.md)\n`,
  );
  const archive = `nodepass-${identity.version}-deploy.tar.gz`;
  execFileSync("tar", ["-czf", join(assets, archive), "-C", deployment, "."]);
  const sbom = JSON.parse(await readFile(join(root, "sbom.cdx.json"), "utf8"));
  if (sbom.bomFormat !== "CycloneDX" || !sbom.components?.length)
    throw new Error("Missing container SBOM components");
  await cp(join(root, "sbom.cdx.json"), join(assets, "sbom.cdx.json"));
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  const notes = changelog
    .split(`## [${identity.version}]`)[1]
    ?.split(/\n## \[/)[0];
  if (!notes?.trim()) throw new Error("Empty release notes");
  await writeFile(
    join(directory, "release-notes.md"),
    `${notes.trim()}\n\n### Verified artifacts\n\n- Source commit: \`${identity.commit}\`\n- Container: \`${reference}\`\n- Platform: Linux amd64\n- [Complete verification run](${context.url})\n\nVerify SHA256SUMS and the release attestations before installation. The deployment bundle contains Compose files pinned to this image digest.\n`,
  );
  const manifest = {
    format: "nodepass-release-1",
    version: identity.version,
    tag: identity.tag,
    source: { repository, commit: identity.commit, ref: context.ref },
    notesSha256: await sha256(join(directory, "release-notes.md")),
    image: {
      name: identity.image,
      digest,
      reference,
      configDigest,
      platforms: ["linux/amd64"],
    },
    verification: {
      runId: context.runId,
      attempt: context.attempt,
      url: context.url,
      requiredCheck: "Required release checks",
      databases: ["MariaDB 11.8", "MariaDB 10.11", "MariaDB 11.4", "MySQL 8.4"],
    },
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    join(assets, "release-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const hashes = [];
  for (const file of (await readdir(assets))
    .filter((name) => name !== "SHA256SUMS")
    .sort())
    hashes.push(`${await sha256(join(assets, file))}  ${file}`);
  await writeFile(join(assets, "SHA256SUMS"), hashes.join("\n") + "\n");
  return {
    digest,
    manifest,
    checksumsSha256: await sha256(join(assets, "SHA256SUMS")),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const dryRun = process.argv.slice(2).join() === "--dry-run";
  if (process.argv.length > 2 && !dryRun)
    throw new Error("Usage: npm run release:prepare -- [--dry-run]");
  const version = await checkVersions(process.cwd());
  const ref = process.env.GITHUB_REF ?? "local-dry-run";
  if (!dryRun && !ref.startsWith("refs/tags/"))
    throw new Error("Release preparation requires a release tag");
  const identity = releaseIdentity(
    version,
    process.env.GITHUB_SHA ??
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dryRun ? undefined : ref.slice(10),
  );
  const runId = process.env.GITHUB_RUN_ID ?? "local",
    attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const result = await prepareRelease(process.cwd(), identity, {
    ref,
    runId,
    attempt,
    url: `https://github.com/${repository}/actions/runs/${runId}`,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Prepared nodePass ${version}\n\nSource: \`${identity.commit}\`\n\nImage: \`${result.manifest.image.reference}\`\n\n${dryRun ? "Packaging dry run; publication is disabled for this event." : "Inspect the run-scoped release artifact and the complete Required release checks result before approving the release environment."}\n`,
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `digest=${result.digest}\nchecksums=${result.checksumsSha256}\nversion=${version}\nprerelease=${identity.prerelease}\n`,
    );
  }
  console.log(
    `${dryRun ? "Dry-run" : "Release"} artifacts prepared: ${result.manifest.image.reference}`,
  );
}
