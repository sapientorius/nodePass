# Features and sysPass comparison

[Documentation home](../README.md#documentation) · [Compatibility](COMPATIBILITY.md)

The reference is sysPass **3.2.11**. This comparison describes implemented behavior, not an independent security audit or a claim of compatibility with every sysPass extension. Production use requires the checks in [Operations](OPERATIONS.md#release-and-hosting-checks).

## Inherited capabilities

| Capability                 | nodePass behavior                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and organization  | Search, categories, clients, tags, favorites, linked accounts and card/table views with shared filter state                                                                                          |
| Privacy and authorization  | Private accounts and private group accounts; user/group grants and profiles; separate metadata/password/file/history/sharing permissions                                                             |
| Password workflows         | Local password generator, expiry, encrypted history and version-checked restoration of metadata and passwords                                                                                        |
| Custom fields              | Typed values for accounts, categories, clients, users, groups, profiles and API tokens, including legacy module aliases; secret values excluded from lists                                           |
| Attachments                | Encrypted attachment storage and forced downloads; legacy BLOBs removed only after verified takeover                                                                                                 |
| Administration             | Users, groups, profiles, presets and API tokens; protection of the last application administrator and session revocation after relevant changes                                                      |
| Public links               | Existing addresses/hashes retained, expiry and atomic retrieval limits, snapshots and revocation                                                                                                     |
| Data exchange              | Preview and atomic import for CSV, KeePass XML and encrypted sysPass XML; explicit plaintext export                                                                                                  |
| Legacy API                 | Action-bound JSON-RPC tokens and token passwords; the same permissions as REST/UI                                                                                                                    |
| Activity and notifications | Sanitized audit events, separately readable legacy events, bounded notification polling and personal read state; hourly administrator update checks and critical security notices with SMTP delivery |
| Integrations               | LDAP/AD, reverse-proxy sign-in, SMTP, syslog and wiki integration, with explicitly configured destinations                                                                                           |

Card/list selection and authenticator-based TOTP existed in sysPass. They are preserved or modernized rather than presented as inventions of nodePass.

## Additions and modernizations

| Area                    | Change                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Application stack       | TypeScript, FeathersJS 5/Koa and Vue 3/Pinia/NaiveUI replace the PHP application                                                           |
| Passkeys                | Passwordless sign-in, exact origin/RP validation, mandatory authenticator user verification and multiple credentials                       |
| Built-in MFA            | Native TOTP, replay prevention, hashed one-time recovery codes and enforceable MFA policy; administrator MFA required by default           |
| Login password handling | Argon2id, upgrade of valid legacy hashes at login and configurable length/strength policy for new/changed login passwords                  |
| Vault activation        | One-time master-password verification during migration; no per-user master-password activation afterward                                   |
| Interface               | Responsive redesign, light default and dark graphite themes, locally bundled assets and 14 languages                                       |
| Backups and deployment  | Authenticated encrypted backup streams, checked manifests, separate empty restore targets, deployment-key rotation and hardened containers |
| Verification            | Blocking CI gate, database-version matrix, security scans, browser checks and SBOM generation                                              |

Languages: German, English, Spanish, Catalan, Hungarian, French, Polish, Russian, Dutch, Portuguese, Italian, Danish, Faroese and Japanese.

## Deliberate limits

- PHP plugin execution is not ported. Authenticator **2.2** has a dedicated data migration; unknown plugin records remain stored without executing their code.
- Arbitrary server-side export paths, remote UI resources and account-URL fetching are not supported.
- Original table definitions, field lengths and character sets remain unchanged. Legacy `utf8` columns retain their non-BMP Unicode limitations.
- This version targets one application process per installation. Multiple active replicas need additional coordination and validation.
- The server can decrypt authorized secrets; this is not an end-to-end encrypted password manager.
- Real integrations, physical authenticators and representative operator datasets require deployment-specific validation beyond automated tests.
