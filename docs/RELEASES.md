# Releases

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [Operations](OPERATIONS.md)

## Distribution and versions

The release process publishes GitHub Releases and `ghcr.io/sapientorius/nodepass`. Application images initially support **Linux amd64**. npm workspaces remain private and are not published as packages.

Use the image digest from a release's `release-manifest.json`, not a moving tag, for production. A version such as `0.1.0-rc.1` is a release candidate; `0.1.0` is a regular release. Before 1.0, incompatible changes increment the minor version. Compatible bug/security fixes increment the patch version. No LTS line or support period is promised.

Git tags use `nodepass-vVERSION`. Container tags use `VERSION` and `sha-COMMIT`. Only a regular release advances `latest`. Published version tags must never be replaced. GitHub release immutability protects Git tags and release assets; it does not make registry tags immutable. The publisher separately refuses a version or commit tag that already resolves to another digest.

## Repository setup

Workflow files do not configure repository settings. A maintainer with repository administration access must complete and verify these settings before the first tag:

1. Enable Actions with a read-only default token and SHA-pinned third-party Actions. The publishing job requests its own limited additional permissions.
2. Import the reviewed [main ruleset](../.github/rulesets/main.json) and [tag ruleset](../.github/rulesets/tags.json) under Settings → Rules → Rulesets. Ensure the exact check **Required release checks** from GitHub Actions is required, the branch must be up to date, PRs are mandatory, force pushes/deletion are blocked, and ordinary bypasses are absent.
3. The supplied main ruleset permits a sole maintainer to merge their own PR after CI, with zero independent approvals. This is not independent review. When a second real reviewer is available, require at least one approval and approval of the latest push. Keep stale-review dismissal enabled. Never assign invented CODEOWNERS.
4. Create the `release` environment. Add the actual release maintainer as a required reviewer. Select only the tag pattern `nodepass-v*` under deployment branches/tags. Disable **Allow administrators to bypass configured protection rules** in the UI. A sole maintainer must be able to approve their own run; enable prevention of self-review when two-person release approval becomes possible.
5. Enable **release immutability** under Settings → General → Releases. Verify it before approving a release. The ordinary workflow token has no repository-administration permission to read this setting; the publisher checks the published release's immutable flag and fails if it is absent. This final check cannot undo an already published mutable release.
6. Enable Private Vulnerability Reporting, secret scanning and push protection where available. Verify Security → Advisories → Report a vulnerability and maintainer notification settings.
7. Link the GHCR package to this repository and set it public. After the first push, test an anonymous pull by digest. A public source repository does not prove that its container package is public.

The public hosting preflight checks applied main rules, required reviewers and the release tag restriction. Disabling administrator bypass, release immutability, private reporting and package visibility require separate operator verification. Keep these visibly pending until actually verified.

The publisher performs an actual digest pull with an empty Docker authentication configuration before publishing the GitHub Release. On the first upload, this can stop while the new package is private. Set the package public and rerun only the failed jobs from that run, preserving its tested artifacts. Never remove the public-pull check to obtain a passing release.

## Prepare a release

From a clean checkout using Node.js 24:

```sh
npm ci --ignore-scripts
npm run release:version -- 0.1.0-rc.1
npm run check:release
```

Use the intended next version, update its section in [CHANGELOG](../CHANGELOG.md), and submit a release PR. The version command synchronizes root/workspace package versions, local dependencies, lockfile, shared API version and versioned status text. The check requires a changelog entry. New npm commands also have `rtk:` variants.

Review migration and restore behavior, supported databases, compatibility changes and upgrade instructions. Merge only after the full PR gate passes. The actual merged commit receives its own main-branch verification. Run representative migration/restore and real proxy/integration acceptance with a separate copy; CI's synthetic tests cannot certify an operator's environment.

### Security update metadata

Review `release-security.json` in every release PR. Its `nodepass-security-1` catalogue is cumulative: retain earlier entries, including fixes from skipped releases. Record each publicly disclosed correction under a stable identifier (for example, its GHSA identifier) with one or more sorted, non-overlapping `affected` intervals. Each interval has an inclusive `introduced` version and exclusive `fixed` version, using nodePass's stable/RC version syntax. RCs participate in normal semantic ordering. Every `fixed` version must be at or below the version being released. An empty `fixes` array explicitly records no published corrections; it is not a security certification. Do not place embargoed vulnerability details in this public file.

For example, a synthetic entry `{ "id": "NP-EXAMPLE-1", "affected": [{ "introduced": "0.1.0-rc.1", "fixed": "0.2.0" }] }` marks installations before `0.2.0` from that first RC as affected. Any later release carrying that cumulative entry still triggers a critical notice for those installations. Do not add this example as an actual advisory.

