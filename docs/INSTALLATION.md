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

Replace the example proxy address with the **actual immediate peer** or a dedicated ingress-only CIDR. A proxy on the Docker host may appear as the bridge gateway. Verify its real source address; never trust `0.0.0.0/0`. Configure the proxy to overwrite `X-Forwarded-Proto` and `X-Real-IP`. Forwarded headers from untrusted peers are rejected.

```sh
docker compose up --detach --build
docker compose logs --tail 50 app
```

The app binds to `127.0.0.1:3000` on the host by default. Terminate HTTPS at the reverse proxy and forward to that port. The database is internal. The app filesystem is read-only except its data volume and bounded temporary filesystem.

Open the configured HTTPS origin. Read `secrets/setup-token` through your protected deployment access and use **New installation**. Create your own administrator, sign in and enroll a passkey or TOTP before vault access. Generate recovery codes in your personal settings and store them separately.

Back up `secrets/deployment-key` separately from encrypted backups. Setup changes are locked after installation; setup-job status still requires the configured token while the process is running. Keep the setup token configured as a deployment secret.

## Coolify

Use `docker-compose.coolify.yml` with build context **`.`** at the repository root. Assign the HTTPS domain to service **app**, port **3000**, through Coolify's domain configuration. Set `PUBLIC_URL` to that exact origin.

Configure persistent secrets/environment values in the platform:

- `DEPLOYMENT_KEY`: 32 random bytes encoded as canonical Base64.
- `SETUP_TOKEN`: at least 32 random characters.
- `DB_PASSWORD` and `DB_ROOT_PASSWORD`: independent random values.
- `PUBLIC_URL` and `TRUSTED_PROXIES`: the actual origin and isolated ingress peers.

This variant publishes no app or database host ports. Configure DNS/TLS in Coolify and preserve secret values across redeployments. Validate proxy headers and source addresses in your own deployment. See [Coolify's Compose documentation](https://coolify.io/docs/applications/builds/docker-compose).

## Dokploy

Use `docker-compose.dokploy.yml`, build context **`.`**, and the same secret variables as above. In **Domains**, assign the HTTPS host to service **app**, port **3000**. Dokploy adds Traefik labels when deploying. Redeploy after domain changes; give the database no domain.

Docker Swarm requires an already built, pinned image instead of `build:`. Validate the actual platform domain, ingress network and secret persistence. See [Dokploy's domain documentation](https://docs.dokploy.com/docs/core/docker-compose/domains).

## Verify installation

Confirm readiness, administrator MFA, account permissions, secret access, backup and restore using non-production data first. `/health/live` checks the process; `/health/ready` checks database access, completed setup and an unlocked vault. Readiness **503 before setup completes is expected**. See [Operations](OPERATIONS.md) for backup, updates and troubleshooting.
