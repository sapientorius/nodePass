# Installation

[Documentation home](../README.md#documentation) · [Migration](MIGRATION.md) · [Operations](OPERATIONS.md)

## Requirements

- Node.js **24 LTS** and npm for local development or the one-command preview. Production containers include their runtime.
- Docker Engine with Compose v2, or Docker Desktop using Linux containers. The existing-database override requires Compose **2.24.4+**.
- MariaDB **10.11, 11.4 or 11.8**, or MySQL **8.4**. The default Compose database is MariaDB 11.8 and has no published host port.
- A current browser. Passkeys require HTTPS or localhost and a compatible authenticator.
- For production: a dedicated HTTPS origin at `/` and a reverse proxy that overwrites forwarded headers. Subdirectory hosting is not supported.

Use a commit that has passed **Required release checks** and complete the [deployment checks](OPERATIONS.md#release-and-hosting-checks). For existing sysPass data, follow [Migration](MIGRATION.md) before connecting a database.

## Local preview

From the repository root:

```sh
npm run preview
```

No host dependency installation, manually created `.env`, or reverse proxy is required. The first run downloads pinned images, installs dependencies inside the build container, builds nodePass and starts the app/database in the background. Port 3000 must be available. Under Windows PowerShell, use `npm.cmd run preview` if `npm.ps1` is blocked.

Open **http://localhost:3000**. Select **New installation**, enter the setup token printed in the terminal, create your administrator, then enroll a passkey or TOTP. On subsequent starts, sign in normally. There are no default credentials.

```sh
npm run preview:stop
npm run preview:logs
npm run preview
```

Stopping preserves data, keys and both preview volumes. Logs follow the last 100 application lines; Ctrl+C stops following. Ctrl+C after a successful start does not stop the background containers.

The preview uses only `docker-compose.preview.yml`, project `nodepass-preview`, its own volumes and random secrets in `.cache/preview/secrets.env`. Preserve this file: it is never overwritten and is needed for subsequent starts. Startup refuses existing volumes without the corresponding secrets. Integration-test settings are not reused. HTTP and relaxed production transport settings apply only to this localhost preview; use test data or a separately prepared migration copy.

### Reset preview data

```sh
npm run preview:reset
npm run preview
```

**Reset permanently deletes all preview users, factors, accounts, attachments, settings and backups.** It removes only the fixed preview containers and two data volumes after checking Compose ownership and volume consumers. Unexpected labels or foreign volume users stop deletion. Secrets are retained; reset also works when their file is missing or corrupt. Reload the browser and choose **New installation** afterward. Production resources and automated test databases are not reset targets.

## Fresh installation with Docker Compose

For published versions, prefer the verified deployment archive described in [Releases](RELEASES.md#install-a-published-deployment-bundle). Its Compose files already use the exact release image digest. After verifying and extracting it, initialize secrets with that same image:

```sh
cp .env.example .env
export NODEPASS_IMAGE='ghcr.io/sapientorius/nodepass@sha256:REPLACE_WITH_VERIFIED_DIGEST'
docker pull "$NODEPASS_IMAGE"
mkdir -p secrets
docker run --rm --user 0 --mount type=bind,src="$PWD/secrets",dst=/secrets \
  "$NODEPASS_IMAGE" packages/server/dist/server/src/cli.js init-secrets \
  --directory /secrets --container-owners
```

Set the HTTPS origin and trusted ingress values described below, then start the bundle with `docker compose up --detach --no-build`. From a source checkout, append the `docker-compose.release.yml` override as documented in Releases. Coolify and Dokploy can use the bundle's corresponding Compose file directly; retain their platform-managed secrets.

### Build from source

The following commands use a POSIX shell, from the repository root. Protect the working directory and secret files. On Windows use equivalent PowerShell file commands and Docker Desktop host ACLs.

```sh
cp .env.example .env
docker build --tag nodepass:local .
mkdir -p secrets
docker run --rm --user 0 --mount type=bind,src="$PWD/secrets",dst=/secrets \
  nodepass:local packages/server/dist/server/src/cli.js init-secrets \
  --directory /secrets --container-owners
```

The one-time initializer requires ownership privileges and never overwrites existing files. The running app uses UID/GID **65532**; MariaDB secret files use **999**. Two differently owned files contain the same application database password. Windows host ACLs also apply.

Set these values in `.env`:

```dotenv
PUBLIC_URL=https://passwords.example.org
TRUST_PROXY=1
TRUSTED_PROXIES=172.20.0.2
```

Replace the example proxy address with the **actual immediate peer**, a dedicated ingress-only CIDR, or a trusted proxy's DNS name on a private container network. A proxy on the Docker host may appear as the bridge gateway. Never trust `0.0.0.0/0` or an entire shared platform network. Configure the proxy to overwrite `X-Forwarded-Proto` and `X-Real-IP`. Forwarded headers from untrusted peers are rejected.

`TRUSTED_PROXIES` accepts a comma-separated list of IPs, CIDRs and DNS names. Named peers are resolved when forwarded requests arrive, with no application address cache, so a recreated proxy can receive a different IP. Missing DNS does not prevent startup, but requests from unresolved peers are denied until resolution succeeds. Only configured names are resolved; request headers never select a trusted name. Protect the container network, its DNS configuration and proxy name/aliases: name resolution is part of this trust boundary.

```sh
docker compose up --detach --build
docker compose logs --tail 50 app
```

The app binds to `127.0.0.1:3000` on the host by default. Terminate HTTPS at the reverse proxy and forward to that port. The database is internal. The app filesystem is read-only except its data volume and bounded temporary filesystem.

Open the configured HTTPS origin. Read `secrets/setup-token` through your protected deployment access and use **New installation**. Create your own administrator, sign in and enroll a passkey or TOTP before vault access. Generate recovery codes in your personal settings and store them separately.

Back up `secrets/deployment-key` separately from encrypted backups. Setup changes are locked after installation; setup-job status still requires the configured token while the process is running. Keep the setup token configured as a deployment secret.

## Coolify

Create a **Docker Compose Empty** Service and paste `docker-compose.coolify.yml` into **Edit Compose File**. The repository template pulls the verified published **0.1.1** image by digest; it needs no Git checkout, Dockerfile or build context. Release archives contain the matching release's image instead. Set `NODEPASS_IMAGE` only when selecting another verified release digest.

Assign the HTTPS domain to service **app**, port **3000**, through Coolify's domain configuration. Set `PUBLIC_URL` to that exact origin.

If an existing Service reports `failed to read dockerfile: open Dockerfile: no such file or directory`, it has the earlier source-build template. Replace only `app.build` with the `image` and `platform` entries from this template, preserving all saved environment values, service names and volumes, then redeploy. A Docker Compose Empty Service stores the YAML but does not check out repository sources.

For a **new installation**, Coolify generates and persists these values when it parses the Compose definition:

- `SERVICE_REALBASE64_32_NODEPASSKEY` supplies `DEPLOYMENT_KEY`: exactly 32 random bytes encoded as Base64. `SERVICE_BASE64_*` is not the same generator and must not be substituted.
- `SERVICE_PASSWORD_64_NODEPASSSETUP` supplies the 64-character `SETUP_TOKEN`.
- `SERVICE_PASSWORD_64_NODEPASSDB` supplies the same database password to app and MariaDB.
- `SERVICE_PASSWORD_64_NODEPASSDBROOT` supplies a separate database root password.

Read the setup token from Coolify's protected Environment Variables page when opening the setup wizard. Back up the deployment key separately from encrypted backups. Do not regenerate these values on redeployments.

`TRUSTED_PROXIES` defaults to `coolify-proxy`. In normal Coolify Compose mode, Coolify creates the stack network and connects its proxy automatically; no static IP, custom subnet, predefined-network toggle or extra `networks:` block is needed. Keep the default unless you operate a differently named/custom proxy. Do not enable Raw Compose mode for this template.

**Existing installations:** before adopting this template, copy the existing `DEPLOYMENT_KEY`, `SETUP_TOKEN`, `DB_PASSWORD` and `DB_ROOT_PASSWORD` into the corresponding `SERVICE_*` variables above. Preserve their exact values; newly generated replacements cannot unlock existing data or change an initialized MariaDB password automatically.

This variant publishes no app or database host ports. Configure DNS/TLS in Coolify and validate proxy headers/name resolution in your own deployment. See [Coolify's generated Compose values](https://coolify.io/docs/applications/builds/docker-compose) and [networking](https://coolify.io/docs/core/networking-in-coolify).

For an intentional **source build**, create a Git-based Docker Compose **Application** with the repository root as its base directory. Combine `docker-compose.coolify.yml` followed by `docker-compose.build.yml`; both files and the Dockerfile must be present in the checkout. The override explicitly builds a local image. Pasting the source-build override into Docker Compose Empty cannot work.

## Dokploy

Dokploy supports automatic generation through **template import**, rather than Coolify's `SERVICE_*` variables. For a new installation from a verified release, use `dokploy-import.b64` in the deployment archive:

1. Create an empty **Docker Compose** service and open **Advanced → Import / Base64**.
2. Paste the contents of `dokploy-import.b64` and import once. Dokploy generates and stores a deployment key, setup token and two independent database passwords using the cryptographic `${base64:N}` helper in `dokploy.toml`.
3. In **Domains**, choose the public hostname, service **app**, port **3000**, and enable HTTPS with a certificate. The import creates a generated hostname; replace it if desired. Dokploy's importer does not automatically enable certificates.
4. Set `PUBLIC_URL` to that exact HTTPS origin if you change the generated hostname. Deploy, then read `SETUP_TOKEN` from the protected environment settings to complete setup.

The import already uses the release's pinned image and requires no source checkout/build context. It contains generator instructions, not actual secrets. **Import only for a new installation:** reimporting regenerates keys and passwords. Updates must preserve the saved environment, domains and volumes and change only the verified image reference.

From a source checkout, create an import payload for an already published and verified image:

```sh
npm run --silent deploy:dokploy -- ghcr.io/sapientorius/nodepass@sha256:REPLACE_WITH_VERIFIED_DIGEST
```

The repository's `docker-compose.dokploy.yml` also pulls the verified published 0.1.1 image by default and works without source files. When using that YAML directly, provision the four secrets in Dokploy's environment settings (`DEPLOYMENT_KEY`, `SETUP_TOKEN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`); template generators run only through import.

For intentional Git-based source builds, combine `docker-compose.dokploy.yml` followed by `docker-compose.build.yml`, with context **`.`** at the repository root. The override requires a real source checkout containing the Dockerfile.

`TRUSTED_PROXIES` defaults to `dokploy-traefik`; fixed proxy IPs are unnecessary. Dokploy adds ingress labels/networking for configured domains. Redeploy after domain changes; give the database no domain or published port.

This template targets Docker Compose, not Docker Swarm stacks. Validate the actual platform domain, ingress network and secret persistence. See [Dokploy's domain documentation](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Verify installation

Confirm readiness, administrator MFA, account permissions, secret access, backup and restore using non-production data first. `/health/live` checks the process; `/health/ready` checks database access, completed setup and an unlocked vault. Readiness **503 before setup completes is expected**. See [Operations](OPERATIONS.md) for backup, updates and troubleshooting.
