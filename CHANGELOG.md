# Changelog

Versions before 1.0 may include breaking changes in minor releases. Patch releases contain compatible fixes. Release candidates are intended for evaluation with synthetic data or a separate representative copy.

## [0.1.0-rc.1]

### Added

- Initial nodePass release candidate: FeathersJS API, Vue interface, passkeys, integrated TOTP, permission-controlled password management and a one-time sysPass migration path.
- GitHub verification gates, version checks, digest-pinned release deployment bundles, container SBOMs and release provenance.
- Hourly server-side release checks, cumulative security-fix metadata, administrator update notices and deduplicated SMTP notifications.

### Compatibility and upgrade notes

- Node.js 24; MariaDB 10.11, 11.4 and 11.8; MySQL 8.4. Published application images initially target Linux amd64.
- sysPass compatibility targets 3.2.11, schema 310.19042701. Preserve the original configuration, master password and pre-migration backup. Stop sysPass writers before takeover.
- Returning to sysPass requires restoring the original backup into a separate database. Changing the application image alone does not undo migration.
- One application process per installation is supported. Validate actual proxy and integration settings and rehearse authenticated restore before using a real dataset.
- No independent external security audit is claimed.
