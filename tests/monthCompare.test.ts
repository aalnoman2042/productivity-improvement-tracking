import { describe, expect, it } from "vitest";
import {
  compareMonths,
  compareWindows,
  metricFor,
  type TrackerMonth,
} from "../lib/monthCompare";
import type { TrackerType } from "../lib/trackers";

/**
 * The comparison is only worth anything if it is fair, so most of these are
 * about fairness: equal windows, the right average for the kind of thing
 * being measured, and no percentage invented out of a zero baseline.
 */

describe("compareWindows", () => {
  it("compares a running month to the same stretch of the last one", () => {
    // The 22nd of August against the 1st–22nd of July, not all of July.
    const w = compareWindows("2026-08", "2026-08-22");
    expect(w.now).toEqual({ start: "2026-08-01", end: "2026-08-22" });
    expect(w.before).toEqual({ start: "2026-07-01", end: "2026-07-22" });
    expect(w.days).toBe(22);
    expect(w.partial).toBe(true);
  });

  it("compares a finished month whole", () => {
    const w = compareWindows("2026-07", "2026-08-22");
    expect(w.now).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(w.days).toBe(31);
    expect(w.partial).toBe(false);
  });

  it("never borrows days a short month doesn't have", () => {
    // 31 days of March cannot be matched by 31 days of February.
    const w = compareWindows("2026-03", "2026-04-10");
    expect(w.before).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("steps back across a year boundary", () => {
    const w = compareWindows("2026-01", "2026-02-05");
    expect(w.before.start).toBe("2025-12-01");
  });
});

describe("metricFor", () => {
  it("averages time and counts over every day, gaps included", () => {
    expect(metricFor("duration")).toBe("dailyAvg");
    expect(metricFor("count")).toBe("dailyAvg");
    expect(metricFor("prayer")).toBe("dailyAvg");
  });

  it("averages sleep and measurements over the days they were recorded", () => {
    // An unlogged night is not a night of no sleep.
    expect(metricFor("sleep")).toBe("perLogged");
    expect(metricFor("measure")).toBe("perLogged");
    expect(metricFor("scale")).toBe("perLogged");
  });

  it("reads yes/no habits as a rate", () => {
    expect(metricFor("check")).toBe("rate");
    expect(metricFor("streak")).toBe("rate");
  });
});

function tracker(over: Partial<TrackerMonth> & { type: TrackerType }): TrackerMonth {
  return {
    id: over.id ?? "t",
    name: over.name ?? "Study",
    color: "#2a78d6",
    unit: over.unit ?? "min",
    habit: over.habit ?? "good",
    type: over.type,
    now: over.now ?? { total: 0, logged: 0, done: 0 },
    before: over.before ?? { total: 0, logged: 0, done: 0 },
  };
}

describe("compareMonths", () => {
  it("reads more of a good habit as better, and says the numbers", () => {
    const [row] = compareMonths(
      [
        tracker({
          type: "duration",
          now: { total: 1200, logged: 18, done: 18 }, // 60m a day over 20 days
          before: { total: 600, logged: 12, done: 12 }, // 30m a day over 20 days
        }),
      ],
      20,
      20
    );
    expect(row.before).toBe("30m");
    expect(row.now).toBe("1h");
    expect(row.basis).toBe("a day");
    expect(row.change).toBe("up 100%");
    expect(row.readsAs).toBe("better");
  });

  it("reads more of a bad habit as worse", () => {
    const [row] = compareMonths(
      [
        tracker({
          type: "count",
          name: "Junk food",
          unit: "times",
          habit: "bad",
          now: { total: 20, logged: 10, done: 10 },
          before: { total: 10, logged: 8, done: 8 },
        }),
      ],
      20,
      20
    );
    expect(row.readsAs).toBe("worse");
    expect(row.change).toBe("up 100%");
  });

  it("leaves sleep and weight to say up or down, not good or bad", () => {
    const rows = compareMonths(
      [
        tracker({
          id: "sleep",
          type: "sleep",
          now: { total: 480 * 10, logged: 10, done: 10 }, // 8h a night
          before: { total: 420 * 10, logged: 10, done: 10 }, // 7h a night
        }),
        tracker({
          id: "weight",
          type: "measure",
          unit: "kg",
          now: { total: 700, logged: 10, done: 10 }, // 70kg
          before: { total: 800, logged: 10, done: 10 }, // 80kg
        }),
      ],
      20,
      20
    );
    const sleep = rows.find((r) => r.id === "sleep")!;
    const weight = rows.find((r) => r.id === "weight")!;
    expect(sleep.now).toBe("8h");
    expect(sleep.basis).toBe("a night");
    expect(sleep.readsAs).toBe("up");
    expect(weight.readsAs).toBe("down");
  });

  it("reads a yes/no habit as a share of the days", () => {
    const [row] = compareMonths(
      [
        tracker({
          type: "check",
          now: { total: 15, logged: 15, done: 15 }, // 15 of 20 days
          before: { total: 5, logged: 5, done: 5 }, // 5 of 20
        }),
      ],
      20,
      20
    );
    expect(row.before).toBe("25%");
    expect(row.now).toBe("75%");
    expect(row.basis).toBe("of days");
  });

  it("refuses to invent a percentage off nothing", () => {
    const rows = compareMonths(
      [
        tracker({
          id: "new",
          type: "duration",
          now: { total: 600, logged: 10, done: 10 },
          before: { total: 0, logged: 0, done: 0 },
        }),
        tracker({
          id: "stopped",
          type: "duration",
          now: { total: 0, logged: 0, done: 0 },
          before: { total: 600, logged: 10, done: 10 },
        }),
        tracker({ id: "never", type: "duration" }),
      ],
      20,
      20
    );
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("new").pct).toBeNull();
    expect(by("new").change).toBe("new this month");
    expect(by("stopped").change).toBe("stopped this month");
    expect(by("never").change).toBe("nothing either month");
  });

  it("calls a small move level rather than news", () => {
    const [row] = compareMonths(
      [
        tracker({
          type: "duration",
          now: { total: 1030, logged: 20, done: 20 },
          before: { total: 1000, logged: 20, done: 20 },
        }),
      ],
      20,
      20
    );
    expect(row.change).toBe("about level");
    expect(row.readsAs).toBe("about the same");
  });

  it("puts the biggest movement first and the uncomparable last", () => {
    const rows = compareMonths(
      [
        tracker({ id: "flat", type: "count", now: { total: 20, logged: 20, done: 20 }, before: { total: 20, logged: 20, done: 20 } }),
        tracker({ id: "never", type: "count" }),
        tracker({ id: "big", type: "count", now: { total: 60, logged: 20, done: 20 }, before: { total: 20, logged: 20, done: 20 } }),
      ],
      20,
      20
    );
    expect(rows.map((r) => r.id)).toEqual(["big", "flat", "never"]);
  });

  it("says nothing about which way a clean streak's rate reads", () => {
    const [row] = compareMonths(
      [
        tracker({
          type: "streak",
          habit: "bad",
          now: { total: 18, logged: 18, done: 18 },
          before: { total: 9, logged: 12, done: 9 },
        }),
      ],
      20,
      20
    );
    // The run itself is the story, and the report card already tells it.
    expect(row.readsAs).toBeNull();
  });
});
