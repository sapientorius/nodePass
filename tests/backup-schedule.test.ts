import { describe, expect, it } from "vitest";
import {
  firstBackupAt,
  nextBackupAt,
  scheduleInput,
} from "../packages/server/src/services/backup-schedule.js";
import { backupMessages } from "../packages/web/src/backup-translations.js";
import { languages } from "../packages/contracts/src/index.js";
const input = {
  enabled: true,
  days: 2,
  time: "02:30",
  timezone: "Europe/Berlin",
  keep: 7,
};
describe("calendar backup schedule", () => {
  it("starts at the next wall time and maintains the calendar-day anchor", () => {
    const first = firstBackupAt(Date.parse("2026-10-01T00:00:00Z"), input);
    expect(new Date(first).toISOString()).toBe("2026-10-01T00:30:00.000Z");
    expect(new Date(nextBackupAt(first, input)).toISOString()).toBe(
      "2026-10-03T00:30:00.000Z",
    );
    expect(new Date(firstBackupAt(first, input)).toISOString()).toBe(
      "2026-10-02T00:30:00.000Z",
    );
  });
  it("executes a missing summer-time minute at the first valid minute", () => {
    expect(
      new Date(
        firstBackupAt(Date.parse("2026-03-28T23:00:00Z"), input),
      ).toISOString(),
    ).toBe("2026-03-29T01:00:00.000Z");
    expect(
      new Date(
        nextBackupAt(Date.parse("2026-03-28T01:30:00Z"), { ...input, days: 1 }),
      ).toISOString(),
    ).toBe("2026-03-29T01:00:00.000Z");
  });
  it("uses only the first repeated winter-time minute", () => {
    const first = firstBackupAt(Date.parse("2026-10-24T22:00:00Z"), input);
    expect(new Date(first).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(
      new Date(nextBackupAt(first, { ...input, days: 1 })).toISOString(),
    ).toBe("2026-10-26T01:30:00.000Z");
    expect(
      new Date(
        firstBackupAt(Date.parse("2026-10-25T00:45:00Z"), input),
      ).toISOString(),
    ).toBe("2026-10-26T01:30:00.000Z");
  });
  it("handles offset dates, leap days, extreme timezones and a skipped date", () => {
    expect(
      new Date(
        firstBackupAt(Date.parse("2028-02-28T23:59:00Z"), {
          ...input,
          timezone: "UTC",
          time: "00:00",
        }),
      ).toISOString(),
    ).toBe("2028-02-29T00:00:00.000Z");
    expect(
      new Date(
        firstBackupAt(Date.parse("2026-01-01T01:00:00Z"), {
          ...input,
          timezone: "Pacific/Kiritimati",
          time: "16:00",
        }),
      ).toISOString(),
    ).toBe("2026-01-01T02:00:00.000Z");
    expect(
      new Date(
        nextBackupAt(Date.parse("2011-12-29T12:00:00Z"), {
          ...input,
          timezone: "Pacific/Apia",
          days: 1,
          time: "02:00",
        }),
      ).toISOString(),
    ).toBe("2011-12-30T12:00:00.000Z");
  });
  it.each([
    null,
    [],
    {},
    { ...input, days: 0 },
    { ...input, days: 366 },
    { ...input, days: 1.5 },
    { ...input, keep: 0 },
    { ...input, keep: 366 },
    { ...input, keep: 1.2 },
    { ...input, enabled: 1 },
    { ...input, time: "24:00" },
    { ...input, time: "2:00" },
    { ...input, timezone: "invalid/zone" },
    { ...input, timezone: null },
    { ...input, extra: true },
  ])("rejects invalid configuration %j", (value) => {
    expect(() => scheduleInput(value)).toThrow();
  });
  it("accepts boundaries without adding metadata or modifying input", () => {
    expect(scheduleInput({ ...input, days: 365, keep: 365 })).toEqual({
      ...input,
      days: 365,
      keep: 365,
    });
  });
  it("provides every new message in all fourteen languages", () => {
    expect(Object.keys(backupMessages).sort()).toEqual([...languages].sort());
    const keys = Object.keys(backupMessages.en_US!);
    for (const locale of languages) {
      expect(Object.keys(backupMessages[locale]!)).toEqual(keys);
      expect(
        Object.values(backupMessages[locale]!).every(
          (v) => typeof v === "string" && v.length > 0,
        ),
      ).toBe(true);
    }
  });
});
