# Migrate from sysPass

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [Compatibility](COMPATIBILITY.md)

## Before you start

Migration has been tested against **sysPass 3.2.11**, build `3211.22070201`, schema `310.19042701`. Configuration version strings are informational; the actual schema, relationships, administrator identity and encrypted contents must pass validation. A different version string does not establish compatibility.

This is a **one-time transition**. Stop sysPass and all old writers before migration. Never run both applications against the same writable database. The 27 original base-table definitions remain intact and additions use `nodepass_`, but some stored legacy key copies and data are replaced after verification. The migrated database cannot simply be reopened by sysPass.

1. Rehearse with a complete isolated copy before scheduling downtime. Include private/group accounts, profiles, histories, encrypted custom fields, attachments, API tokens, public links and existing MFA data.
2. Check the [supported database versions](INSTALLATION.md#requirements). Upgrade an old DB server separately; nodePass does not upgrade the server.
3. Independently back up the database, `config.xml`, existing backups and keys. Prove restoration before proceeding.
4. Stop sysPass, background jobs and old API writers.
5. Choose direct connection or import into a **separate empty target database**.
6. Prepare the setup token, an active **local sysPass application administrator's existing login/password**, and the old master password.
7. Run preflight and migration. Unknown schema or undecryptable data stops migration with affected record identifiers.
8. Enroll the first administrator's MFA, compare secrets and denied/allowed permissions, test integrations and legacy clients, then enable normal access.

The master password is checked once and retained encrypted in the server keyring. Users do not need it afterward. This is not end-to-end encryption: the running server can decrypt authorized secrets.

## Direct connection to the existing database

Mount the original configuration read-only using the included override:

```dotenv
SYSPASS_CONFIG_FILE=/absolute/path/to/config.xml
```

```sh
docker compose -f docker-compose.yml -f docker-compose.existing.yml up --detach --build app
```

Requires Compose **2.24.4+**. The override disables the new DB and reads credentials from `config.xml`. The old `dbHost` must be reachable from inside the app container: `localhost` means that container. Override `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD_FILE` if necessary. Mount an old Unix socket separately when applicable. The DB account needs read/write access to the old data and permission to create `nodepass_` tables.

Select **Import sysPass** in setup. Migration starts only after administrator and master-password validation. Future structural updates to an installed nodePass instance run automatically under a database lock. This lock coordinates nodePass migrators; it cannot stop the old PHP application writing.

## Import configuration and a SQL dump

Start nodePass with an empty target database. Select the sysPass import tab and upload `config.xml` plus a compatible uncompressed SQL dump. Supply the **existing** local sysPass application administrator's login password, not new nodePass credentials. A locked user, LDAP user or account administrator without application-admin privileges cannot authorize migration. The master password has its own field and is checked afterward.

Export using a database tool with UTF-8 and hexadecimal BLOBs, for example `mariadb-dump --single-transaction --default-character-set=utf8mb4 --hex-blob`, together with your protected connection options and database name. Do not put passwords in shell history.

### Supported dump format

- Maximum upload: **64 MiB**, at most **200,000 records per table**. The CLI importer has the same limits. Larger databases need direct connection, or controlled database-tool restoration into a separate DB followed by direct migration.
- Bounded `INSERT ... VALUES` data and recognized schema metadata are decoded; uploaded SQL is never directly executed.
- `CREATE DATABASE`, `USE` and original view metadata are recognized without adopting the source DB, view definers or uploaded table definitions. nodePass supplies the target schema.
- Transaction wrappers `START TRANSACTION`, `BEGIN [WORK]` and `COMMIT [WORK]` are parsed and skipped. Data writes use nodePass's own import transaction. `ROLLBACK`, unknown statements and additional data mutations are rejected.
- phpMyAdmin primary/secondary/unique keys, known foreign keys, key toggles and matching integer-ID auto-increment metadata are validated and skipped. Each clause must be recognized. Original IDs are retained; exported counter values are not applied.
- Procedures, triggers, executable expressions, file access, unknown tables, destructive schema changes and mismatched ID types are rejected.

The importer does not merge installations. XML/SQL parser failures leave the target unchanged. A failed insert rolls back records, but empty base tables may remain: retry that failed data import against a new empty target DB.

### Administrator errors and resuming

If import succeeds but administrator confirmation fails with `SETUP_ADMIN_REQUIRED` in phase `confirm`, correct the existing sysPass credentials and continue without importing SQL again. After reload, reselect `config.xml` if requested; the populated database is detected and SQL upload is hidden.

The protected setup diagnosis distinguishes missing/ambiguous login, locked account, missing application-admin rights, LDAP identity and an unverified login password. It contains no login names or password hashes. A password error after identity/role validation refers to the password in the imported snapshot; later sysPass password changes are absent from that export.

Background jobs report progress. A browser timeout does not cancel a running job. After a process interruption, retain the same data volume, deployment key and original credentials, and repeat takeover. Encrypted checkpoints preserve the first backup instead of replacing it with a partly migrated state. An interrupted fresh installation likewise requires the original administrator identity/password.

### Import diagnostics

The form retains the error code, phase and correlation reference. Parser errors include SQL line and bounded table/record metadata; insert errors identify the start of the affected 100-row batch. Lines count comments too. `DUMP_ENCODING` means binary or invalid UTF-8 input: export again with `--hex-blob`, rather than editing binary characters. Restore incompatible raw sysPass backups with a DB tool first, then re-export. Decompress backups before upload.

Use `docker compose logs --tail=100 --follow app` or `npm run preview:logs`. JSON event `setup.failed` has the same `reference` as the form. Logs contain sanitized categories and bounded metadata, never SQL statements, XML, passwords or raw database errors. Detailed responses require the setup token; older unlogged failures cannot be reconstructed afterward.

## CLI migration

The distroless image has Node as its entry point, with no shell or npm:

```sh
docker compose run --rm --no-deps app packages/server/dist/server/src/cli.js preflight
docker compose run --rm --no-deps \
  -v /absolute/protected/private-input:/run/input:ro \
  app packages/server/dist/server/src/cli.js migrate --input /run/input/migration.json
```

Create the protected input directory **outside the publication checkout** and substitute its absolute path in the mount. Make the JSON readable only by app UID 65532. It contains `login`, `password`, `masterPassword`, `maintenance: true` and optionally `configuration` with the XML text. Never put passwords in command arguments; remove input files after use. See [CLI commands](OPERATIONS.md#cli-reference).

## Verification and rollback

Check representative secrets, history, attachments, encrypted fields, private-account exclusions, group/profile rights, MFA, API tokens and old public links. Validate real LDAP/SMTP/wiki certificates and permissions. Keep access closed until these checks and restore rehearsal pass.

MySQL/MariaDB DDL is not fully transactional. For rollback, stop both applications and restore the **complete pre-migration backup into a separate database**, then point sysPass at it. Preserve the partly migrated DB for diagnosis. Switching containers back against the migrated DB is not a rollback. Keep the original configuration and master password with appropriately protected recovery material.
