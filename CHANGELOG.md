# Changelog

Versions before 1.0 may include breaking changes in minor releases. Patch releases contain compatible fixes. Release candidates are intended for evaluation with synthetic data or a separate representative copy.

## [0.1.3]

### Added

- The account overview has an **Only me** filter for the current user's private accounts. It works with search, categories, customers, tags, favorites and both account views, with filtering applied before totals and pagination.
- Application administrators can inspect and change secondary-group access under **Security → Account access**, with translated guidance in all 14 supported languages. Changes require recent authentication and are audited.

### Security

- **NP-2026-001:** Group-private accounts now require membership through the user's primary group, including for administrators. Additional group memberships no longer override this privacy boundary. New and edited group-private accounts must use the acting user's primary group.
- **NP-2026-002:** Password history now enforces each historical record's original owner, group and privacy restrictions in addition to current account permissions. Unauthorized history entries are excluded before the result limit and cannot be revealed or restored.
- Both corrections affect releases from `0.1.0-rc.1` through `0.1.2`; `release-security.json` records `0.1.3` as the fixed version for update notifications.

### Fixed

- Account list permissions and direct account access use consistent capability and privacy checks before counting and pagination.

### Compatibility and upgrade notes

- Existing secrets, persistent volumes and database schema are preserved. Back up the database and required historical keys before updating to the release's verified image digest.
- Access through secondary groups may become more restrictive for group-private accounts and historical records. Review the [account permission rules](docs/COMPATIBILITY.md#account-permissions) when upgrading.
- The migrated sysPass `accountFullGroupAccess` setting remains effective and can now be managed in the interface. It expands explicit group grants for non-private accounts only; privacy and profile permissions still apply.

## [0.1.2]

### Fixed

- Coolify and Dokploy repository templates now pull a verified published image instead of requiring a local Dockerfile. Pasting the Coolify definition into a Docker Compose Empty Service no longer fails with `failed to read dockerfile: open Dockerfile: no such file or directory`.
- Intentional source builds use the explicit `docker-compose.build.yml` override from a real repository checkout.
- Deployment checks reject accidental source-build requirements in platform templates, and installation instructions distinguish pasted Services from Git-based builds.

### Compatibility and upgrade notes

- Use `docker-compose.coolify.yml` or the Dokploy import from this release's deployment archive to deploy the exact 0.1.2 image. The archive pins the image produced and verified by this release's workflow.
- When fixing an existing Coolify Service, preserve its environment values, service names and persistent volumes. Remove the old `app.build` block and use the release image instead; no secret regeneration or database reset is required.
- No database schema change is introduced. Preserve deployment keys, setup tokens and database credentials across updates.
- `release-security.json` records no publicly disclosed security corrections for this release; no independent security audit is claimed.

## [0.1.1]

### Changed

- Trusted reverse proxies can be configured by DNS name as well as IP address or CIDR. Names are resolved for incoming forwarded requests, allowing first deployment and proxy IP changes without manually discovering container addresses. Missing DNS denies forwarded requests without preventing application startup; HTTP and signed SSO retain the immediate-peer check.
- Coolify deployments default to the named `coolify-proxy` ingress and use Coolify's persistent generators for the 32-byte Base64 deployment key, setup token and independent application/root database passwords.
- Dokploy deployments default to `dokploy-traefik`. A cryptographic secret-generation template and digest-pinned Base64 import are included in deployment bundles; source checkouts can generate an import with `npm run deploy:dokploy`.
- Installation and operating instructions explain platform networking, generated-secret persistence and safe upgrades of existing installations.

### Compatibility and upgrade notes

- Preserve all existing secrets and volumes. Before adopting the new Coolify template, copy the existing deployment key, setup token and database passwords into their corresponding `SERVICE_*` variables as described in [Installation](docs/INSTALLATION.md#coolify). Do not replace them with newly generated values.
- Dokploy's template import is for new installations only: reimporting generates new secrets. For updates, retain the saved environment and volumes and change the verified image reference.
- No database schema change is introduced by these deployment improvements. Use one application process, the release's verified image digest and the existing backup/restore procedures.
- This release records no publicly disclosed security corrections in `release-security.json`; this is not a security certification or independent audit.

## [0.1.0]

### Added

- First stable nodePass release, promoting the initial release candidate with the changes below.
- Hourly server-side release checks, cumulative security-fix metadata, administrator update notices and deduplicated SMTP notifications.
- Application-administrator version overview with manifest-verified release history and safe Markdown display.
- User-management sign-in controls and validation feedback, plus success notifications after saving changes across account and administration views.

### Compatibility and upgrade notes

- Node.js 24; MariaDB 10.11, 11.4 and 11.8; MySQL 8.4. Published application images target Linux amd64.
- sysPass compatibility targets 3.2.11, schema 310.19042701. Preserve the original configuration, master password and pre-migration backup, and stop sysPass writers before takeover.
- Migration changes stored data and encryption state. Returning to sysPass requires restoring the original backup into a separate database; replacing the application image does not undo migration.
- Existing nodePass installations must preserve their deployment key, secrets and volumes. Back up the database and required historical keys and rehearse authenticated restore before updating to the release's verified image digest.
- One application process per installation is supported. Validate the actual dataset, proxy and integration settings before production use. No independent external security audit is claimed.
- This release records no publicly disclosed security corrections in `release-security.json`; this is not a security certification.

## [0.1.0-rc.1]

### Added

- Initial nodePass release candidate: FeathersJS API, Vue interface, passkeys, integrated TOTP, permission-controlled password management and a one-time sysPass migration path.
- GitHub verification gates, version checks, digest-pinned release deployment bundles, container SBOMs and release provenance.

### Compatibility and upgrade notes

- Node.js 24; MariaDB 10.11, 11.4 and 11.8; MySQL 8.4. Published application images initially target Linux amd64.
- sysPass compatibility targets 3.2.11, schema 310.19042701. Preserve the original configuration, master password and pre-migration backup. Stop sysPass writers before takeover.
- Returning to sysPass requires restoring the original backup into a separate database. Changing the application image alone does not undo migration.
- One application process per installation is supported. Validate actual proxy and integration settings and rehearse authenticated restore before using a real dataset.
- No independent external security audit is claimed.
