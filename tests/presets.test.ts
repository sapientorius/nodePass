import { describe, it, expect } from "vitest";
import { checkLegacyPattern } from "../packages/server/src/security/regex.js";
import {
  validatePreset,
  sessionRange,
} from "../packages/server/src/compat/preset-validation.js";
import { mapData } from "../packages/server/src/compat/data.js";
describe("safe structured legacy data", () => {
  it.each(["NPJ1:null", "NPJ1:[]", "NPJ1:0", 'NPJ1:{"__proto__":true}'])(
    "rejects invalid structured data %s",
    (source) => expect(() => mapData(source)).toThrow(),
  );
});
describe("bounded password pattern workers", () => {
  it("matches ordinary legacy patterns including lookaheads without running them on the event loop", async () => {
    expect(await checkLegacyPattern("", "")).toBe(true);
    expect(
      await checkLegacyPattern("^(?=.*[A-Z])(?=.*[0-9]).{8,}$", "Saffron83"),
    ).toBe(true);
    expect(await checkLegacyPattern("^[A-Z]+$", "lowercase")).toBe(false);
    expect(await checkLegacyPattern("^a$", "", true)).toBe(true);
  });
  it("rejects invalid/oversized patterns and bounds catastrophic backtracking", async () => {
    await expect(checkLegacyPattern("[", "")).rejects.toThrow("Unsupported");
    await expect(checkLegacyPattern("x".repeat(513), "")).rejects.toThrow(
      "size",
    );
    await expect(checkLegacyPattern("x", "x".repeat(1901))).rejects.toThrow(
      "size",
    );
    const work = [
      checkLegacyPattern("(a+)+$", "a".repeat(128) + "!"),
      checkLegacyPattern("(a+)+$", "a".repeat(128) + "!"),
    ];
    await expect(checkLegacyPattern("a", "a")).rejects.toThrow("capacity");
    await Promise.all(work.map((p) => expect(p).rejects.toThrow()));
  });
});
describe("preset limits and compatible subnets", () => {
  it("accepts known data shapes and validates pattern syntax before migration", async () => {
    for (const [type, data] of [
      ["account.private", { privateUser: true, privateGroup: 0 }],
      ["account.permission", { usersView: [1], usersEdit: { 0: "2" } }],
      ["account.tag", { tags: ["ops"] }],
      [
        "account.password",
        { length: 15, score: 3, expireTime: 3600, regex: "^[A-Z].*" },
      ],
      [
        "session.timeout",
        { address: "127.0.0.0", mask: "255.255.255.0", timeout: 60 },
      ],
    ] as const)
      await expect(validatePreset(type, data)).resolves.toBeUndefined();
    expect(sessionRange({ address: "::1/128" })).toBe("::1/128");
    expect(
      sessionRange({ address: "127.0.0.1", mask: "255.255.255.255" }),
    ).toBe("127.0.0.1/32");
  });
  it.each([
    ["unknown", {}],
    ["account.private", { root: true }],
    ["account.private", { privateUser: "yes" }],
    ["account.password", { length: -1 }],
    ["account.password", { regex: 123 }],
    ["account.permission", { usersView: "bad" }],
    ["account.permission", { usersView: [0] }],
    ["account.tag", { tags: [""] }],
    ["account.tag", { tags: [7] }],
    ["session.timeout", { address: "host", timeout: 60 }],
    ["session.timeout", { address: "127.0.0.1" }],
    ["session.timeout", { address: "127.0.0.1", timeout: 0 }],
    [
      "session.timeout",
      { address: "127.0.0.1", mask: "255.0.255.0", timeout: 60 },
    ],
    [
      "session.timeout",
      { address: "127.0.0.1", mask: "999.0.0.0", timeout: 60 },
    ],
    ["session.timeout", { address: "127.0.0.1", mask: "255", timeout: 60 }],
  ])("rejects unsupported preset %s", async (type, data) => {
    await expect(
      validatePreset(type as string, data as object),
    ).rejects.toThrow();
  });
});
