import { Worker } from "node:worker_threads";
import { BadRequest, TooManyRequests } from "@feathersjs/errors";
let active = 0;
/** Isolate backtracking legacy patterns; never evaluate them on the API event loop. */
export async function checkLegacyPattern(
  pattern: string,
  subject: string,
  validateOnly = false,
): Promise<boolean> {
  if (!pattern) return true;
  if (
    typeof pattern !== "string" ||
    pattern.length > 512 ||
    typeof subject !== "string" ||
    Buffer.byteLength(subject) > 1900
  )
    throw new BadRequest("Unsupported password pattern size");
  if (active >= 2)
    throw new TooManyRequests("Pattern validation capacity reached");
  active++;
  const path = new URL(
    import.meta.url.endsWith(".ts") ? "./regex-worker.ts" : "./regex-worker.js",
    import.meta.url,
  );
  let worker: Worker | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      worker = new Worker(path, {
        workerData: { pattern, subject, validateOnly },
        resourceLimits: { maxOldGenerationSizeMb: 16, stackSizeMb: 2 },
      });
      timer = setTimeout(
        () =>
          reject(new BadRequest("Password pattern exceeded its time budget")),
        1000,
      );
      worker.once("error", () =>
        reject(new BadRequest("Password pattern worker failed")),
      );
      worker.once("exit", (code) => {
        if (code !== 0)
          reject(new BadRequest("Password pattern worker exited"));
      });
      worker.once("message", (result: { valid: boolean; matches: boolean }) => {
        if (!result.valid)
          reject(new BadRequest("Unsupported legacy password pattern"));
        else resolve(result.matches);
      });
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    active--;
  }
}
