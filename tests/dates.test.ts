import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketsForRange,
  isBeyondToday,
  periodEnd,
  periodLabel,
  periodOptions,
  periodRange,
  periodStart,
  previousRange,
  shiftPeriod,
} from "../lib/dates";

/**
 * The guard that makes the Tomorrow tab safe: the daily page may offer a
 * day before it starts, but only to plan it. Logging one is refused on the
 * server, where no client can edit the refusal out.
 */

describe("isBeyondToday", () => {
  const now = new Date("2026-08-23T12:00:00Z");

  it("allows today and everything behind it", () => {
    expect(isBeyondToday("2026-08-23", now)).toBe(false);
    expect(isBeyondToday("2026-08-22", now)).toBe(false);
    expect(isBeyondToday("2020-01-01", now)).toBe(false);
  });

  it("allows tomorrow, because somebody is already living it", () => {
    // UTC+14 is a real timezone with real users of nothing in particular;
    // refusing their evening's log would be a bug they could never explain.
    expect(isBeyondToday("2026-08-24", now)).toBe(false);
  });

  it("refuses a day nobody on Earth has reached", () => {
    expect(isBeyondToday("2026-08-25", now)).toBe(true);
    expect(isBeyondToday("2027-01-01", now)).toBe(true);
  });

  it("holds at the edges of a UTC day", () => {
    const midnight = new Date("2026-08-23T00:00:00Z");
    const lastMinute = new Date("2026-08-23T23:59:59Z");
    expect(isBeyondToday("2026-08-24", midnight)).toBe(false);
    expect(isBeyondToday("2026-08-25", lastMinute)).toBe(true);
  });

  it("crosses a month and a year without help", () => {
    expect(isBeyondToday("2026-09-01", new Date("2026-08-31T12:00:00Z"))).toBe(false);
    expect(isBeyondToday("2027-01-01", new Date("2026-12-31T12:00:00Z"))).toBe(false);
    expect(isBeyondToday("2027-01-02", new Date("2026-12-31T12:00:00Z"))).toBe(true);
  });
});

/**
 * Periods are calendar units, not rolling windows.
 *
 * The bug this exists to prevent: asking for August and being shown the
 * previous thirty days, which on the 3rd of September is mostly September.
 * A month is the 1st to the 31st, a week is Monday to Sunday, and a unit is
 * named by its first day everywhere in the app.
 */

describe("periodStart", () => {
  it("snaps a date back to the start of its unit", () => {
    expect(periodStart("week", "2026-08-20")).toBe("2026-08-17"); // a Thursday
    expect(periodStart("week", "2026-08-17")).toBe("2026-08-17"); // the Monday
    expect(periodStart("week", "2026-08-23")).toBe("2026-08-17"); // the Sunday
    expect(periodStart("month", "2026-08-31")).toBe("2026-08-01");
    expect(periodStart("year", "2026-12-31")).toBe("2026-01-01");
  });

  it("splits a month in half on the 16th", () => {
    expect(periodStart("15d", "2026-08-15")).toBe("2026-08-01");
    expect(periodStart("15d", "2026-08-16")).toBe("2026-08-16");
  });

  it("splits a year in half in July", () => {
    expect(periodStart("6mo", "2026-06-30")).toBe("2026-01-01");
    expect(periodStart("6mo", "2026-07-01")).toBe("2026-07-01");
  });
});

describe("periodEnd", () => {
  it("ends each unit on its own last day", () => {
    expect(periodEnd("week", "2026-08-17")).toBe("2026-08-23");
    expect(periodEnd("month", "2026-08-01")).toBe("2026-08-31");
    expect(periodEnd("month", "2026-09-01")).toBe("2026-09-30");
    expect(periodEnd("6mo", "2026-01-01")).toBe("2026-06-30");
    expect(periodEnd("6mo", "2026-07-01")).toBe("2026-12-31");
    expect(periodEnd("year", "2026-01-01")).toBe("2026-12-31");
  });

  it("knows how long February is", () => {
    expect(periodEnd("month", "2027-02-01")).toBe("2027-02-28");
    expect(periodEnd("month", "2028-02-01")).toBe("2028-02-29");
    expect(periodEnd("15d", "2027-02-16")).toBe("2027-02-28");
  });
});

