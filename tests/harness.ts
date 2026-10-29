import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../packages/server/src/config.js";
import { createApp } from "../packages/server/src/app.js";
import { offlineUpdates } from "./offline-updates.js";
import { isolatedDatabase } from "./database.js";
import type { ServiceParams } from "../packages/server/src/services/accounts.js";
export const testPassword = "saffron lighthouse telescope violet 912!";
export async function harness() {
  const isolated = await isolatedDatabase(loadConfig()),
    directory = await mkdtemp(join(tmpdir(), "nodepass-test-")),
    config = { ...isolated.config, dataDir: directory };
  const runtime = await createApp(config, undefined, {
    updateFetch: offlineUpdates,
  });
  await runtime.migration.fresh({
    login: "admin",
    name: "Test admin",
    password: testPassword,
    token: config.setupToken,
  });
  const params = async (id = 1): Promise<ServiceParams> => {
    const user = await runtime.auth.user(id);
    const session = {
      id: randomBytes(32).toString("hex"),
      userId: id,
      csrf: "test-csrf",
      complete: 1,
      verifiedAt: Date.now(),
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    await runtime.db("nodepass_sessions").insert(session);
    return { identity: { user, session } };
  };
  return {
    ...runtime,
    config,
    params,
    dispose: async () => {
      await runtime.close();
      await isolated.drop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
