import { readFile, readdir } from "node:fs/promises";
import {
  repository,
  sha256,
  releaseIdentity,
  validateRemoteRelease,
  requireVersionAdvance,
  findReleaseForTag,
  requireRemoteTagCommit,
} from "./release-policy.mjs";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== repository ||
  process.env.GITHUB_EVENT_NAME !== "push"
)
  throw new Error("Protected release workflow required");
const manifest = JSON.parse(
  await readFile(".cache/release/assets/release-manifest.json", "utf8"),
);
if (
  process.env.GITHUB_REF !== `refs/tags/${manifest.tag}` ||
  process.env.GITHUB_SHA !== manifest.source.commit
)
  throw new Error("Release source mismatch");
const headers = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
async function api(path, options = {}) {
  return fetch(`https://api.github.com/repos/${repository}/${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
}
const prerelease = manifest.version.includes("-rc.");
const identity = releaseIdentity(
  manifest.version,
  manifest.source.commit,
  manifest.tag,
);
await requireRemoteTagCommit(api, identity);
const notes = await readFile(".cache/release/release-notes.md", "utf8");
const names = (await readdir(".cache/release/assets")).sort();
const hashes = new Map(
  await Promise.all(
    names.map(async (name) => [
      name,
      `sha256:${await sha256(`.cache/release/assets/${name}`)}`,
    ]),
  ),
);
async function requireNewStableVersion() {
  if (prerelease) return;
  const latest = await api("releases/latest");
  if (latest.status !== 404) {
    if (!latest.ok)
      throw new Error(`Cannot inspect latest release (${latest.status})`);
    requireVersionAdvance(
      (await latest.json()).tag_name.replace(/^nodepass-v/, ""),
      manifest.version,
    );
  }
}
let release = await findReleaseForTag(api, manifest.tag),
  response;
if (!release) {
  await requireNewStableVersion();
  response = await api("releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: manifest.tag,
      target_commitish: manifest.source.commit,
      name: `nodePass ${manifest.version}`,
      draft: true,
      prerelease,
      body: notes,
    }),
  });
  if (!response.ok)
    throw new Error(`Cannot create draft release (${response.status})`);
  release = await response.json();
} else {
  if (validateRemoteRelease(release, identity, notes, hashes) === "published") {
    console.log(
      `Identical immutable release already published: ${release.html_url}`,
    );
    process.exit(0);
  }
  await requireNewStableVersion();
}
validateRemoteRelease(release, identity, notes, hashes);
const upload = new URL(release.upload_url.replace(/\{.*$/, ""));
if (
  upload.origin !== "https://uploads.github.com" ||
  upload.pathname !== `/repos/${repository}/releases/${release.id}/assets`
)
  throw new Error("Unexpected release upload endpoint");
for (const name of names) {
  const path = `.cache/release/assets/${name}`,
    hash = `sha256:${await sha256(path)}`,
    existing = release.assets.find((asset) => asset.name === name);
  if (existing) {
    if (existing.digest !== hash)
      throw new Error("Existing draft asset differs; refusing overwrite");
    continue;
  }
  upload.searchParams.set("name", name);
  const uploaded = await fetch(upload, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: await readFile(path),
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  if (!uploaded.ok || (await uploaded.json()).digest !== hash)
    throw new Error("Release asset upload/checksum failed");
}
response = await api(`releases/${release.id}`);
if (!response.ok)
  throw new Error(`Cannot verify complete draft (${response.status})`);
if (
  validateRemoteRelease(
    await response.json(),
    identity,
    notes,
    hashes,
    true,
  ) === "published"
) {
  console.log(
    "Identical immutable release was already published; no changes required.",
  );
  process.exit(0);
}
await requireRemoteTagCommit(api, identity);
response = await api(`releases/${release.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    draft: false,
    make_latest: prerelease ? "false" : "true",
  }),
});
if (!response.ok)
  throw new Error(`Cannot publish release (${response.status})`);
const published = await response.json();
if (!published.immutable)
  throw new Error(
    "Release published without immutability; enable immutable releases before any further publication",
  );
console.log(`Published immutable release: ${published.html_url}`);
