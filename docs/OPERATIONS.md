# Operations

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [Updates and upgrades](UPGRADING.md) · [Migration](MIGRATION.md)

## Configuration and deployment boundaries

Start with `.env.example`. Production Compose reads file-backed secrets; platform variants use their secret/environment management. Keep `DEPLOYMENT_KEY`, `SETUP_TOKEN`, database passwords, original configurations and input files out of Git. Retain the deployment key for every backup that depends on it.

`PUBLIC_URL` must be the exact external HTTPS origin. `TRUST_PROXY=1` requires a trusted proxy; `TRUSTED_PROXIES` lists immediate peer IPs/CIDRs or explicitly configured DNS names, not arbitrary clients. Names are resolved for incoming forwarded requests without retaining old IPs; failed resolution denies those requests but does not block startup. Secure the Docker network and DNS/aliases. The platform defaults are `coolify-proxy` and `dokploy-traefik`; no broad subnet trust is necessary. The proxy must overwrite forwarded headers. See [installation](INSTALLATION.md#fresh-installation-with-docker-compose) for generated secrets and platform setup. Legacy configuration may be mounted read-only using the existing-database override.

This version targets **one application process per installation**. REST and polling need no WebSocket proxy. Multiple active replicas require additional coordinated background work and acceptance testing; do not enable automatic scaling on the assumption that the migration DB lock covers this.

Use minimal integration privileges. A private CA can be supplied using Node's supported CA mechanism; never disable TLS certificate verification. Restrict outbound integration destinations at the infrastructure layer as well. Protect logs containing user/record metadata.

## Authentication and integrations

Browser sessions use random server-side IDs with `HttpOnly`, production `Secure` and `SameSite=Strict` cookies. Mutations require the CSRF token from `/api/v1/auth/session` and the exact `Origin`. The authenticated route inventory is `/api/v1/openapi.json`; legacy behavior is described in [Compatibility](COMPATIBILITY.md#json-rpc-api).

Ordinary user and permission-profile edits do not require another sign-in, including changes to login names, groups and profile permissions. Setting a password, blocking sign-in, or actually changing either administrator role ends every browser session of the affected user. Unchanged role flags do not trigger sign-out. The UI refreshes its session after saving users or profiles, when returning to the tab, and before its existing 60-second background poll. Permission changes are enforced by the server on the next authenticated request even before the UI refreshes. A detected access change closes open views and discards unsaved entries and displayed secrets while retaining account search filters, sorting and view preferences. Temporary refresh failures report an error without signing the user out; expired or revoked sessions still require sign-in. Session refresh does not renew absolute expiry or recent identity confirmation.

Within an active session, sensitive user-management changes require identity confirmation within five minutes: password resets, actual changes to administrator roles, group/profile assignments or sign-in status, and profile writes. The confirmation dialog resumes the original submitted action. In Profiles, explicitly enable **Reset user passwords** as well as **Manage users** for delegated resets; existing nodePass and imported sysPass profiles default to no reset permission. Administrators remain protected from delegated edits. Disabled edit buttons explain the applicable user, group or profile boundary.

LDAP/AD requires verified LDAPS or STARTTLS, a restricted bind user, base DN and optional group DN. Passwordless logins and active sessions recheck directory status/membership and fail closed during directory failure. Provisioned users receive only the selected default group/profile, without admin flags.

Reverse-proxy SSO additionally requires a random shared signing secret. The proxy overwrites `X-NodePass-Identity` and `X-NodePass-Signature`. Identity is Base64url UTF-8 JSON containing exactly `login`, `timestamp` (Unix seconds) and `nonce` (at least 22 random Base64url characters). Signature is hexadecimal HMAC-SHA-256 of the **unchanged encoded identity header**, using the SSO secret as a UTF-8 key. Proofs expire after 60 seconds and work once. Existing users require explicit mapping; optional provisioning uses a selected profile. SSO does not replace mandatory MFA.

SMTP requires TLS with certificate validation. Syslog UDP sends sanitized events to the configured receiver; retries can produce duplicates and the local audit remains authoritative. Wiki calls use only the configured HTTPS endpoint, reject redirects and bound responses. Account URLs are never fetched for previews. Verify real network/certificate/permission behavior before release.

## Update notifications

To install an update, follow [Updates and upgrades](UPGRADING.md), including release selection, platform-specific steps, backups and failure recovery.

Application administrators can open **Versions & updates** at `/manage/updates`, also linked from update notices. The page shows the installed version, latest known version in the installation's Stable/RC channel, last successful check and expandable release information from the installed version onward. Reading or reopening the page uses the server cache and does not force a GitHub request. An unpublished installation version and an unknown latest version are explicitly identified.

Release texts are displayed in their original published language only after the manifest asset's SHA-256 and release identity have been verified and the exact UTF-8 text matches `notesSha256`. GitHub permits edits to release notes even for immutable releases. If a text no longer matches, a previously verified cached copy remains visible with its verification time and a warning. Without a verified copy, the page shows the check status and official release link. Missing historical security catalogues do not prevent checking the text hash.

Each hourly run downloads at most ten manifests, including the current update's manifest. The update/security decision takes priority, followed by the installed release and intermediate versions in descending version order. Manifest identities and hashes are cached; pending historical texts continue on subsequent hourly runs. Historical text failures never suppress a valid security warning or its email. The browser uses a bundled Markdown parser and an allowlist of Vue elements; HTML, images, embeds and unsafe link schemes cannot introduce executable markup or automatic remote requests.

After setup, the server checks the official `sapientorius/nodePass` GitHub Releases immediately, then hourly. The next check is persisted before network I/O, so restarts do not cause repeated requests. Stable installations consider stable releases; release candidates also consider newer RCs. Version order determines the newest eligible release. This does not install software or replace the release-artifact verification procedure.

Allow outbound HTTPS to `api.github.com` and `release-assets.githubusercontent.com`. Requests use no GitHub token, installation identifier, installed version, hostname or vault data. GitHub necessarily sees the server's source IP. Checks use conditional requests, strict request/body/page limits and the API's polling/rate-limit delays. No browser resources are loaded from GitHub. GitHub/TLS is the metadata trust anchor; hashes obtained from GitHub do not provide an independent signature.

Only fully authenticated application administrators can read update status or acknowledge a notice. A critical banner means a published correction affects the installed version, even if intervening releases were skipped. Acknowledgement hides that administrator's banner; the critical notification and red indicator remain until an upgrade resolves it. A newer target version creates a new notice. The notification panel shows the last successful check, missing administrator email addresses and mail delivery failures.

Unreachable sources, mutable releases, missing/invalid security metadata or hash mismatches leave the check incomplete. The last validated warning remains visible. A successful check older than two hours is marked stale. An empty security catalogue means no published fixes have been recorded, not that the software has no vulnerabilities. Source outages do not block login or vault operations.

With SMTP enabled, each distinct valid email address of an active application administrator receives one plain-text English notification per target version. The audit integration's recipient list is independent. New administrators, changed addresses and later SMTP activation receive the still-applicable notice. Failed deliveries retry with backoff from one minute to one hour; successful deliveries survive restarts without daily reminders. SMTP remains subject to verified TLS and explicit recipient acceptance. A crash or connection loss after SMTP acceptance but before saving delivery can cause a duplicate: SMTP and the local database cannot provide an atomic exactly-once transaction. Invalid or missing administrator addresses do not prevent other recipients from receiving mail.

State and acknowledgements use the existing `nodepass_settings` sidecar table and are included in backups. The update worker, mail retries and audit delivery have independent failure handling. As with other background work, only one application process is supported.

Release texts are limited to 128 KiB each and a total of 4 MiB of serialized text in the discovery cache, prioritizing the installed version and then the newest versions. Texts exceeding these limits are marked unavailable and retain any previously verified copy. This bounds the security check's persisted state independently of historical text storage; failure to store historical information does not block security notifications.

## Backups and restore

Create/download `.npb` backups in administration or use the CLI `backup` command. Backups contain a consistent DB snapshot, configuration, manifest, record counts and SHA-256 checksums in a compressed AES-GCM-authenticated stream. Store copies outside the app volume, separate from their keys, with a retention policy and regular restore rehearsals. `.partial` files are not successful backups.

The **Backups** page lists completed files with creation time, size and origin, including older files without management metadata. The backup permission allows listing, creation and download. Only application administrators can delete files, change automatic backups or replace the database. Deletion is permanent; files used by a download or restore cannot be deleted until that operation releases them. Creating a backup is a background job and continues when the page is closed.

Automatic backups are disabled initially. Set an interval of 1–365 calendar days, a local time, an IANA timezone and 1–365 automatic versions to retain. Initial form defaults are daily at 02:00, seven versions, and the browser timezone (UTC if unavailable). The first run is the next occurrence of the selected time. Missing daylight-saving times run at the first valid minute; repeated times run once, using the earlier occurrence. The calendar rhythm does not drift after delays. After downtime, at most one missed backup is caught up. A failed slot has at most three attempts: immediately, 15 minutes later, and another 60 minutes later. The page shows the next run, last attempt, last success and errors.

Retention deletes only older automatic backups after a newly created backup passes verification. Manual backups, pre-restore safety backups and existing unclassified files remain until explicitly deleted. An in-use automatic file may temporarily exceed the retention count. Scheduled execution, preparation and restore assume one application process and no external writers.

### Restore through administration

Application administrators can choose **Restore** on a listed backup or upload an `.npb` file in sequential blocks of at most 8 MiB. Supply the backup's original canonical Base64 deployment key, even when restoring a local file. The web workflow accepts compatible backups of initialized nodePass installations. Original SQL dumps and pre-takeover snapshots still use the migration/CLI workflow.

The server authenticates the complete file and checks its manifest, schema, migration identity and all keyring entries before allowing a destructive action. It prepares an encrypted copy under the installation's current deployment key; the supplied source key is never persisted or logged. The current deployment key, database credentials and infrastructure configuration are retained. Enter the exact `DELETE AND RESTORE <database>` text shown by the preview, then confirm your identity again. This five-minute, single-use authorization is bound to that file, database and session.

The server enters maintenance, pauses background work and drains active application requests for up to 30 seconds. Failure to drain or to create and verify a safety backup aborts the operation before deletion. Only the configured database's recognized application tables and two recognized legacy views are rebuilt; unknown objects or schema drift reject the operation. The normal CLI restore continues to require an empty target.

After rebuilding, relationships and stored encrypted secrets are checked. All sessions are revoked. Users, passwords, permissions, API tokens and factors come from the backup; users must sign in with those credentials. Passkeys tied to another domain may not be usable. Automatic backups initially remain disabled, with the restored schedule values available for review and explicit activation.

If replacement fails, the server restores the verified safety backup automatically. An authenticated journal outside the database makes an unfinished replacement roll back on startup before migrations or workers run. If recovery also fails, readiness stays 503 and application access stays blocked; liveness and limited job status remain available. Keep the safety file, matching deployment key and data volume, fix the storage/database cause, then restart to retry recovery. Do not initialize setup or remove the journal to bypass recovery. A status-only token stored in the initiating browser tab can show progress after session revocation and expires 24 hours after completion. Browser disconnection does not cancel execution.

Unstarted restore preparations expire after one hour of inactivity. Completed recovery journals are removed only after the outcome is durable. Offline deployment-key rotation invalidates pending preparation/status tickets; an unfinished recovery must be completed with its original key first. Backups already retained under old keys still need those keys.

Restore preparation uses protected temporary files in the persistent data volume, rather than the container's small `/tmp` mount. Allow space for the source upload, a normalized encrypted file, transient authenticated/decompressed data, the safety backup and database growth. At the 4 GiB limits, multiple full-size working copies can coexist. Directories are private and temporary files are cleaned after completion or expiry. Verify filesystem permissions, available space, database CREATE/DROP/INSERT permissions within the configured schema, and proxy request limits for the upload blocks before use.

### Restore through the CLI

CLI restore authenticates the full file before database writes and targets a **separate empty database**. Sessions and short-lived challenges are not restored. Limits are 4 GiB for the encrypted file and expanded backup content, and 64 MiB per serialized record. Protected temporary storage is needed for the authenticated intermediate data; check free space in the data volume and temp filesystem.

Required recovery material: backup, its original deployment key, new DB credentials and a matching application version. A pre-takeover PHP backup additionally needs the original `config.xml` and master password. Keep old keys until every corresponding backup expires. Loss of backup and key cannot be repaired by resetting a login password.

## Deployment-key rotation

Stop writes and application processes, take a backup under the old key, prepare a protected file with a new random 32-byte key encoded as canonical Base64, then run `rotate-deployment-key --new-key-file FILE`. Replace the deployment secret and restart the app. Never run processes with mixed deployment keys. Rotation rewrites all encrypted keyring configuration entries atomically; account passwords do not change. **Retain the old key for old backups.**

## Factor-loss recovery

First use a second passkey or a one-time recovery code. The UI protects the last mandatory factor. If none remains, an authorized operator with exclusive deployment access can perform the audited recovery process; there is no hidden recovery login.

Stop the application. Mount a protected JSON file with `login`, a valid local administrator `password`, `maintenance: true` and `reason: "factor-loss"`. Run `recover-factor --input FILE`. It revokes sessions and writes a one-time code to an app-user-only `operator-recovery-*.txt` file in the data directory; output includes only its path. Existing factors remain enrolled. Restart, sign in with the password, select recovery codes and enter that code. Immediately enroll a replacement factor and remove input/code files. The procedure requires the deployment key, DB access and valid local administrator credentials.

## CLI reference

The distroless image contains no shell/npm and already uses Node as its entry point:

```sh
docker compose run --rm --no-deps app packages/server/dist/server/src/cli.js preflight
```

```text
init-secrets [--directory PATH] [--container-owners]
preflight
install --input FILE
import-dump --file FILE
migrate --input FILE
backup
restore --file FILE [--source-key-file FILE]
rotate-deployment-key --new-key-file FILE
recover-factor --input FILE
```

Mount inputs read-only and make them readable only by app UID 65532. Keep sensitive inputs outside the checkout and delete them after use. `install` JSON requires `login`, `name`, `password`; migration input is documented in [Migration](MIGRATION.md#cli-migration). Never supply passwords in command arguments.

## Health, troubleshooting and updates

- `/health/live` checks the process; `/health/ready` checks DB, setup and vault state. Before completed setup, readiness 503 is expected.
- For startup failures, check secret-file permissions, the deployment key, DB reachability and migration checksums. Do not print secret configuration.
- For proxy-related 403 responses, verify `PUBLIC_URL`, immediate peer, `TRUSTED_PROXIES`, proxy DNS resolution from the app's network, HTTPS forwarding, Origin and CSRF. A missing/unresolvable proxy is denied until available. Do not bypass these checks by trusting every source.
- A decryption error with a record ID requires investigating source data/historical keys; never replace it with empty data.
- Follow [Updates and upgrades](UPGRADING.md) for the maintenance procedure, including Coolify/Dokploy image selection, backup/restore, startup migrations and post-update checks.
- After an incomplete takeover, preserve the partial DB and restore the original backup separately before pointing sysPass at it. See [rollback](MIGRATION.md#verification-and-rollback).

## Release and hosting checks

Follow the [release procedure](RELEASES.md) for version preparation, repository rules, approval, immutable assets and digest-pinned deployment. Release candidates never advance the stable `latest` image tag.

Configure actual repository rules: reviewed pull requests, **Required release checks** (`release-gate`) required, no direct release-branch pushes or ordinary-user bypass, and stale-review dismissal after new commits. Assign real reviewers/CODEOWNERS as appropriate. Workflow files alone cannot enforce these settings.

The gate requires application verification, security scans, all compatibility jobs, workflow/Dockerfile audits and the authenticated application scan. MariaDB 11.8 is the main target; the matrix adds 10.11, 11.4 and MySQL 8.4. Skipped, cancelled or failed prerequisite jobs fail the gate. Verification also runs weekly and for `nodepass-v*` tags. Release only the tested commit and corresponding image digest.

Actions, images, Defuse references and Semgrep rule commits are pinned. Review updates and rerun the full gate. npm/Trivy use current vulnerability databases; stale offline reports are not a current release scan. Semgrep uses the prepared pinned rules offline and ZAP automatic add-on updates are disabled for reproducibility.

Before each production release, validate fresh setup/admin MFA, representative migration and denied permissions, interrupted migration/resume, authenticated restore into an empty DB, key rotation, nonroot/read-only startup, DB failure/restart, missing secrets, local browser assets and absence of secrets in logs/reports. Validate actual deployment and integration targets. Do not lower coverage or broaden exceptions to obtain a passing gate.
