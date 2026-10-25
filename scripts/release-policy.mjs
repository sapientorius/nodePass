import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export const repository = "sapientorius/nodePass";
export const image = "ghcr.io/sapientorius/nodepass";
export const workspaces = ["contracts", "server", "web"];
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function releaseIdentity(version, commit, tag = `nodepass-v${version}`) {
  if (!versionPattern.test(version)) throw new Error("Invalid release version");
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid source commit");
  if (tag !== `nodepass-v${version}`)
    throw new Error("Release tag/version mismatch");
  return { version, commit, tag, image, prerelease: version.includes("-rc.") };
}

export function validateRemoteRelease(
  release,
  identity,
  notes,
  hashes,
  complete = false,
) {
  if (
    release.tag_name !== identity.tag ||
    release.target_commitish !== identity.commit ||
    release.prerelease !== identity.prerelease ||
    release.name !== `nodePass ${identity.version}` ||
    release.body !== notes ||
    !Array.isArray(release.assets)
  )
    throw new Error(
      "Existing release identity or notes differ; refusing modification",
    );
  const names = new Set();
  for (const asset of release.assets) {
    if (
      names.has(asset.name) ||
      !hashes.has(asset.name) ||
      asset.digest !== hashes.get(asset.name)
    )
      throw new Error(
        "Existing release assets differ; refusing overwrite or unreviewed assets",
      );
    names.add(asset.name);
  }
  if ((complete || !release.draft) && names.size !== hashes.size)
    throw new Error("Incomplete remote release assets");
  if (!release.draft && release.immutable !== true)
    throw new Error("Existing published release is mutable");
  return release.draft ? "draft" : "published";
}

export function requireVersionAdvance(previous, next) {
  releaseIdentity(previous, "0".repeat(40));
  releaseIdentity(next, "0".repeat(40));
  if (previous.includes("-") || next.includes("-"))
    throw new Error("Stable version comparison required");
  const before = previous.split(".").map(BigInt),
    after = next.split(".").map(BigInt);
  const changed = after.findIndex((part, index) => part !== before[index]);
  if (changed === -1 || after[changed] < before[changed])
    throw new Error("Stable releases must advance the version");
}

export async function checkVersions(root) {
  const json = async (path) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
  const pkg = await json("package.json"),
    lock = await json("package-lock.json");
  releaseIdentity(pkg.version, "0".repeat(40));
  if (
    pkg.private !== true ||
    lock.version !== pkg.version ||
    lock.packages[""].version !== pkg.version
  )
    throw new Error("Root/lockfile version mismatch or public npm package");
  for (const name of workspaces) {
    const path = `packages/${name}`,
      workspace = await json(`${path}/package.json`),
      locked = lock.packages[path];
    if (
      workspace.version !== pkg.version ||
      workspace.private !== true ||
      locked?.version !== pkg.version
    )
      throw new Error(`Workspace/lockfile version mismatch: ${name}`);
    for (const [dependency, value] of Object.entries(
      workspace.dependencies ?? {},
    )) {
      if (
        dependency.startsWith("@nodepass/") &&
        (value !== pkg.version || locked.dependencies?.[dependency] !== value)
      )
        throw new Error(`Internal dependency version mismatch: ${name}`);
    }
  }
  const source = await readFile(
    join(root, "packages/contracts/src/version.ts"),
    "utf8",
  );
  if (source.trim() !== `export const version = "${pkg.version}";`)
    throw new Error("Shared API version mismatch");
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  if (!changelog.includes(`## [${pkg.version}]`))
    throw new Error("Missing version in changelog");
  return pkg.version;
}

export async function sha256(path) {
  if (!(await lstat(path)).isFile())
    throw new Error("Expected a regular artifact file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyOci(directory, identity, expectedConfig) {
  for (const path of [
    directory,
    join(directory, "blobs"),
    join(directory, "blobs/sha256"),
  ])
    if (!(await lstat(path)).isDirectory())
      throw new Error("Expected regular OCI directories");
  if (!(await lstat(join(directory, "index.json"))).isFile())
    throw new Error("Expected regular OCI index");
  const index = JSON.parse(
    await readFile(join(directory, "index.json"), "utf8"),
  );
  if (index.schemaVersion !== 2 || index.manifests?.length !== 1)
    throw new Error("Expected exactly one release image");
  async function blob(descriptor, json = false) {
    if (
      !digestPattern.test(descriptor?.digest) ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size < 1
    )
      throw new Error("Invalid OCI descriptor");
    const path = join(directory, "blobs/sha256", descriptor.digest.slice(7));
    if (
      (await lstat(path)).size !== descriptor.size ||
      `sha256:${await sha256(path)}` !== descriptor.digest
    )
      throw new Error("OCI artifact checksum mismatch");
    return json ? JSON.parse(await readFile(path, "utf8")) : undefined;
  }
  const descriptor = index.manifests[0],
    manifest = await blob(descriptor, true);
  if (
    manifest.schemaVersion !== 2 ||
    ![
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(manifest.mediaType) ||
    descriptor.mediaType !== manifest.mediaType ||
    !manifest.layers?.length
  )
    throw new Error("Unsupported release manifest");
  const config = await blob(manifest.config, true);
  const matchesTestedImage =
    typeof expectedConfig === "string"
      ? manifest.config.digest === expectedConfig
      : expectedConfig?.Os === "linux" &&
        expectedConfig.Architecture === "amd64" &&
        (expectedConfig.Id === manifest.config.digest ||
          (expectedConfig.Id === descriptor.digest &&
            expectedConfig.Descriptor?.digest === descriptor.digest &&
            expectedConfig.Descriptor.mediaType === descriptor.mediaType));
  if (
    config.os !== "linux" ||
    config.architecture !== "amd64" ||
    !matchesTestedImage
  )
    throw new Error("OCI image differs from the tested linux/amd64 image");
  const labels = config.config?.Labels;
  if (
    labels?.["org.opencontainers.image.revision"] !== identity.commit ||
    labels?.["org.opencontainers.image.version"] !== identity.version ||
    labels?.["org.opencontainers.image.source"] !==
      `https://github.com/${repository}`
  )
    throw new Error("Image/source identity mismatch");
  for (const layer of manifest.layers) await blob(layer);
  return descriptor.digest;
}

export async function verifyChecksums(directory) {
  const lines = (await readFile(join(directory, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n"),
    seen = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(line);
    if (!match || seen.has(match[2]) || match[2] === "SHA256SUMS")
      throw new Error("Invalid release checksum list");
    seen.add(match[2]);
    if ((await sha256(join(directory, match[2]))) !== match[1])
      throw new Error("Release asset checksum mismatch");
  }
  for (const required of ["sbom.cdx.json", "release-manifest.json"])
    if (!seen.has(required))
      throw new Error("Incomplete release checksum list");
  return seen;
}
