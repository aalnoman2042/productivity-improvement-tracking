import { describe, expect, it } from "vitest";
import {
  REMINDER_GRACE_MIN,
  checkReminder,
  parseReminderTime,
} from "../lib/trackerReminders";

const DHAKA = 360; // UTC+6, the owner's clock

/** A UTC instant at which Dhaka's local clock reads `hhmm` on 2026-08-16. */
function dhakaAt(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 16, h, m) - DHAKA * 60_000);
}

describe("parseReminderTime", () => {
  it("accepts a well-formed time of day", () => {
    expect(parseReminderTime("06:00")).toBe("06:00");
    expect(parseReminderTime("23:59")).toBe("23:59");
    expect(parseReminderTime("00:00")).toBe("00:00");
  });

  it("rejects everything else", () => {
    expect(parseReminderTime("24:00")).toBeNull();
    expect(parseReminderTime("9:00")).toBeNull();
    expect(parseReminderTime("18:60")).toBeNull();
    expect(parseReminderTime("")).toBeNull();
    expect(parseReminderTime(null)).toBeNull();
    expect(parseReminderTime(1800)).toBeNull();
  });
});

describe("checkReminder", () => {
  it("is quiet before the set time", () => {
    const c = checkReminder({ time: "18:00" }, dhakaAt("17:59"), DHAKA);
    expect(c).toMatchObject({ due: false, missed: false });
  });

  it("is due from the set time through the grace window", () => {
    expect(checkReminder({ time: "18:00" }, dhakaAt("18:00"), DHAKA).due).toBe(true);
    expect(checkReminder({ time: "18:00" }, dhakaAt("20:59"), DHAKA).due).toBe(true);
  });

  it("reports the user's local date", () => {
    const c = checkReminder({ time: "18:00" }, dhakaAt("18:05"), DHAKA);
    expect(c.date).toBe("2026-08-16");
  });

  it("goes quiet once the day is stamped", () => {
    const c = checkReminder(
      { time: "18:00", lastSentFor: "2026-08-16" },
      dhakaAt("18:05"),
      DHAKA
    );
    expect(c).toMatchObject({ due: false, missed: false });
  });

  it("marks the window missed rather than delivering late", () => {
    const past = dhakaAt("18:00").getTime() + (REMINDER_GRACE_MIN + 1) * 60_000;
    const c = checkReminder({ time: "18:00" }, new Date(past), DHAKA);
    expect(c).toMatchObject({ due: false, missed: true });
  });

  it("judges the time in the user's zone, not the server's", () => {
    // 18:00 Dhaka is 12:00 UTC — a UTC clock would call this early.
    const c = checkReminder({ time: "18:00" }, dhakaAt("18:00"), DHAKA);
    expect(c.due).toBe(true);
    // And the same instant for a UTC user (12:00 local) is not due.
    const utc = checkReminder({ time: "18:00" }, dhakaAt("18:00"), 0);
    expect(utc).toMatchObject({ due: false, missed: false });
  });

  it("a stamp from yesterday doesn't silence today", () => {
    const c = checkReminder(
      { time: "18:00", lastSentFor: "2026-08-15" },
      dhakaAt("18:05"),
      DHAKA
    );
    expect(c.due).toBe(true);
  });

  it("handles a reminder set just before midnight", () => {
    const c = checkReminder({ time: "23:45" }, dhakaAt("23:50"), DHAKA);
    expect(c).toMatchObject({ due: true, date: "2026-08-16" });
    // Past midnight the *date* rolls over, so the stamp can't collide.
    const after = checkReminder(
      { time: "23:45", lastSentFor: "2026-08-16" },
      new Date(dhakaAt("23:50").getTime() + 60 * 60_000),
      DHAKA
    );
    expect(after.date).toBe("2026-08-17");
    expect(after).toMatchObject({ due: false, missed: false });
  });
});
