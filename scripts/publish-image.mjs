import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { image, repository } from "./release-policy.mjs";

export async function existingRegistryDigest(tag, token, request = fetch) {
  if (
    !/^(?:\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?|sha-[a-f0-9]{40}|latest)$/.test(tag)
  )
    throw new Error("Invalid image tag");
  const response = await request(
    `https://ghcr.io/v2/sapientorius/nodepass/manifests/${tag}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Cannot check existing image tag (${response.status})`);
  const calculated =
    "sha256:" +
    createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex");
  if (response.headers.get("docker-content-digest") !== calculated)
    throw new Error("Remote manifest checksum mismatch");
  return calculated;
}

export function allowTag(existing, expected) {
  if (existing !== null && existing !== expected)
    throw new Error("Refusing to overwrite a published image version");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_EVENT_NAME !== "push" ||
    !process.env.GITHUB_REF?.startsWith("refs/tags/nodepass-v")
  )
    throw new Error("Only the protected release workflow may publish images");
  const latest = process.argv.slice(2).join() === "--latest";
  if (process.argv.length > 2 && !latest)
    throw new Error("Unexpected publication arguments");
  const manifest = JSON.parse(
    await readFile(".cache/release/assets/release-manifest.json", "utf8"),
  );
  const version = manifest.version,
    digest = manifest.image.digest;
  if (
    manifest.image.name !== image ||
    process.env.GITHUB_REF !== `refs/tags/nodepass-v${version}`
  )
    throw new Error("Publication identity mismatch");
  const headers = {
    Authorization:
      "Basic " +
      Buffer.from(
        `${process.env.GITHUB_ACTOR}:${process.env.GH_TOKEN}`,
      ).toString("base64"),
  };
  const response = await fetch(
    "https://ghcr.io/token?service=ghcr.io&scope=repository:sapientorius/nodepass:pull,push",
    { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok)
    throw new Error(`Registry authorization failed (${response.status})`);
  const token = (await response.json()).token;
  if (typeof token !== "string" || !token)
    throw new Error("Missing registry authorization");
  const run = (args) =>
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-e",
        "DOCKER_CONFIG=/auth",
        "--mount",
        `type=bind,src=${resolve(".cache/release")},dst=/release,readonly`,
        "--mount",
        `type=bind,src=${process.env.DOCKER_CONFIG || join(homedir(), ".docker")},dst=/auth,readonly`,
        "ghcr.io/regclient/regctl@sha256:45b57933c2b67bb1e280b4baaa220ef1ab212c81268ab19589fa1e83719c7c82",
        ...args,
      ],
      { stdio: "inherit" },
    );
  if (latest) {
    if (version.includes("-"))
      throw new Error("Prereleases cannot update latest");
    const release = await fetch(
      `https://api.github.com/repos/${repository}/releases/latest`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (
      !release.ok ||
      (await release.json()).tag_name !== `nodepass-v${version}`
    )
      throw new Error("Only the current stable release may update latest");
    run(["image", "copy", `${image}@${digest}`, `${image}:latest`]);
    if ((await existingRegistryDigest("latest", token)) !== digest)
      throw new Error("Published latest digest mismatch");
  } else {
    const tags = [version, `sha-${manifest.source.commit}`];
    // Check all immutable names before writing any of them. Errors never mean 'absent'.
    const existing = await Promise.all(
      tags.map((tag) => existingRegistryDigest(tag, token)),
    );
    for (const value of existing) allowTag(value, digest);
    for (let index = 0; index < tags.length; index++) {
      if (existing[index] === null)
        run([
          "image",
          "copy",
          "ocidir:///release/oci:release",
          `${image}:${tags[index]}`,
        ]);
      if ((await existingRegistryDigest(tags[index], token)) !== digest)
        throw new Error("Published image digest mismatch");
    }
    const anonymous = resolve(".cache/anonymous-registry");
    await mkdir(anonymous, { recursive: true });
    await writeFile(join(anonymous, "config.json"), '{"auths":{}}\n', {
      flag: "wx",
      mode: 0o600,
    });
    const environment = { ...process.env };
    for (const key of [
      "DOCKER_CONFIG",
      "DOCKER_AUTH_CONFIG",
      "REGISTRY_AUTH_FILE",
      "GH_TOKEN",
      "GITHUB_TOKEN",
    ])
      delete environment[key];
    try {
      execFileSync(
        "docker",
        ["--config", anonymous, "pull", `${image}@${digest}`],
        { stdio: "inherit", env: environment },
      );
    } catch (error) {
      throw new Error(
        "Anonymous digest pull failed. Set the GHCR package public, then rerun failed jobs from this run without rebuilding.",
        { cause: error },
      );
    }
  }
}
