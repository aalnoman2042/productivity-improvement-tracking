import { describe, expect, it } from "vitest";
import { challengeEnd, challengeProgress, dayMet } from "../lib/challenges";

describe("challengeEnd", () => {
  it("is inclusive of the start day", () => {
    expect(challengeEnd({ startDate: "2026-08-01", days: 1 })).toBe("2026-08-01");
    expect(challengeEnd({ startDate: "2026-08-01", days: 30 })).toBe("2026-08-30");
  });

  it("crosses month ends", () => {
    expect(challengeEnd({ startDate: "2026-07-25", days: 10 })).toBe("2026-08-03");
  });
});

describe("dayMet", () => {
  const atLeast = (target: number | null) => ({ target, direction: "min" as const });
  const atMost = (target: number | null) => ({ target, direction: "max" as const });

  it("with no target, any real log counts", () => {
    expect(dayMet(atLeast(null), 1)).toBe(true);
    expect(dayMet(atLeast(null), 0)).toBe(false); // a streak slip is stored as 0
    expect(dayMet(atLeast(null), undefined)).toBe(false);
  });

  it("at least: must be logged and over the line", () => {
    expect(dayMet(atLeast(120), 120)).toBe(true);
    expect(dayMet(atLeast(120), 119)).toBe(false);
    expect(dayMet(atLeast(120), undefined)).toBe(false);
  });

  it("at most: an unlogged day is a day you stayed under", () => {
    expect(dayMet(atMost(2), undefined)).toBe(true);
    expect(dayMet(atMost(2), 2)).toBe(true);
    expect(dayMet(atMost(2), 3)).toBe(false);
  });
});

describe("challengeProgress", () => {
  const base = {
    startDate: "2026-08-01",
    days: 7,
    target: null,
    direction: "min" as const,
  };

  it("is upcoming before the start date", () => {
    const p = challengeProgress({ ...base, values: {} }, "2026-07-31");
    expect(p.status).toBe("upcoming");
    expect(p.dayNumber).toBe(0);
    expect(p.met).toBe(0);
  });

  it("counts met days and doesn't hold today against you yet", () => {
    const values = { "2026-08-01": 1, "2026-08-02": 1 };
    const p = challengeProgress({ ...base, values }, "2026-08-03");
    expect(p.status).toBe("active");
    expect(p.dayNumber).toBe(3);
    expect(p.met).toBe(2);
    expect(p.missed).toBe(0); // today is still open
    expect(p.todayMet).toBe(false);
    expect(p.perfect).toBe(true);
  });

  it("a past unmet day is a miss, and breaks perfect", () => {
    const values = { "2026-08-01": 1 }; // the 2nd was skipped
    const p = challengeProgress({ ...base, values }, "2026-08-03");
    expect(p.missed).toBe(1);
    expect(p.perfect).toBe(false);
  });

  it("completes when every day of the window was met", () => {
    const values = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`2026-08-0${i + 1}`, 1])
    );
    const done = challengeProgress({ ...base, values }, "2026-08-07");
    expect(done.status).toBe("completed");
    expect(done.met).toBe(7);
    expect(done.pct).toBe(100);

    const after = challengeProgress({ ...base, values }, "2026-08-20");
    expect(after.status).toBe("completed");
    expect(after.dayNumber).toBe(7);
  });

  it("ends unfinished when the window closes with misses", () => {
    const p = challengeProgress(
      { ...base, values: { "2026-08-01": 1 } },
      "2026-08-20"
    );
    expect(p.status).toBe("ended");
    expect(p.met).toBe(1);
    expect(p.missed).toBe(6);
  });

  it("judges an at-least amount per day", () => {
    const c = { ...base, target: 60, direction: "min" as const };
    const values = { "2026-08-01": 60, "2026-08-02": 45 };
    const p = challengeProgress({ ...c, values }, "2026-08-03");
    expect(p.met).toBe(1);
    expect(p.missed).toBe(1);
  });

  it("an at-most challenge treats quiet days as clean", () => {
    const c = { ...base, target: 1, direction: "max" as const };
    const values = { "2026-08-02": 3 }; // one bad day, nothing else logged
    const p = challengeProgress({ ...c, values }, "2026-08-04");
    expect(p.met).toBe(3); // 1st, 3rd and today all stayed under
    expect(p.missed).toBe(1);
    expect(p.todayMet).toBe(true);
  });
});
