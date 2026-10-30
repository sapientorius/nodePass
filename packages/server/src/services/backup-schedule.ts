import { BadRequest } from "@feathersjs/errors";
import type { BackupScheduleInput } from "@nodepass/contracts";

export function scheduleInput(value: unknown): BackupScheduleInput {
  const v = value as BackupScheduleInput;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) => !["enabled", "days", "time", "timezone", "keep"].includes(k),
    ) ||
    typeof v.enabled !== "boolean" ||
    !Number.isInteger(v.days) ||
    v.days < 1 ||
    v.days > 365 ||
    !Number.isInteger(v.keep) ||
    v.keep < 1 ||
    v.keep > 365 ||
    typeof v.time !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.time) ||
    typeof v.timezone !== "string" ||
    v.timezone.length > 100
  )
    throw new BadRequest("Invalid backup schedule");
  try {
    new Intl.DateTimeFormat("en", { timeZone: v.timezone }).format(0);
  } catch {
    throw new BadRequest("Invalid backup timezone");
  }
  return {
    enabled: v.enabled,
    days: v.days,
    time: v.time,
    timezone: v.timezone,
    keep: v.keep,
  };
}

function calendar(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (key: string) => Number(parts.find((p) => p.type === key)!.value);
  return {
    date: Date.UTC(get("year"), get("month") - 1, get("day")),
    minute: get("hour") * 60 + get("minute"),
  };
}

/** Earliest occurrence; a missing wall time advances to the first valid minute that day. */
function wallTime(date: number, time: string, timezone: string): number {
  const [h, m] = time.split(":").map(Number),
    minute = h! * 60 + m!;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // All IANA offsets, including date-line transitions, fit inside this bounded window.
  let fallback: number | undefined;
  let bestMinute = Infinity;
  for (let at = date - 18 * 3600000; at <= date + 42 * 3600000; at += 60000) {
    const parts = format.formatToParts(at);
    const get = (key: string) =>
      Number(parts.find((p) => p.type === key)!.value);
    if (Date.UTC(get("year"), get("month") - 1, get("day")) !== date) continue;
    const actual = get("hour") * 60 + get("minute");
    if (actual === minute) return at;
    if (actual > minute && actual < bestMinute) {
      bestMinute = actual;
      fallback = at;
    }
  }
  if (fallback !== undefined) return fallback;
  // A whole skipped calendar day has no occurrence. Continue on the following day.
  return wallTime(date + 86400000, time, timezone);
}

export function firstBackupAt(
  after: number,
  input: BackupScheduleInput,
): number {
  let day = calendar(after, input.timezone).date;
  let at = wallTime(day, input.time, input.timezone);
  if (at <= after) {
    day += 86400000;
    at = wallTime(day, input.time, input.timezone);
  }
  return at;
}

export function nextBackupAt(
  previous: number,
  input: BackupScheduleInput,
): number {
  return wallTime(
    calendar(previous, input.timezone).date + input.days * 86400000,
    input.time,
    input.timezone,
  );
}
