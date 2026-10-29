# Updates and upgrades

[Documentation home](../README.md#documentation) · [Installation](INSTALLATION.md) · [Operations](OPERATIONS.md) · [Releases](RELEASES.md)

This guide covers updating an existing nodePass installation. For the initial transition from sysPass, use [Migration](MIGRATION.md). The **Versions & updates** page reports releases; it does not install them.

## Select the target release

1. Read the target release and all intervening compatibility/upgrade notes in the [GitHub Releases](https://github.com/sapientorius/nodePass/releases) and [changelog](../CHANGELOG.md). Follow any required intermediate versions or additional migration steps. Before 1.0, a minor-version change can be incompatible; a patch update still needs a backup.
2. Verify the release assets, image attestation and **Required release checks** as described in [Releases](RELEASES.md#install-a-published-deployment-bundle). Use a stable release for a stable installation unless deliberately testing an RC.
3. Copy the complete `image.reference` from the verified `release-manifest.json`:

   ```dotenv
   NODEPASS_IMAGE=ghcr.io/sapientorius/nodepass@sha256:REPLACE_WITH_VERIFIED_DIGEST
   ```

`REPLACE_WITH_VERIFIED_DIGEST` is a placeholder for the release's 64-character SHA-256 digest. Record both the release version and image reference in your deployment history.

### Can I enter only a version number?

Container version tags such as `ghcr.io/sapientorius/nodepass:0.1.3` exist, but production deployments should use the verified digest. Registry tags can change; the digest identifies the exact image that was checked. Avoid `latest` and unattended image updates.

The templates use **`NODEPASS_IMAGE`**, which selects a release in one place without repeatedly replacing the Compose file. There is no `NODEPASS_VERSION` setting. The selector belongs to Compose/Coolify/Dokploy deployment configuration; adding it only inside the running app container cannot select another image.

Check the saved Compose definition before setting the variable:

| Compose definition                                                                                    | How the image is selected                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository Coolify/Dokploy template with `image: ${NODEPASS_IMAGE:-...}`                              | Set `NODEPASS_IMAGE` in the platform's environment settings. A saved value takes precedence over the YAML default.                          |
| Deployment archive or Dokploy import with a literal `image: ghcr.io/...@sha256:...`                   | Edit that image reference, or enable the variable once as described below. An environment variable alone does not override a literal image. |
| Source checkout with `docker-compose.release.yml` applied last, before any existing-database override | Set `NODEPASS_IMAGE` in `.env` or the deployment environment.                                                                               |

## Prepare before every update

1. Rehearse the update and restore with a separate representative database copy. Schedule a maintenance window; one active application process is supported.
2. Save the current image digest, Compose definition, platform/resource or Compose project identity, domain/proxy settings, volume mappings and protected environment/secret configuration. Keep the existing installation resource, service names and volumes. A new resource or project can create empty volumes instead of using the existing data.
3. Restrict normal user/API writes for maintenance. Create a final `.npb` backup using the **currently installed version**, through administration or the [CLI](OPERATIONS.md#cli-reference). Download/copy the completed file outside the app volume and retain the matching deployment key separately. Preserve any other required historical keys and original sysPass recovery material. See [backups and restore](OPERATIONS.md#backups-and-restore).
4. Stop the old application before starting the replacement. Keep writes blocked until verification completes. Do not run old and new app containers against the same database concurrently.

Keep `DEPLOYMENT_KEY`, `SETUP_TOKEN`, database passwords and their platform-generated `SERVICE_*` values unchanged. Do not run secret initialization or first-install setup again. Updating nodePass does not upgrade the database server; plan MariaDB/MySQL upgrades separately with their own backup and compatibility checks.

## Coolify

Use the **existing Docker Compose Empty Service**. Its saved YAML is independent of repository changes; a new GitHub release does not update it automatically.

### Enable the image variable once, if needed

If **Edit Compose File** already contains `image: ${NODEPASS_IMAGE:-...}` for `app`, continue to the update steps. For a literal image from a deployment archive, replace only `services.app.image` with:

```yaml
image: ${NODEPASS_IMAGE:?Set the verified release image digest}
```

Save the Compose definition, then set `NODEPASS_IMAGE` under the Service's **Environment Variables** before deploying. Preserve the other fields, environment values, volumes and domain assignment. Do not paste an entire new stack merely to select an image. If an older template still uses `app.build`, first follow the [source-build template correction](INSTALLATION.md#coolify) to switch it to a published image.

### Apply an update

1. Complete the preparation above and stop the old application using Coolify's controls. If stopping the Service also stops its database, let deployment start the database again with the same volume and credentials.
2. Set **`NODEPASS_IMAGE`** to the target release's verified `image.reference` in **Environment Variables** and save. If retaining a literal image instead, update that one YAML entry.
3. Compare the target release's Compose file with your saved definition. Apply any required changes called out in the release notes, preserving secrets, storage and platform settings. Routine image-only updates do not require a full YAML replacement. Changing the YAML fallback alone will not override an already saved `NODEPASS_IMAGE` value.
4. Deploy the existing Service. Check deployment/runtime logs for the expected digest and successful startup, then complete the verification below. A restart of the existing container alone does not apply a new image selection.

Never regenerate the `SERVICE_*` secrets, recreate the Service or remove its persistent storage as an update step. Keep `PUBLIC_URL`, the HTTPS domain for `app:3000` and trusted proxy settings consistent with the existing installation. Coolify documents [Compose variables and their persistence](https://coolify.io/docs/applications/builds/docker-compose#environment-variables).

## Dokploy

Use the existing Docker Compose service and complete the same preparation. If its `app.image` is a literal digest, edit that entry or enable the `NODEPASS_IMAGE` expression shown above once. Set the verified reference in the existing service's environment settings, save and deploy after stopping the old app. Review required Compose changes and complete the checks below.

**Do not reimport `dokploy-import.b64` to update an installation.** Import is for initial setup and regenerates keys/passwords. Preserve the saved environment, domains, service identity and volumes.

## Docker Compose

Run commands from the existing protected installation directory with the same project name, files and secret paths used for installation. Do not extract a new bundle over `.env`, secrets or local configuration. Compare its Compose files and apply required changes deliberately.

### Installation from a deployment archive

The archive's `docker-compose.yml` contains a literal image digest. Change only `services.app.image` to the target verified reference, or enable the `NODEPASS_IMAGE` expression above once and save the reference in the existing `.env`. Check for exported environment values that override `.env`.

After the final backup and stopping the old app:

```sh
docker compose pull app
docker compose up --detach --no-build --no-deps app
docker compose logs --tail 100 app
```

These commands assume the existing database remains running. `--no-deps` updates only the app, leaving a database-server upgrade for separate maintenance. If the database was stopped, start it with its existing configuration and wait for it to become healthy before starting the app.

### Installation from a source checkout using a published image

Set `NODEPASS_IMAGE` to the target verified reference in the existing `.env` or deployment environment. Use the release override on every command:

```sh
docker compose -f docker-compose.yml -f docker-compose.release.yml pull app
docker compose -f docker-compose.yml -f docker-compose.release.yml up --detach --no-build --no-deps app
docker compose -f docker-compose.yml -f docker-compose.release.yml logs --tail 100 app
```

Complete the same backup/stop steps first and keep the database running. For an external database, append `-f docker-compose.existing.yml` **after** the release override on every command and retain the existing connection configuration. Never start the bundled database as a substitute for the external one.

For an intentional source build, select the reviewed source commit, review configuration changes and build the app image before maintenance. After backup and stopping the old app, recreate only the app using the same deployment files and existing database. Source builds still require the full verification gate for the selected commit; the [local preview](INSTALLATION.md#local-preview) is a separate development deployment.

## Verify before reopening access

On an initialized installation, startup applies pending nodePass schema migrations automatically. The setup wizard and CLI `migrate` command are for initial setup/sysPass takeover, not routine nodePass updates. Do not rerun them after an upgrade. A failed schema/checksum check requires investigation; do not edit migration records to force startup.

- Confirm the running image digest in the deployment/container details and the installed version under **Versions & updates**.
- Check logs and `/health/live`, then require `/health/ready` to return HTTP 200. For example, `curl --fail https://passwords.example.org/health/ready` checks readiness through your HTTPS ingress. A previously initialized installation should not return to the setup wizard.
- Sign in with the required MFA and verify representative account visibility, permissions, password/custom-field access and attachments. Exercise a permitted test write using a designated test record, then verify backup creation and the integrations used by the installation.
- Reopen normal access only after the checks pass. Record the deployed version/digest and retain the pre-update recovery material according to the backup policy.

## If an update fails

Stop the new application and keep access restricted. Preserve sanitized logs, the failed database state and the pre-update backup/key pair for diagnosis. Confirm image selection, unchanged secrets, database access, mounted volumes and migration errors before retrying.

**Replacing the image with an older one is not a database rollback.** Migrations/data changes may already have committed, even when startup fails. Use an image-only rollback only when compatibility with the current database is explicitly established.

To recover the pre-update state, restore the pre-update backup using its matching application version and original deployment key into a **separate empty database**, following [backups and restore](OPERATIONS.md#backups-and-restore). Point the stopped installation at the restored database, keep only one app process, verify it as above and then reopen access. Sessions are revoked by restore; writes after the backup are not part of the recovered state. Keep the failed database separately until the incident is resolved.

Do not delete volumes, use `docker compose down --volumes` or reset/reinitialize the installation to fix an update. Returning to sysPass instead requires the distinct [pre-takeover rollback procedure](MIGRATION.md#verification-and-rollback).
