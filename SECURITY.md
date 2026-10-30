# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities confidentially through this repository's **Security → Advisories → Report a vulnerability** form (GitHub Private Vulnerability Reporting). Include affected commit/version, reproduction steps, impact and a minimal proof of concept using synthetic data. Do not attach production credentials, database dumps, deployment keys or real vault contents.

Do not open a public issue containing exploit details or secrets. If the private reporting button is unavailable, the repository's reporting configuration is incomplete: do not post sensitive details publicly. Maintainers must enable private reporting before public launch, following [GitHub's configuration guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

Reports concern nodePass. The upstream sysPass project's contact address is not nodePass's security contact. No guaranteed response time or paid support commitment is implied.

## Version and verification policy

The current project version is 0.1.5. Report against the exact commit when possible. No long-term support branches or fixed support periods are promised. Production deployment requires the exact commit's **Required release checks** and operator-specific validation; local reports alone are insufficient.

Read the [security model](docs/SECURITY.md) for trust boundaries and known constraints, and [Operations](docs/OPERATIONS.md#release-and-hosting-checks) for release requirements. Automated scans do not constitute an independent security audit.
