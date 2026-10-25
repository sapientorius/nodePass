import { describe, it, expect } from "vitest";
import { resetPreview } from "../scripts/preview-reset.mjs";

function fixture() {
  const project = "nodepass-preview",
    containers = ["app", "db"].map((service, index) => ({
      Id: String(index + 1).repeat(64),
      Name: `/${project}-${service}-1`,
      Config: {
        Labels: {
          "com.docker.compose.project": project,
          "com.docker.compose.service": service,
        },
      },
    })),
    volumes = ["data", "database"].map((key) => ({
      Name: `${project}_${key}`,
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.volume": key,
      },
    })),
    calls: string[][] = [];
  let attachments = containers.map((c) => c.Id.slice(0, 12)).join("\n");
  const docker = async (args: string[]) => {
    calls.push(args);
    if (args[1] === "inspect") {
      const row =
        args[0] === "container"
          ? containers.find((c) => c.Name === "/" + args[2])
          : volumes.find((v) => v.Name === args[2]);
      return { code: row ? 0 : 1, output: JSON.stringify(row ? [row] : []) };
    }
    return { code: 0, output: args[0] === "ps" ? attachments : "" };
  };
  return {
    containers,
    volumes,
    calls,
    docker,
    attach: (ids: string) => {
      attachments = ids;
    },
  };
}
const mutations = (calls: string[][]) =>
  calls.filter((args) => args[1] === "rm");
describe("preview reset stays within owned resources", () => {
  it("checks every target and attachment before deleting only fixed preview resources", async () => {
    const f = fixture();
    await resetPreview(f.docker);
    expect(mutations(f.calls)).toEqual([
      ["container", "rm", "--force", ...f.containers.map((c) => c.Id)],
      ["volume", "rm", "nodepass-preview_data", "nodepass-preview_database"],
    ]);
    expect(f.calls.findIndex((args) => args[1] === "rm")).toBe(6);
  });
  it("refuses foreign containers before any deletion", async () => {
    const f = fixture();
    f.containers[1]!.Config.Labels["com.docker.compose.project"] = "production";
    await expect(resetPreview(f.docker)).rejects.toThrow("Container");
    expect(mutations(f.calls)).toEqual([]);
  });
  it("refuses a misleading container name", async () => {
    const f = fixture();
    const fake = async (args: string[]) =>
      args[1] === "inspect"
        ? {
            code: 0,
            output: JSON.stringify([
              { ...f.containers[0], Name: "/production" },
            ]),
          }
        : f.docker(args);
    await expect(resetPreview(fake)).rejects.toThrow("Container");
    expect(mutations(f.calls)).toEqual([]);
  });
  it("refuses foreign volume labels after container checks and before any deletion", async () => {
    const f = fixture();
    f.volumes[1]!.Labels["com.docker.compose.volume"] = "production";
    await expect(resetPreview(f.docker)).rejects.toThrow("Datenvolume");
    expect(mutations(f.calls)).toEqual([]);
  });
  it("refuses volumes shared with an unknown container", async () => {
    const f = fixture();
    f.attach("abcdef123456");
    await expect(resetPreview(f.docker)).rejects.toThrow("anderes Programm");
    expect(mutations(f.calls)).toEqual([]);
  });
  it("handles already absent preview resources without mutations", async () => {
    const calls: string[][] = [];
    await resetPreview(async (args: string[]) => {
      calls.push(args);
      return { code: 1, output: "[]\n" };
    });
    expect(calls).toHaveLength(4);
    expect(mutations(calls)).toEqual([]);
  });
  it.each(["container", "volume"])(
    "fails closed on a %s inspection error",
    async (kind) => {
      const f = fixture();
      await expect(
        resetPreview(async (args: string[]) =>
          args[0] === kind ? { code: 1, output: "" } : f.docker(args),
        ),
      ).rejects.toThrow("konnten nicht geprüft");
      expect(mutations(f.calls)).toEqual([]);
    },
  );
  it("propagates deletion failure instead of claiming success", async () => {
    const f = fixture();
    await expect(
      resetPreview(async (args: string[]) => {
        if (args[1] === "rm") throw new Error("Docker failed");
        return f.docker(args);
      }),
    ).rejects.toThrow("Docker failed");
  });
});
