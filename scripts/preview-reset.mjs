// Fixed resource names and Compose labels restrict destructive operations to preview.
export async function resetPreview(docker) {
  const containers = [],
    volumes = [];
  for (const service of ["app", "db"]) {
    const name = `nodepass-preview-${service}-1`,
      result = await docker(["container", "inspect", name], true, true);
    if (result.code !== 0) {
      if (result.code === 1 && result.output.trim() === "[]") continue;
      throw new Error(
        "Reset abgebrochen: Docker-Container konnten nicht geprüft werden.",
      );
    }
    const [container] = JSON.parse(result.output),
      labels = container.Config?.Labels;
    if (
      container.Name !== `/${name}` ||
      labels?.["com.docker.compose.project"] !== "nodepass-preview" ||
      labels?.["com.docker.compose.service"] !== service
    )
      throw new Error(
        "Reset abgebrochen: Container gehört nicht eindeutig zur Vorschau.",
      );
    containers.push(container.Id);
  }
  for (const key of ["data", "database"]) {
    const name = `nodepass-preview_${key}`,
      result = await docker(["volume", "inspect", name], true, true);
    if (result.code !== 0) {
      if (result.code === 1 && result.output.trim() === "[]") continue;
      throw new Error(
        "Reset abgebrochen: Docker-Volumes konnten nicht geprüft werden.",
      );
    }
    const [volume] = JSON.parse(result.output),
      labels = volume.Labels;
    if (
      volume.Name !== name ||
      labels?.["com.docker.compose.project"] !== "nodepass-preview" ||
      labels?.["com.docker.compose.volume"] !== key
    )
      throw new Error(
        "Reset abgebrochen: Datenvolume gehört nicht eindeutig zur Vorschau.",
      );
    const attached = await docker(
      ["ps", "--all", "--quiet", "--filter", `volume=${name}`],
      true,
    );
    if (
      attached.output
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .some((id) => !containers.some((known) => known.startsWith(id)))
    )
      throw new Error(
        "Reset abgebrochen: Ein anderes Programm verwendet ein Vorschau-Volume.",
      );
    volumes.push(name);
  }
  // Inspect every target before the first mutation. No filesystem secrets are deleted.
  if (containers.length)
    await docker(["container", "rm", "--force", ...containers]);
  if (volumes.length) await docker(["volume", "rm", ...volumes]);
}
