import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { validateReleaseSecurity } from "../packages/contracts/src/updates.ts";
import {
  checkVersions,
  releaseIdentity,
  repository,
  verifyChecksums,
  verifyOci,
  sha256,
} from "./release-policy.mjs";

const version = await checkVersions(process.cwd());
if (
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REPOSITORY !== repository ||
  !process.env.GITHUB_REF?.startsWith("refs/tags/")
)
  throw new Error("Publication is restricted to this repository's tag pushes");
const identity = releaseIdentity(
  version,
  process.env.GITHUB_SHA,
  process.env.GITHUB_REF.slice(10),
);
if (
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
  identity.commit
)
  throw new Error("Unexpected checkout");
execFileSync("git", [
  "merge-base",
  "--is-ancestor",
  identity.commit,
  "origin/main",
]);
if (!/^[a-f0-9]{64}$/.test(process.env.EXPECTED_CHECKSUMS_SHA256))
  throw new Error("Missing verification job checksum identity");
const directory = ".cache/release/assets",
  checked = await verifyChecksums(
    directory,
    process.env.EXPECTED_CHECKSUMS_SHA256,
  );
const actual = await readdir(directory);
if (
  actual.length !== checked.size + 1 ||
  actual.some((name) => name !== "SHA256SUMS" && !checked.has(name))
)
  throw new Error("Unexpected release assets");
const manifest = JSON.parse(
  await readFile(`${directory}/release-manifest.json`, "utf8"),
);
if (
  JSON.stringify(validateReleaseSecurity(manifest.security, version)) !==
  JSON.stringify(
    validateReleaseSecurity(
      JSON.parse(await readFile("release-security.json", "utf8")),
      version,
    ),
  )
)
  throw new Error(
    "Release security catalogue differs from the reviewed source",
  );
if (
  manifest.format !== "nodepass-release-1" ||
  manifest.version !== version ||
  manifest.tag !== identity.tag ||
  manifest.source?.repository !== repository ||
  manifest.source.commit !== identity.commit ||
  manifest.source.ref !== process.env.GITHUB_REF ||
  manifest.verification?.runId !== process.env.GITHUB_RUN_ID ||
  manifest.verification.url !==
    `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` ||
  manifest.verification.requiredCheck !== "Required release checks" ||
  !/^[1-9]\d*$/.test(manifest.verification.attempt) ||
  Number(manifest.verification.attempt) >
    Number(process.env.GITHUB_RUN_ATTEMPT) ||
  manifest.image?.name !== identity.image ||
  manifest.image.reference !== `${identity.image}@${manifest.image.digest}` ||
  !checked.has(`nodepass-${version}-deploy.tar.gz`) ||
  checked.size !== 3
)
  throw new Error("Release artifact/source/run mismatch");
if ((await sha256(".cache/release/release-notes.md")) !== manifest.notesSha256)
  throw new Error("Release notes differ from the verified manifest");
const digest = await verifyOci(
  ".cache/release/oci",
  identity,
  manifest.image.configDigest,
);
if (digest !== manifest.image.digest || digest !== process.env.EXPECTED_DIGEST)
  throw new Error("Release image digest differs from verification output");
console.log(`Verified release bundle for ${identity.tag}: ${digest}`);
