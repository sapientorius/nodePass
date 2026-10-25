# Security model

[Documentation home](../README.md#documentation) · [Report a vulnerability](../SECURITY.md)

## Trust boundary

nodePass stores secrets that the server can decrypt. The application host, deployment secrets and operators with OS/database access are within the trust boundary. A compromised running application, or an operator holding both the database and deployment key, can read secrets. No end-to-end encryption, complete JavaScript memory erasure, certification or independent external security audit is claimed.

## Controls

| Boundary               | Threat                                                                      | Controls                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vault                  | Database theft without deployment key; swapped/tampered records             | AES-256-GCM, random data keys, table/record/field-associated data and separate encrypted keyring                                                                            |
| Identity/session       | Password attacks, stolen sessions, CSRF, changed permissions                | Argon2id with bounded concurrency; persistent user/source limits; random server sessions; cookie/CSRF/origin checks; rotation and revocation                                |
| Authentication factors | Replayed challenges, wrong origin/RP, absent user verification, factor loss | One-time WebAuthn challenges, exact RP/origin and required user verification; TOTP replay lock; hashed recovery codes; protection of the last mandatory factor              |
| Object/field access    | IDOR, privilege escalation, private-account exposure                        | Common REST/RPC authorization, filtering before pagination, explicit output fields and reference validation                                                                 |
| SQL/XML/PHP input      | Injection, entities, object execution, resource exhaustion                  | Bound DB parameters, bounded SQL-data decoder, rejected DTD/entities and bounded allowlisted serialization                                                                  |
| Attachments/exports    | Active content, path traversal, unauthorized export                         | Size/MIME/extension validation, forced downloads, encrypted BLOBs, explicit export confirmation and fresh identity for sensitive operations                                 |
| Migration/restore      | Unauthorized takeover, partial migration, data loss                         | Setup token plus old local app-admin identity and master password; preflight; lock/checkpoint; backup before changes; authentication and manifest validation before restore |
| Integrations           | SSRF, forged proxy headers, directory bypass                                | Explicit destinations; no account-URL fetches; no wiki redirects; TLS verification; trusted immediate peers; HMAC SSO with one-time nonce; renewed LDAP checks              |
| Supply chain           | Vulnerable dependencies, altered tools, committed secrets                   | Lockfile; ignored install scripts; pinned Actions/images/rules; dependency, secret, static, image, workflow and application scans; blocking release gate                    |

Unexpected errors omit database credentials, stacks, keys and decrypted contents. Audit records contain user ID, action, target ID and time, not passwords, token values or secret configuration. Legacy event/plugin content is treated as data, never HTML/PHP.

Sharing links require an active completed session and account/password/sharing rights. Creating a link, like reading an individual password, does not require additional five-minute reauthentication. Required MFA, session expiry, CSRF/origin, privacy, retrieval/expiry limits and audit still apply. Other sensitive operations, including recovery-code and API-token management, retain their additional confirmation requirements.

## Browser and network

Browser assets are local. CORS is closed and the UI does not render user HTML. `script-src 'self'` permits bundled scripts only: inline scripts and `eval` are not allowed. Frames, external images/fonts and foreign connections are restricted. Secrets are excluded from list responses and authentication credentials are not placed in Local Storage. Explicit password display is time-limited.

`style-src 'self' 'unsafe-inline'` is a deliberate exception for NaiveUI's dynamic CSS and style attributes. This does not permit inline scripts. A future nonce solution must cover both dynamic style elements and component attributes and be verified in the browser.

## Scanner exceptions and limitations

The exact ZAP `10055-6` style-CSP exception, alert name and three test HTML addresses are recorded in `security/zap-exceptions.json` until **2027-01-15**. It does not cover script-CSP findings. A second exception covers only HTTP on the isolated test listener, never production domains. Unknown severity formats fail validation.

The static exception in `security/static-exceptions.json` is restricted to the legacy password-pattern reader. User-defined regular expressions run in a worker bounded by time, memory and concurrency. `check:exceptions` rejects expired, expanded, incomplete or stale suppressions. Unknown pattern failures are not treated as success.

Semgrep CE primarily analyzes individual functions/files. A pinned upstream JavaScript security ruleset supplements project rules; unrelated style/browser-version rules are not part of that set. Scanner/parser errors fail the scan. Known high/critical vulnerabilities are not blanket-exempted as unfixed.

The ZAP script signs in with a password and TOTP, verifies protected account access, crawls/scans an isolated instance and saves reports. It does not accept an external target URL. This scan does not replace permission/MFA negative tests or manual validation of business workflows.

## Verification framework

The security checklist follows [OWASP ASVS](https://asvs.owasp.org/) themes without claiming ASVS certification: architecture/trust boundaries; authentication; session rotation/revocation; object/field authorization; bounded input/output; authenticated encryption; browser defenses; file safety; and hardened operations.

Tests and scanner configuration are public for reproducibility. A passing automated gate is evidence for its tested scope, not proof of security. Production approval also needs threat-model review, assessed exceptions, restore evidence and validation against actual integrations and data. Every new exception needs an exact rule/target, reason, owner and expiry. Branch protection and hosting permissions require real repository settings; workflow files cannot enable them. See [release checks](OPERATIONS.md#release-and-hosting-checks).
