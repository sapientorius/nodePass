import { describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  data: { pattern: "", subject: "", validateOnly: false },
  post: vi.fn(),
}));
vi.mock("node:worker_threads", () => ({
  workerData: mock.data,
  parentPort: { postMessage: mock.post },
}));
describe("password worker message protocol", () => {
  it.each([
    {
      pattern: "^A+$",
      subject: "AAA",
      validateOnly: false,
      expected: { valid: true, matches: true },
    },
    {
      pattern: "^A+$",
      subject: "lower",
      validateOnly: false,
      expected: { valid: true, matches: false },
    },
    {
      pattern: "^A+$",
      subject: "",
      validateOnly: true,
      expected: { valid: true, matches: true },
    },
    {
      pattern: "[",
      subject: "",
      validateOnly: true,
      expected: { valid: false, matches: false },
    },
  ])("returns only validated booleans", async (data) => {
    Object.assign(mock.data, data);
    mock.post.mockClear();
    vi.resetModules();
    await import("../packages/server/src/security/regex-worker.js");
    expect(mock.post).toHaveBeenCalledWith(data.expected);
  });
});