describe("shiftPeriod", () => {
  it("steps to the neighbouring unit, across a year end", () => {
    expect(shiftPeriod("month", "2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftPeriod("month", "2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftPeriod("week", "2026-08-17", -1)).toBe("2026-08-10");
    expect(shiftPeriod("6mo", "2026-07-01", 1)).toBe("2027-01-01");
    expect(shiftPeriod("year", "2026-01-01", -2)).toBe("2024-01-01");
  });

  it("alternates the halves of a month", () => {
    expect(shiftPeriod("15d", "2026-08-16", 1)).toBe("2026-09-01");
    expect(shiftPeriod("15d", "2026-09-01", -1)).toBe("2026-08-16");
    expect(shiftPeriod("15d", "2026-01-01", -1)).toBe("2025-12-16");
  });
});

describe("periodRange", () => {
  it("gives a finished month whole, whichever day it is asked on", () => {
    const r = periodRange("month", "2026-08-14", "2026-09-03");
    expect(r).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-31",
      days: 31,
      partial: false,
    });
  });

  it("counts the month you are in up to today, not to the 31st", () => {
    // Otherwise the days you haven't lived yet read as days you didn't track.
    const r = periodRange("month", "2026-09-03", "2026-09-03");
    expect(r).toMatchObject({ start: "2026-09-01", end: "2026-09-03", days: 3 });
    expect(r.partial).toBe(true);
    expect(r.unitEnd).toBe("2026-09-30");
  });

  it("never lets one unit borrow a day from the next", () => {
    expect(periodRange("month", "2026-08-01", "2026-09-03").end).toBe("2026-08-31");
    expect(periodRange("year", "2026-05-05", "2027-01-01").end).toBe("2026-12-31");
  });
});

describe("previousRange", () => {
  it("compares a finished month with the whole month before it", () => {
    const august = periodRange("month", "2026-08-01", "2026-09-03");
    expect(previousRange("month", august)).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("compares a running month with the same many days of the last one", () => {
    // Three days of September against the whole of August would read as a
    // collapse every month, on the 3rd.
    const september = periodRange("month", "2026-09-03", "2026-09-03");
    expect(previousRange("month", september)).toEqual({
      start: "2026-08-01",
      end: "2026-08-03",
    });
  });
});

describe("periodLabel", () => {
  it("names a unit the way a person would", () => {
    expect(periodLabel("month", "2026-08-01")).toBe("August 2026");
    expect(periodLabel("year", "2026-01-01")).toBe("2026");
    expect(periodLabel("6mo", "2026-07-01")).toBe("Jul–Dec 2026");
    expect(periodLabel("15d", "2026-08-16")).toBe("16–31 Aug 2026");
    expect(periodLabel("week", "2026-08-17")).toBe("17–23 Aug 2026");
  });

  it("spells both months out when a week straddles them", () => {
    expect(periodLabel("week", "2026-08-31")).toBe("31 Aug – 6 Sep 2026");
  });
});

describe("periodOptions", () => {
  it("lists the units on record, newest first", () => {
    expect(periodOptions("month", "2026-06-14", "2026-09-03")).toEqual([
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
      "2026-06-01",
    ]);
  });

  it("stops rather than offering a list nobody can scroll", () => {
    expect(periodOptions("week", "2010-01-01", "2026-09-03", 5)).toHaveLength(5);
  });

  it("offers the current unit even with nothing logged", () => {
    expect(periodOptions("month", "2026-09-03", "2026-09-03")).toEqual([
      "2026-09-01",
    ]);
  });
});

/**
 * Weekly goals inside a calendar unit.
 *
 * A month almost never starts on a Monday, so its first and last weeks are
 * clipped — and a "5 per week" goal cannot be met in the two days of a week
 * that fall inside the month. Counting those as whole weeks scored a perfect
 * month 4/6. The route now judges only weeks that lie wholly inside the unit;
 * this pins the arithmetic that decision rests on.
 */
describe("whole weeks inside a unit", () => {
  const whole = (start: string, end: string) =>
    bucketsForRange(start, end, "week").filter(
      (wk) => wk >= start && addDays(wk, 6) <= end
    );

  it("drops the clipped weeks at either end of a month", () => {
    // September 2026 runs Tue 1st to Wed 30th.
    const { start, end } = periodRange("month", "2026-09-01");
    expect(bucketsForRange(start, end, "week")).toHaveLength(5);
    expect(whole(start, end)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("keeps every week of a unit that is already whole weeks", () => {
    // A week period is exactly one whole week.
    const { start, end } = periodRange("week", "2026-08-31");
    expect(whole(start, end)).toEqual(["2026-08-31"]);
  });

  it("finds none in a unit too short to hold one", () => {
    // The 1st of a month, viewed on the 1st: nothing whole to judge, which
    // is what the route's fallback exists for.
    const { start, end } = periodRange("month", "2026-09-01", "2026-09-01");
    expect(whole(start, end)).toEqual([]);
    expect(bucketsForRange(start, end, "week")).toHaveLength(1);
  });
});
