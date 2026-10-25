import { parentPort, workerData } from "node:worker_threads";
// security-exception: non-literal-regexp; expires=2027-01-15; bounded to 2 workers, 1s lifetime, 16 MiB heap, 512-char pattern and 1900-byte subject in regex.ts.
try {
  // nosemgrep: detect-non-literal-regexp
  const expression = new RegExp(workerData.pattern);
  parentPort!.postMessage({
    valid: true,
    matches: workerData.validateOnly
      ? true
      : expression.test(workerData.subject),
  });
} catch {
  parentPort!.postMessage({ valid: false, matches: false });
}
