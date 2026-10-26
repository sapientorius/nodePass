import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkVersions,
  releaseIdentity,
  repository,
  sha256,
  verifyChecksums,
  verifyOci,
  validateRemoteRelease,
  requireVersionAdvance,
  findReleaseForTag,
  requireRemoteTagCommit,
} from "../scripts/release-policy.mjs";
import { validateHosting } from "../scripts/check-release-hosting.mjs";
import { allowTag, existingRegistryDigest } from "../scripts/publish-image.mjs";

const directories: string[] = [],
  commit = "a".repeat(40);
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "nodepass-release-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("release source and version boundaries", () => {
  it.each(["0.1.0", "0.1.0-rc.1", "1.0.0", "2.10.3-rc.12"])(
    "accepts a complete product identity for %s",
    (version) => {
      expect(releaseIdentity(version, commit).tag).toBe(`nodepass-v${version}`);
    },
  );
  it.each([
    "v1.0.0",
    "01.0.0",
    "1.0",
    "1.0.0-rc.0",
    "1.0.0-rc.01",
    "1.0.0+build",
    "1.0.0\nlatest=x",
    "1.0.0\n",
    "$(command)",
    "1.0.0-beta.1",
  ])("rejects ambiguous or injectable version %s", (version) => {
    expect(() => releaseIdentity(version, commit)).toThrow("version");
  });
  it("rejects a different tag and incomplete source commit", () => {
    expect(() => releaseIdentity("0.1.0", commit, "nodepass-v0.2.0")).toThrow(
      "mismatch",
    );
    expect(() => releaseIdentity("0.1.0", "main")).toThrow("commit");
  });
  async function versionFixture() {
    const directory = await temporary();
    for (const file of [
      "package.json",
      "package-lock.json",
      "README.md",
      "SECURITY.md",
      "CHANGELOG.md",
      "release-security.json",
      "packages/contracts/package.json",
      "packages/server/package.json",
      "packages/web/package.json",
      "packages/contracts/src/version.ts",
    ]) {
      await mkdir(join(directory, file, ".."), { recursive: true });
      await cp(resolve(file), join(directory, file));
    }
    return directory;
  }
  it("synchronizes a release bump without changing third-party lock entries and rejects drift", async () => {
    const directory = await versionFixture(),
      before = JSON.parse(
        await readFile(join(directory, "package-lock.json"), "utf8"),
      );
    execFileSync(
      process.execPath,
      [resolve("scripts/release-version.mjs"), "0.2.0-rc.2"],
      { cwd: directory },
    );
    await expect(checkVersions(directory)).rejects.toThrow("changelog");
    await writeFile(
      join(directory, "CHANGELOG.md"),
      "# Changelog\n\n## [0.2.0-rc.2]\n\nSynthetic release.\n",
    );
    expect(await checkVersions(directory)).toBe("0.2.0-rc.2");
    const securityPath = join(directory, "release-security.json");
    const security = await readFile(securityPath, "utf8");
    await writeFile(
      securityPath,
      JSON.stringify({
        format: "nodepass-security-1",
        fixes: [
          {
            id: "NP-TEST",
            affected: [{ introduced: "0.1.0", fixed: "9.0.0" }],
          },
        ],
      }),
    );
    await expect(checkVersions(directory)).rejects.toThrow("interval");
    await writeFile(securityPath, security);
    const after = JSON.parse(
      await readFile(join(directory, "package-lock.json"), "utf8"),
    );
    for (const [path, data] of Object.entries(before.packages))
      if (path.startsWith("node_modules/"))
        expect(after.packages[path]).toEqual(data);
    const path = join(directory, "packages/server/package.json"),
      pkg = JSON.parse(await readFile(path, "utf8"));
    pkg.dependencies["@nodepass/contracts"] = "0.1.0";
    await writeFile(path, JSON.stringify(pkg));
    await expect(checkVersions(directory)).rejects.toThrow(
      "dependency version mismatch",
    );
  });
});

