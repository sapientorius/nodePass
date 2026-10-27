# Changelog

Versions before 1.0 may include breaking changes in minor releases. Patch releases contain compatible fixes. Release candidates are intended for evaluation with synthetic data or a separate representative copy.

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
