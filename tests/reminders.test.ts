import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_TIME,
  dayToLog,
  dueNow,
  localDateStr,
  localMinutes,
  parseTimeOfDay,
  reminderTime,
} from "../lib/reminders";

const DHAKA = 360; // UTC+6, the owner's clock
const LA = -420; // UTC-7, a clock on the other side of the date line

/** A UTC instant at which Dhaka's local clock reads `hhmm` on 2026-08-16. */
function dhakaAt(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 16, h, m) - DHAKA * 60_000);
}

describe("parseTimeOfDay", () => {
  it("takes a real time of day", () => {
    expect(parseTimeOfDay("23:00")).toBe("23:00");
    expect(parseTimeOfDay("00:00")).toBe("00:00");
    expect(parseTimeOfDay("07:45")).toBe("07:45");
  });

  it("refuses anything that isn't one", () => {
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("7:45")).toBeNull();
    expect(parseTimeOfDay("23:60")).toBeNull();
    expect(parseTimeOfDay(2300)).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
  });

  it("falls back to the hour the reminder always had", () => {
    expect(reminderTime(undefined)).toBe(DEFAULT_REMINDER_TIME);
    expect(reminderTime("nonsense")).toBe(DEFAULT_REMINDER_TIME);
    expect(reminderTime("06:30")).toBe("06:30");
  });
});

describe("where and when the reader is", () => {
  it("reads the local date, not the server's", () => {
    // 21:00 UTC on the 15th is already the 16th in Dhaka.
    const instant = new Date(Date.UTC(2026, 7, 15, 21, 0));
    expect(localDateStr(instant, DHAKA)).toBe("2026-08-16");
    expect(localDateStr(instant, LA)).toBe("2026-08-15");
  });

  it("counts minutes past local midnight", () => {
    expect(localMinutes(dhakaAt("23:10"), DHAKA)).toBe(23 * 60 + 10);
    expect(localMinutes(dhakaAt("00:05"), DHAKA)).toBe(5);
  });
});

describe("dueNow", () => {
  it("says nothing before the chosen hour", () => {
    expect(dueNow(dhakaAt("22:59"), DHAKA, "23:00")).toBe(false);
  });

  it("is due from the chosen hour onwards", () => {
    expect(dueNow(dhakaAt("23:00"), DHAKA, "23:00")).toBe(true);
    expect(dueNow(dhakaAt("23:45"), DHAKA, "23:00")).toBe(true);
  });

  it("is a catch-up, not a window — a late poll still delivers", () => {
    // The schedule slept from 20:00 to 22:00; the 20:30 slot is still owed.
    expect(dueNow(dhakaAt("22:00"), DHAKA, "20:30")).toBe(true);
  });

  it("starts over after midnight, so yesterday cannot leak into today", () => {
    expect(dueNow(dhakaAt("00:30"), DHAKA, "23:00")).toBe(false);
  });

  it("keeps the default hour for an account that never chose one", () => {
    expect(dueNow(dhakaAt("22:30"), DHAKA, undefined)).toBe(false);
    expect(dueNow(dhakaAt("23:05"), DHAKA, undefined)).toBe(true);
  });
});

describe("dayToLog", () => {
  it("an evening ask names the day that is wrapping up", () => {
    expect(dayToLog(dhakaAt("23:10"), DHAKA, "23:00")).toBe("2026-08-16");
  });

  it("one that slips past midnight still names the day that ended", () => {
    expect(dayToLog(dhakaAt("00:30"), DHAKA, "23:00")).toBe("2026-08-15");
  });

  it("a morning ask is about yesterday — nobody can report on today at 7 AM", () => {
    expect(dayToLog(dhakaAt("07:15"), DHAKA, "07:00")).toBe("2026-08-15");
  });

  it("noon is late enough to be about today", () => {
    expect(dayToLog(dhakaAt("12:30"), DHAKA, "12:00")).toBe("2026-08-16");
  });
});