describe("release OCI integrity and tested-image identity", () => {
  it("rejects a consistently replaced checksum list and assets against the verification job identity", async () => {
    const directory = await temporary();
    for (const name of ["sbom.cdx.json", "release-manifest.json"])
      await writeFile(join(directory, name), "{}");
    const hash = await sha256(join(directory, "sbom.cdx.json"));
    await writeFile(
      join(directory, "SHA256SUMS"),
      `${hash}  sbom.cdx.json\n${hash}  release-manifest.json\n`,
    );
    const expected = await sha256(join(directory, "SHA256SUMS"));
    expect((await verifyChecksums(directory, expected)).size).toBe(2);
    await writeFile(join(directory, "sbom.cdx.json"), '{"replaced":true}');
    const replacement = await sha256(join(directory, "sbom.cdx.json"));
    await writeFile(
      join(directory, "SHA256SUMS"),
      `${replacement}  sbom.cdx.json\n${hash}  release-manifest.json\n`,
    );
    await expect(verifyChecksums(directory, expected)).rejects.toThrow(
      "verification job output",
    );
  });
  async function fixture(
    options: {
      architecture?: string;
      revision?: string;
      manifestType?: string;
    } = {},
  ) {
    const directory = await temporary();
    await mkdir(join(directory, "blobs/sha256"), { recursive: true });
    async function blob(data: Buffer | object) {
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.from(JSON.stringify(data));
      const hash = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(directory, "blobs/sha256", hash), bytes);
      return { digest: `sha256:${hash}`, size: bytes.length };
    }
    const identity = releaseIdentity("0.1.0-rc.1", commit);
    const config = await blob({
      os: "linux",
      architecture: options.architecture ?? "amd64",
      config: {
        Labels: {
          "org.opencontainers.image.revision": options.revision ?? commit,
          "org.opencontainers.image.version": identity.version,
          "org.opencontainers.image.source": `https://github.com/${repository}`,
        },
      },
    });
    const layer = await blob(Buffer.from("synthetic image layer"));
    const descriptor = {
      ...(await blob({
        schemaVersion: 2,
        mediaType:
          options.manifestType ?? "application/vnd.oci.image.manifest.v1+json",
        config,
        layers: [layer],
      })),
      mediaType:
        options.manifestType ?? "application/vnd.oci.image.manifest.v1+json",
    };
    await writeFile(
      join(directory, "index.json"),
      JSON.stringify({ schemaVersion: 2, manifests: [descriptor] }),
    );
    return { directory, identity, config, layer, descriptor };
  }
  it("verifies every blob and binds the OCI image to the tested configuration", async () => {
    const f = await fixture();
    expect(await verifyOci(f.directory, f.identity, f.config.digest)).toBe(
      f.descriptor.digest,
    );
    await expect(
      verifyOci(f.directory, f.identity, `sha256:${"b".repeat(64)}`),
    ).rejects.toThrow("tested");
    await writeFile(
      join(f.directory, "blobs/sha256", f.layer.digest.slice(7)),
      "tampered layer",
    );
    await expect(
      verifyOci(f.directory, f.identity, f.config.digest),
    ).rejects.toThrow("checksum");
  });
  it("binds classic Docker config IDs and containerd manifest IDs without accepting unrelated inspections", async () => {
    const f = await fixture();
    expect(
      await verifyOci(f.directory, f.identity, {
        Id: f.config.digest,
        Os: "linux",
        Architecture: "amd64",
      }),
    ).toBe(f.descriptor.digest);
    const inspected = {
      Id: f.descriptor.digest,
      Os: "linux",
      Architecture: "amd64",
      Descriptor: {
        digest: f.descriptor.digest,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
      },
    };
    expect(await verifyOci(f.directory, f.identity, inspected)).toBe(
      f.descriptor.digest,
    );
    await expect(
      verifyOci(f.directory, f.identity, {
        ...inspected,
        Id: `sha256:${"c".repeat(64)}`,
      }),
    ).rejects.toThrow("tested");
    await expect(
      verifyOci(f.directory, f.identity, {
        ...inspected,
        Descriptor: undefined,
      }),
    ).rejects.toThrow("tested");
  });
  it("rejects untested architectures and another source commit", async () => {
    for (const options of [
      { architecture: "arm64" },
      { revision: "b".repeat(40) },
    ]) {
      const f = await fixture(options);
      await expect(
        verifyOci(f.directory, f.identity, f.config.digest),
      ).rejects.toThrow();
    }
  });
  it("accepts standard Docker schema 2 manifests in an OCI layout and rejects unknown formats", async () => {
    const classic = await fixture({
      manifestType: "application/vnd.docker.distribution.manifest.v2+json",
    });
    expect(
      await verifyOci(
        classic.directory,
        classic.identity,
        classic.config.digest,
      ),
    ).toBe(classic.descriptor.digest);
    const unknown = await fixture({
      manifestType: "application/x-unknown-manifest",
    });
    await expect(
      verifyOci(unknown.directory, unknown.identity, unknown.config.digest),
    ).rejects.toThrow("Unsupported");
  });
  it("rejects extra manifests and descriptor path traversal before file access", async () => {
    const f = await fixture();
    await writeFile(
      join(f.directory, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [f.descriptor, f.descriptor],
      }),
    );
    await expect(
      verifyOci(f.directory, f.identity, f.config.digest),
    ).rejects.toThrow("exactly one");
    await writeFile(
      join(f.directory, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        manifests: [{ digest: "sha256:../../private", size: 1 }],
      }),
    );
    await expect(
      verifyOci(f.directory, f.identity, f.config.digest),
    ).rejects.toThrow("descriptor");
  });
  it("rejects altered, missing, duplicate and escaping release asset checksums", async () => {
    const directory = await temporary();
    for (const name of ["sbom.cdx.json", "release-manifest.json"])
      await writeFile(join(directory, name), "{}");
    const hash = await sha256(join(directory, "sbom.cdx.json")),
      valid = `${hash}  sbom.cdx.json\n${hash}  release-manifest.json\n`;
    await writeFile(join(directory, "SHA256SUMS"), valid);
    expect((await verifyChecksums(directory)).size).toBe(2);
    for (const invalid of [
      `${hash}  ../secret\n`,
      `${hash}  sbom.cdx.json\n`,
      valid + `${hash}  sbom.cdx.json\n`,
      valid.replace(hash, "0".repeat(64)),
    ]) {
      await writeFile(join(directory, "SHA256SUMS"), invalid);
      await expect(verifyChecksums(directory)).rejects.toThrow();
    }
  });
});

