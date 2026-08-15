import { describe, expect, it } from "vitest";
import {
  REMINDER_GRACE_MIN,
  checkReminders,
  parseReminderTimes,
  slotKey,
} from "../lib/trackerReminders";

const DHAKA = 360; // UTC+6, the owner's clock

/** The five waqts as fixed clock times, the way a user would set them. */
const WAQTS = ["05:00", "13:15", "16:45", "18:40", "20:00"];

/** A UTC instant at which Dhaka's local clock reads `hhmm` on 2026-08-16. */
function dhakaAt(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 7, 16, h, m) - DHAKA * 60_000);
}

describe("parseReminderTimes", () => {
  it("accepts a single well-formed time", () => {
    expect(parseReminderTimes("06:00")).toEqual(["06:00"]);
  });

  it("accepts a list, sorted and deduplicated", () => {
    expect(parseReminderTimes(["20:00", "05:00", "20:00"])).toEqual([
      "05:00",
      "20:00",
    ]);
  });

  it("drops malformed entries and caps the list at five", () => {
    expect(parseReminderTimes(["9:00", "24:00", "18:00"])).toEqual(["18:00"]);
    expect(
      parseReminderTimes(["01:00", "02:00", "03:00", "04:00", "05:00", "06:00"])
    ).toHaveLength(5);
  });

  it("is null when nothing valid remains", () => {
    expect(parseReminderTimes([])).toBeNull();
    expect(parseReminderTimes(["nope"])).toBeNull();
    expect(parseReminderTimes(null)).toBeNull();
    expect(parseReminderTimes(1800)).toBeNull();
  });
});

describe("checkReminders", () => {
  it("is quiet before the first slot", () => {
    const c = checkReminders({ times: WAQTS }, dhakaAt("04:59"), DHAKA);
    expect(c).toMatchObject({ due: null, missed: [], stamp: null });
  });

  it("is due from a slot's time through its grace window", () => {
    expect(checkReminders({ times: WAQTS }, dhakaAt("05:00"), DHAKA).due).toBe("05:00");
    expect(checkReminders({ times: WAQTS }, dhakaAt("07:59"), DHAKA).due).toBe("05:00");
  });

  it("stamps the slot it hands out", () => {
    const c = checkReminders({ times: WAQTS }, dhakaAt("05:10"), DHAKA);
    expect(c.stamp).toBe(slotKey("2026-08-16", "05:00"));
  });

  it("a handled slot goes quiet; the next waqt still speaks", () => {
    const afterFajr = { times: WAQTS, lastSentFor: "2026-08-16 05:00" };
    expect(checkReminders(afterFajr, dhakaAt("06:00"), DHAKA).due).toBeNull();
    expect(checkReminders(afterFajr, dhakaAt("13:20"), DHAKA).due).toBe("13:15");
  });

  it("each of the five waqts fires in turn across a day", () => {
    let last: string | null = null;
    const fired: string[] = [];
    for (const at of ["05:05", "13:20", "16:50", "18:45", "20:05"]) {
      const c = checkReminders({ times: WAQTS, lastSentFor: last }, dhakaAt(at), DHAKA);
      if (c.due) fired.push(c.due);
      if (c.stamp) last = c.stamp;
    }
    expect(fired).toEqual(WAQTS);
  });

  it("marks an unserved window missed rather than delivering late", () => {
    const past = dhakaAt("05:00").getTime() + (REMINDER_GRACE_MIN + 1) * 60_000;
    const c = checkReminders({ times: ["05:00"] }, new Date(past), DHAKA);
    expect(c).toMatchObject({ due: null, missed: ["05:00"] });
    expect(c.stamp).toBe(slotKey("2026-08-16", "05:00"));
  });

  it("when slots crowd one window, only the latest speaks", () => {
    // Scheduler down since dawn, back at 13:30: Fajr's window is long gone
    // (missed), Dhuhr's is open (due) — one push, not a backlog.
    const c = checkReminders({ times: WAQTS }, dhakaAt("13:30"), DHAKA);
    expect(c.due).toBe("13:15");
    expect(c.missed).toEqual(["05:00"]);
    expect(c.stamp).toBe(slotKey("2026-08-16", "13:15"));
  });

  it("judges the time in the user's zone, not the server's", () => {
    // 18:40 Dhaka is 12:40 UTC — a UTC user's clock says lunchtime.
    expect(checkReminders({ times: ["18:40"] }, dhakaAt("18:40"), DHAKA).due).toBe("18:40");
    expect(checkReminders({ times: ["18:40"] }, dhakaAt("18:40"), 0).due).toBeNull();
  });

  it("yesterday's stamp can't silence today", () => {
    const c = checkReminders(
      { times: WAQTS, lastSentFor: "2026-08-15 20:00" },
      dhakaAt("05:05"),
      DHAKA
    );
    expect(c.due).toBe("05:00");
  });

  it("past midnight, an unhandled evening slot stays unsent", () => {
    // 00:30 the next day: 20:00's window belongs to a date that's over.
    const after = new Date(dhakaAt("20:00").getTime() + 4.5 * 3_600_000);
    const c = checkReminders({ times: ["20:00"] }, after, DHAKA);
    expect(c).toMatchObject({ due: null, missed: [], stamp: null });
  });
});