`check:release` validates the catalogue. Release preparation embeds it as `security` in `release-manifest.json`, covered by the existing checksums and release attestations. Publication verification requires exact equality with the reviewed source. The application reads only complete immutable releases, verifies the API-provided manifest hash and identity, and never infers severity from release-note wording. Any recorded correction affecting the installed version is classified as critical. See [update notification operation](OPERATIONS.md#update-notifications) for cadence, failure states and SMTP delivery.

Fetch main, select the exact reviewed commit and create an annotated release tag. Replace COMMIT and VERSION explicitly:

```sh
git fetch origin main
git tag -a nodepass-vVERSION COMMIT -m "nodePass VERSION"
git push origin refs/tags/nodepass-vVERSION
```

The tag must match the checked-in version and point to a commit contained in `origin/main`. Do not tag an arbitrary feature branch. A failed candidate is fixed through a new version/tag; do not move or reuse the old tag.

## Verification and approval

Tag pushes run the complete pipeline again. It includes build/types/lint/format, publication/version/local-asset checks, integration coverage, fresh PHP vectors, browser checks, four database targets, npm audit, Gitleaks, Semgrep, Trivy, actionlint, zizmor, hadolint, container acceptance and authenticated ZAP. Skipped, cancelled or failed prerequisite jobs fail **Required release checks**. Coverage/scanner policies and exact expiring exceptions remain mandatory.

The security job builds once, tests that local image, scans it and creates the SBOM. A pinned registry client preserves its content in an OCI layout and selects the tested amd64 manifest. Release preparation verifies every referenced blob, source/version labels and equality with the tested image's configuration digest. No publication job rebuilds the application.

Successful preparation produces the run-scoped `nodepass-release-COMMIT` artifact. It contains the OCI layout, deployment archive, SBOM, manifest, checksums and release notes. Inspect this artifact and the completed gate before approving the environment. It is retained for 30 days; publication must finish within that period.

After approval, the publisher downloads artifacts from **its own workflow run**, verifies identity and checksums again, and publishes the preserved image. It generates image provenance, image-SBOM and release-asset attestations using the workflow's short-lived identity. Assets are attached to a GitHub draft before the draft is published. Automated verification and provenance are not an independent security audit.

Publishing an image and a GitHub Release is not atomic. If a publication step fails, inspect both destinations and rerun only failed jobs from the original run, retaining its original artifacts. Matching existing image tags and draft assets are reusable; conflicting digests and published releases are not overwritten. If rebuilding changes an already uploaded version's digest, use a new version. Do not delete protected tags to recover.

## Install a published deployment bundle

Download these assets from the intended release:

- `nodepass-VERSION-deploy.tar.gz`
- `release-manifest.json`
- `sbom.cdx.json`
- `SHA256SUMS`

Verify checksums and GitHub attestations. For example, using GitHub CLI:

```sh
gh release verify nodepass-vVERSION --repo sapientorius/nodePass
gh release verify-asset nodepass-vVERSION nodepass-VERSION-deploy.tar.gz --repo sapientorius/nodePass
gh attestation verify oci://ghcr.io/sapientorius/nodepass@sha256:DIGEST --repo sapientorius/nodePass
```

Extract the deployment archive into a protected installation directory. Its standard/Coolify/Dokploy Compose files already contain the release's exact image digest and no `build:`. Follow the [installation guide](INSTALLATION.md) for secret initialization, HTTPS, ingress trust and administrator setup. Standard Compose starts with `docker compose up --detach --no-build`; platforms must pull the pinned image instead of building source. Preserve application/database volumes and every existing secret on updates.

From a source checkout, the equivalent is to set `NODEPASS_IMAGE` to the verified full digest reference and append `-f docker-compose.release.yml` after the chosen deployment file. For an existing external database, append `-f docker-compose.existing.yml` last. These overrides require Compose 2.24.4 or newer. The local preview continues to build its own source image.

## Update and maintenance

Before updating, read the version's compatibility notes, back up the database and required historical keys, and rehearse restore. Use one application process, stop writers during migration, and check readiness, MFA, permissions, secret access and backups after startup. Returning to a pre-migration state requires the matching backup and keys; image replacement alone is not a database rollback.

Verification runs weekly against main with current npm/Trivy vulnerability data. Dependabot proposes reviewed updates for npm, Actions and Dockerfile images; it does not automatically merge them. Pinned scanner/rule references and Compose/service image digests also require maintainer review and complete CI. Expiring exceptions produce advance warnings and block verification at expiry; renewal requires a fresh assessment, owner and exact scope.
