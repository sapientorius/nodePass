# Contributing

[Documentation home](README.md#documentation) · [Security policy](SECURITY.md)

Use synthetic data only. Report security vulnerabilities privately through [SECURITY.md](SECURITY.md); ordinary bug reports should include version/commit, expected behavior, sanitized reproduction steps and relevant environment details. Never upload a real sysPass configuration, dump, vault secret or deployment key.

## Development

Use Node.js **24 LTS**, npm and a supported isolated test database. All commands below run from the repository root:

```sh
npm ci --ignore-scripts
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run audit
npm run check:assets
npm run check:exceptions
npm run check:publication
```

Every npm command also has an optional `rtk:` variant. Normal scripts work without RTK. Keep both variants when adding commands. On PowerShell use `npm.cmd` if script policy blocks `npm.ps1`.

Use your own development values based on `.env.example`, then start the API with `node --env-file=.env --import tsx packages/server/src/index.ts`. Use `npm run dev -w @nodepass/web` for Vite, which proxies the API. Never use production DB credentials. The workspace contains shared contracts, a FeathersJS/Koa server and a Vue 3 frontend using Options API, Pinia and NaiveUI.

## Integration and browser checks

```sh
node scripts/test-env.mjs
docker compose --env-file .cache/integration.env --project-name nodepass-test -f tests/compose.yml up -d --wait
npm run test:integration -- --coverage
npm exec playwright -- install chromium
npm run test:e2e
npm run audit:zap
```

The environment generator refuses to overwrite existing secrets. The integration runner loads the local test environment. Tests require a DB name ending in `_test` and separate test-root credentials; they create random databases named `nodepass_test_...` and remove them afterward. Default `npm test` deliberately skips DB integration without explicit enablement; that is not a complete acceptance run.

Browser/ZAP checks create isolated instances with virtual authenticators or actual TOTP flows. ZAP only targets its own test listener on port 3101. Browser tests use 3100. Do not aim scanners at a production instance. Reports go to ignored `coverage/`, `output/`, `playwright-report/` and `test-results/`. Stop only your own test Compose project when done; never reset an operator preview.

### Fresh PHP reference vectors

CI checks out Defuse commit `77880488b9954b7884c25555c2a0ea9e7053f9d2` to `.cache/defuse` and runs `tests/reference.php` in the pinned PHP 8.4 container without network access. To reproduce, obtain that exact commit at that path, then run:

```sh
docker run --rm --network none -v "$PWD:/workspace" \
  -e NODEPASS_REFERENCE_OUTPUT=/workspace/.cache/php-reference.json \
  php:8.4-cli@sha256:40638d9d5ec50bbf20205a06c733fff5839fc13b0a7c8e10e455b49da2a13068 \
  php /workspace/tests/reference.php
```

Set `NODEPASS_REQUIRE_PHP_REFERENCE=1` for the integration run to require the fresh vectors. Fixed reference fixtures must also pass. Their provenance is in [NOTICE.md](NOTICE.md).

## Review expectations

Preserve original sysPass schema definitions and field/record permissions. Never make a scanner/parser error count as success. Do not reduce coverage: overall minimums are 90% lines/statements/functions and 85% branches; server security, compatibility and migration areas require 95% lines/branches. Test meaningful denied paths, replay, malformed input and recovery as appropriate.

Serve browser assets locally; do not introduce CDNs, remote fonts, telemetry or automatic account-URL fetching. Document compatibility changes and security tradeoffs. Exceptions require exact scope, reason, owner and expiry. See the [security model](docs/SECURITY.md).

## Public source checks and CI

`check:publication` checks Git's tracked and nonignored candidate paths, rejects internal/runtime/secret artifact paths and validates local documentation links. Run it before committing. It complements secret scanning; filename rules cannot detect every secret embedded in source. `.env.example` and the reviewed synthetic fixtures remain public.

The standalone workflow lives in `.github/workflows/nodepass.yml`. It verifies build/types/format/lint, integration coverage, browser behavior, four DB targets, dependencies, secret/static/image/config/workflow/Dockerfile findings and an authenticated ZAP scan. Pinned Actions/images and **Required release checks** must remain intact. Hosted results and repository rules need actual GitHub configuration; see [release requirements](docs/OPERATIONS.md#release-and-hosting-checks).
