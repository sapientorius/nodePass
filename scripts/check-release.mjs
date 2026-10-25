import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import {
  checkVersions,
  releaseIdentity,
  repository,
} from "./release-policy.mjs";

const version = await checkVersions(process.cwd());
if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
  if (process.env.GITHUB_REPOSITORY !== repository)
    throw new Error("Release repository mismatch");
  const identity = releaseIdentity(
    version,
    process.env.GITHUB_SHA,
    process.env.GITHUB_REF.slice(10),
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== identity.commit)
    throw new Error("Checkout differs from release commit");
  execFileSync("git", ["merge-base", "--is-ancestor", head, "origin/main"]);
}
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nprerelease=${version.includes("-rc.")}\n`,
  );
console.log(`Release versions verified: ${version}`);