describe("publication refuses permission and registry ambiguity", () => {
  it("verifies lightweight and annotated tags against the tested commit rather than release branch metadata", async () => {
    const identity = releaseIdentity("0.1.0-rc.1", commit);
    const direct = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ object: { type: "commit", sha: commit } }),
        ),
      );
    await expect(
      requireRemoteTagCommit(direct, identity),
    ).resolves.toBeUndefined();
    const annotated = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ object: { type: "tag", sha: "b".repeat(40) } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ object: { type: "commit", sha: commit } }),
        ),
      );
    await expect(
      requireRemoteTagCommit(annotated, identity),
    ).resolves.toBeUndefined();
    expect(annotated.mock.calls.map(([path]) => path)).toEqual([
      `git/ref/tags/${identity.tag}`,
      `git/tags/${"b".repeat(40)}`,
    ]);
  });
  it("refuses a moved tag, invalid target, failed lookup and excessive tag indirection", async () => {
    const identity = releaseIdentity("0.1.0-rc.1", commit);
    for (const response of [
      new Response("", { status: 403 }),
      new Response(
        JSON.stringify({ object: { type: "commit", sha: "b".repeat(40) } }),
      ),
      new Response(JSON.stringify({ object: { type: "blob", sha: commit } })),
      new Response(
        JSON.stringify({ object: { type: "tag", sha: "../../other" } }),
      ),
    ])
      await expect(
        requireRemoteTagCommit(vi.fn().mockResolvedValue(response), identity),
      ).rejects.toThrow();
    const loop = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ object: { type: "tag", sha: commit } }),
          ),
      );
    await expect(requireRemoteTagCommit(loop, identity)).rejects.toThrow(
      "indirection limit",
    );
  });
  it("finds existing drafts through the paginated authenticated release list", async () => {
    const draft = { tag_name: "nodepass-v0.1.0-rc.1", draft: true };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            Array.from({ length: 100 }, (_, index) => ({
              tag_name: `other-${index}`,
            })),
          ),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([draft])));
    expect(await findReleaseForTag(request, draft.tag_name)).toEqual(draft);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "releases?per_page=100&page=1",
      "releases?per_page=100&page=2",
    ]);
    expect(
      await findReleaseForTag(
        vi.fn().mockResolvedValue(new Response("[]")),
        draft.tag_name,
      ),
    ).toBeNull();
  });
  it("never treats API failure or ambiguous drafts as a missing release", async () => {
    const tag = "nodepass-v0.1.0-rc.1";
    for (const response of [
      new Response("", { status: 403 }),
      new Response("", { status: 404 }),
      new Response("{}"),
      new Response(JSON.stringify([{ tag_name: tag }, { tag_name: tag }])),
    ])
      await expect(
        findReleaseForTag(vi.fn().mockResolvedValue(response), tag),
      ).rejects.toThrow();
    await expect(
      findReleaseForTag(
        vi.fn().mockRejectedValue(new Error("Synthetic network failure")),
        tag,
      ),
    ).rejects.toThrow("network");
  });
  it("resumes matching drafts and recognizes an identical immutable publication without rewriting it", () => {
    const identity = releaseIdentity("0.1.0-rc.1", commit),
      notes = "Reviewed release notes\n",
      hashes = new Map([
        ["sbom.cdx.json", `sha256:${"a".repeat(64)}`],
        ["release-manifest.json", `sha256:${"b".repeat(64)}`],
      ]);
    const release = {
      tag_name: identity.tag,
      target_commitish: commit,
      name: `nodePass ${identity.version}`,
      prerelease: true,
      body: notes,
      draft: true,
      immutable: false,
      assets: [] as any[],
    };
    expect(validateRemoteRelease(release, identity, notes, hashes)).toBe(
      "draft",
    );
    expect(() =>
      validateRemoteRelease(release, identity, notes, hashes, true),
    ).toThrow("Incomplete");
    const complete = {
      ...release,
      draft: false,
      immutable: true,
      assets: [...hashes].map(([name, digest]) => ({ name, digest })),
    };
    expect(validateRemoteRelease(complete, identity, notes, hashes)).toBe(
      "published",
    );
    for (const modified of [
      { ...complete, body: "Someone's changed notes" },
      { ...complete, immutable: false },
      { ...complete, tag_name: "nodepass-v0.2.0" },
      {
        ...complete,
        assets: [
          ...complete.assets,
          { name: "unreviewed.txt", digest: "sha256:unexpected" },
        ],
      },
      { ...complete, assets: [complete.assets[0], complete.assets[0]] },
      { ...complete, assets: [] },
    ])
      expect(() =>
        validateRemoteRelease(modified, identity, notes, hashes),
      ).toThrow();
  });
  it("allows only increasing stable versions to become the new stable release", () => {
    for (const [before, after] of [
      ["0.1.0", "0.1.1"],
      ["0.9.0", "0.10.0"],
      ["0.10.5", "1.0.0"],
    ])
      expect(() => requireVersionAdvance(before, after)).not.toThrow();
    for (const [before, after] of [
      ["0.1.0", "0.1.0"],
      ["0.2.0", "0.1.9"],
      ["0.1.0", "0.1.1-rc.1"],
      ["invalid", "1.0.0"],
    ])
      expect(() => requireVersionAdvance(before, after)).toThrow();
  });
  const branch = { protected: true },
    rules = [
      { type: "pull_request" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "Required release checks", integration_id: 15368 },
          ],
        },
      },
    ],
    environment = {
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "User", reviewer: { id: 1 } }],
        },
      ],
      deployment_branch_policy: { custom_branch_policies: true },
    },
    policies = { branch_policies: [{ type: "tag", name: "nodepass-v*" }] };
  it("accepts required checks and approval, but rejects missing rules, reviewer or broader deployment patterns", () => {
    expect(() =>
      validateHosting(branch, rules, environment, policies),
    ).not.toThrow();
    expect(() =>
      validateHosting({ protected: false }, rules, environment, policies),
    ).toThrow();
    expect(() => validateHosting(branch, [], environment, policies)).toThrow();
    expect(() =>
      validateHosting(
        branch,
        rules,
        { ...environment, protection_rules: [] },
        policies,
      ),
    ).toThrow();
    expect(() =>
      validateHosting(branch, rules, environment, {
        branch_policies: [
          ...policies.branch_policies,
          { type: "branch", name: "*" },
        ],
      }),
    ).toThrow();
    const wrongSource = structuredClone(rules);
    wrongSource[1]!.parameters!.required_status_checks[0]!.integration_id = 1;
    expect(() =>
      validateHosting(branch, wrongSource, environment, policies),
    ).toThrow();
  });
  it("reuses only an identical image digest and never overwrites a published version", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(() => allowTag(null, digest)).not.toThrow();
    expect(() => allowTag(digest, digest)).not.toThrow();
    expect(() => allowTag(`sha256:${"b".repeat(64)}`, digest)).toThrow(
      "overwrite",
    );
  });
  it("treats only a definite 404 as absent; authentication and network failures block publication", async () => {
    const request = vi.fn();
    request.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(
      await existingRegistryDigest("0.1.0", "synthetic-token", request),
    ).toBeNull();
    for (const status of [401, 403, 429, 500]) {
      request.mockResolvedValueOnce(new Response("", { status }));
      await expect(
        existingRegistryDigest("0.1.0", "synthetic-token", request),
      ).rejects.toThrow("Cannot check");
    }
    request.mockRejectedValueOnce(new Error("Synthetic network failure"));
    await expect(
      existingRegistryDigest("0.1.0", "synthetic-token", request),
    ).rejects.toThrow("network failure");
    await expect(
      existingRegistryDigest("0.1.0/../../other", "synthetic-token", request),
    ).rejects.toThrow("Invalid");
  });
  it("verifies the remote manifest body against its declared digest", async () => {
    const bytes = "synthetic manifest",
      digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { "docker-content-digest": digest } }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: { "docker-content-digest": `sha256:${"0".repeat(64)}` },
        }),
      );
    expect(
      await existingRegistryDigest("0.1.0", "synthetic-token", request),
    ).toBe(digest);
    await expect(
      existingRegistryDigest("0.1.0", "synthetic-token", request),
    ).rejects.toThrow("checksum");
  });
});
