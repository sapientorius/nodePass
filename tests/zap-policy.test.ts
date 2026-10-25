import { describe, it, expect } from "vitest";
// @ts-expect-error Node-only audit policy is deliberately shared with the CI runner.
import { evaluateAlerts } from "../scripts/zap-policy.mjs";
describe("blocking security report policy", () => {
  const alert = {
      alertRef: "10055-6",
      name: "CSP: style-src unsafe-inline",
      risk: "Medium",
      url: "http://host.docker.internal:3101/",
    },
    exception = {
      ...alert,
      url: "^http://host\\.docker\\.internal:3101/$",
      owner: "test",
      reason: "explicit synthetic exception",
      expiresAt: "2027-01-15T00:00:00Z",
    };
  it("blocks actual ZAP API risk strings, including every high alert", () => {
    expect(evaluateAlerts([alert], [])).toHaveLength(1);
    expect(evaluateAlerts([{ ...alert, risk: "High" }], [])).toHaveLength(1);
    expect(
      evaluateAlerts(
        [
          { ...alert, risk: "Low" },
          { ...alert, risk: "Informational" },
        ],
        [],
      ),
    ).toHaveLength(0);
  });
  it("fails closed on missing severity, unknown formats and malformed exceptions", () => {
    for (const item of [
      { ...alert, risk: undefined },
      { ...alert, risk: "Unknown" },
      { ...alert, url: undefined },
    ])
      expect(() => evaluateAlerts([item], [])).toThrow();
    expect(() => evaluateAlerts(null, [])).toThrow();
    expect(() => evaluateAlerts([], [{}])).toThrow();
  });
  it("limits exceptions to exact rule, name, target and lifetime", () => {
    expect(
      evaluateAlerts([alert], [exception], new Date("2026-10-23")),
    ).toHaveLength(0);
    for (const item of [
      { ...alert, url: "https://production.example.org/" },
      { ...alert, alertRef: "10055-7" },
      { ...alert, name: "CSP: script-src unsafe-inline" },
    ])
      expect(
        evaluateAlerts([item], [exception], new Date("2026-10-23")),
      ).toHaveLength(1);
    expect(
      evaluateAlerts([alert], [exception], new Date("2027-02-01")),
    ).toHaveLength(1);
  });
});
