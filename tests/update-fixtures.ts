import { createHash } from "node:crypto";
import type { ReleaseSecurity } from "@nodepass/contracts";
export const securityFixture: ReleaseSecurity = {
  format: "nodepass-security-1",
  fixes: [
    {
      id: "NP-TEST-1",
      affected: [{ introduced: "0.1.0-rc.1", fixed: "0.2.0" }],
    },
  ],
};
export function updateFixture(
  version = "0.3.0",
  security: unknown = securityFixture,
  notes = `# nodePass ${version}\n\nSynthetic release notes.\n`,
) {
  const manifest = {
    format: "nodepass-release-1",
    version,
    tag: `nodepass-v${version}`,
    source: {
      repository: "sapientorius/nodePass",
      commit: "a".repeat(40),
      ref: `refs/tags/nodepass-v${version}`,
    },
    security,
    notesSha256: createHash("sha256").update(notes, "utf8").digest("hex"),
  };
  const data = Buffer.from(JSON.stringify(manifest));
  const row = {
    id: 100,
    tag_name: manifest.tag,
    draft: false,
    prerelease: version.includes("-"),
    immutable: true,
    body: notes,
    published_at: "2026-10-26T10:00:00Z",
    html_url: `https://github.com/sapientorius/nodePass/releases/tag/${manifest.tag}`,
    assets: [
      {
        id: 123,
        name: "release-manifest.json",
        size: data.length,
        digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      },
    ],
  };
  return { manifest, data, row };
}
