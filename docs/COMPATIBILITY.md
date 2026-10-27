# sysPass compatibility

[Documentation home](../README.md#documentation) · [Migration](MIGRATION.md)

## Reference version and schema

The reference source is sysPass **3.2.11**, build `3211.22070201`, schema `310.19042701`. Only this release has been tested as a migration source. `appVersion` and `databaseVersion` in configuration are informational; values such as `310.19081801` are accepted without claiming support for another release. Validation checks actual tables, columns, types, relationships, administrator identity and encrypted contents.

The bundled `packages/server/resources/schema.sql` contains the 27 original base tables. Original table/column definitions and character sets are preserved; new tables use `nodepass_`. After verification, takeover replaces old per-user master-password copies, API vault copies, attachment contents, official Authenticator data and public-link vaults. These data changes make the transition one-way without restoring a pre-migration backup.

## Reference formats and provenance

- `tests/fixtures/syspass-account-crypt.xml`: original upstream sysPass test data for accounts, history and custom fields.
- `tests/fixtures/config.xml`: upstream test configuration, not a deployable configuration or production credential file.
- `tests/fixtures/reference.json`: synthetic Unicode, binary, hash, serialization, authenticator and public-link vectors generated independently with PHP 8.4 and Defuse 2.3.1.
- `tests/reference.php`: reproducible vector generator; Defuse reference commit `77880488b9954b7884c25555c2a0ea9e7053f9d2` (v2.3.1).
- Official `sysPass/plugin-Authenticator` **2.2** data is supported. PHP and legacy plugin code are not executed in the application.

CI generates fresh reference vectors in an isolated PHP container and requires them alongside the fixed vectors. Defuse integrity is checked before decryption. PHP serialization is read as a bounded data structure, without PHP object instantiation. Unknown classes, references, duplicate/prototype keys, excessive nesting and oversized inputs are rejected. Missing historical keys are reported with table/record context. See [NOTICE.md](../NOTICE.md).

## Account permissions

Application and account administrators can access ordinary accounts independently of group membership. Personal private accounts remain restricted to their owner; group-private accounts require the user's primary group, including for administrators. A displayed main group is not an exclusive access list: explicit user and additional group grants can also permit access to non-private accounts.

The sysPass `accountFullGroupAccess` setting is preserved during migration and can be changed by an application administrator under **Security → Account access**. With it disabled, an account's additional group grants match only the user's primary group. When enabled, the user's additional group memberships also qualify. Membership in a non-private account's main group applies independently. This setting does not override privacy or profile permissions.

Password history requires current account access and authorization for each historical record's original owner, group and privacy flags. Current explicit grants are considered without overriding historical privacy. Denied histories are excluded before the result limit and cannot be revealed or restored.

## Custom fields

Supported current module IDs are account `1`, category `101`, client `301`, user `701`, group `801`, profile `901` and API token `1001`, plus historical aliases `10`, `61`, `62`, `71` and `72`. Stored IDs are not rewritten. Missing targets, duplicate assignments, unknown modules, conflicting definitions and missing expected foreign keys stop preflight. Secret/encrypted values stay out of overviews; only explicitly permitted plaintext fields appear in cards and tables.

## JSON-RPC API

`POST /api.php` supports legacy methods for accounts, categories, clients, tags, user groups, backup and export. The `result` shape retains `itemId`, `result`, `resultCode`, `resultMessage` and `count`. Existing tokens remain bound to their user and `actionId`. Secret operations 4/7/8 validate their token password. The legacy API key vault is no longer required after takeover. Password responses retain the shape `{"password":"..."}`.

Security and compatibility limits:

- Lists never return real key material or encrypted password BLOBs. Legacy placeholder fields remain empty. Decrypted password access requires `account/viewPass` and the same object permissions as the browser.
- Page size is capped at 100; clients must paginate.
- Old tokens receive no additional privileges. Disabled users and blocked directory identities remain blocked.
- Metadata/password writes use the same version/permission service as REST. Clients must handle conflicts.
- Backup/export use the managed backup directory; arbitrary filesystem destinations are not accepted. Encrypted XML export requires a sufficiently strong `password`.
- New tokens expire and are stored as digests; the creation response exposes the usable value once.

The current REST route inventory is available after sign-in at `/api/v1/openapi.json`.

## Migration and restart

No concurrent old writers are permitted. Preflight and backup must succeed before legacy data is removed. MySQL/MariaDB DDL is not fully transactional: table-creation steps are repeatable, migration registration has a checksum and a local encrypted checkpoint preserves the original backup. Restart an interrupted migration with the same data volume and deployment key.

SQL dumps target an empty database. Only known schema metadata is accepted; literal data is decoded into parameterized inserts. Relationships are checked explicitly because reenabling `FOREIGN_KEY_CHECKS` does not retrospectively validate inserted rows. See [dump limits and diagnostics](MIGRATION.md#supported-dump-format).

Existing LDAP, SMTP, syslog and wiki settings are read where supported; new settings are stored in the encrypted keyring. Validate each real integration's network, certificate and permission behavior after migration. Unknown PHP plugins remain stored data, not ported capabilities.
