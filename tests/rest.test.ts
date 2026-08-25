import { describe, expect, it } from "vitest";
import { bestRun, cleanRestReason, loggingRun } from "../lib/rest";
import { challengeProgress } from "../lib/challenges";

const days = (...d: string[]) => new Set(d);

describe("loggingRun", () => {
  const TODAY = "2026-08-25";

  it("counts back from today", () => {
    expect(
      loggingRun(days("2026-08-23", "2026-08-24", "2026-08-25"), TODAY)
    ).toBe(3);
  });

  it("does not end because today is still blank", () => {
    expect(loggingRun(days("2026-08-23", "2026-08-24"), TODAY)).toBe(2);
  });

  it("steps over a day taken off on purpose", () => {
    // Logged Sat and Mon, rested Sunday: one run of two, not two of one.
    expect(
      loggingRun(
        days("2026-08-22", "2026-08-24", "2026-08-25"),
        TODAY,
        days("2026-08-23")
      )
    ).toBe(3);
  });

  it("never counts the rest day itself", () => {
    // Rested today and yesterday, logged the two days before.
    expect(
      loggingRun(
        days("2026-08-22", "2026-08-23"),
        TODAY,
        days("2026-08-24", "2026-08-25")
      )
    ).toBe(2);
  });

  it("still ends at a day that was simply missed", () => {
    expect(
      loggingRun(
        days("2026-08-20", "2026-08-21", "2026-08-24", "2026-08-25"),
        TODAY,
        days("2026-08-23")
      )
    ).toBe(2);
  });

  it("is zero for an account with nothing on record", () => {
    expect(loggingRun(days(), TODAY)).toBe(0);
    expect(loggingRun(days(), TODAY, days(TODAY))).toBe(0);
  });
});

describe("bestRun", () => {
  it("finds the longest run of consecutive days", () => {
    expect(
      bestRun(["2026-08-01", "2026-08-02", "2026-08-05", "2026-08-06", "2026-08-07"])
    ).toBe(3);
  });

  it("joins two runs across a planned rest", () => {
    expect(
      bestRun(
        ["2026-08-01", "2026-08-02", "2026-08-04", "2026-08-05"],
        days("2026-08-03")
      )
    ).toBe(4);
  });

  it("does not join across a gap that was only partly rested", () => {
    expect(
      bestRun(
        ["2026-08-01", "2026-08-02", "2026-08-05", "2026-08-06"],
        days("2026-08-03")
      )
    ).toBe(2);
  });

  it("ignores order and duplicates", () => {
    expect(bestRun(["2026-08-02", "2026-08-01", "2026-08-02"])).toBe(2);
  });

  it("is zero with nothing logged, however many days were rested", () => {
    expect(bestRun([], days("2026-08-01", "2026-08-02"))).toBe(0);
  });
});

describe("cleanRestReason", () => {
  it("keeps a short reason and refuses an empty one", () => {
    expect(cleanRestReason("  travelling ")).toBe("travelling");
    expect(cleanRestReason("   ")).toBeNull();
    expect(cleanRestReason(undefined)).toBeNull();
  });

  it("caps a long one", () => {
    expect(cleanRestReason("x".repeat(400))).toHaveLength(120);
  });
});

describe("challengeProgress with rest days", () => {
  const base = {
    startDate: "2026-08-20",
    days: 5,
    target: null,
    direction: "min" as const,
  };

  it("a rested day is neither met nor missed", () => {
    const p = challengeProgress(
      { ...base, values: { "2026-08-20": 1, "2026-08-22": 1, "2026-08-23": 1 } },
      "2026-08-24",
      days("2026-08-21")
    );
    expect(p.met).toBe(3);
    expect(p.rested).toBe(1);
    expect(p.missed).toBe(0);
    expect(p.perfect).toBe(true);
  });

  it("but it earns nothing — the bar is still the whole window", () => {
    const p = challengeProgress(
      { ...base, values: { "2026-08-20": 1, "2026-08-22": 1, "2026-08-23": 1 } },
      "2026-08-24",
      days("2026-08-21")
    );
    // Three days of five actually happened, and that is what pct says.
    expect(p.pct).toBe(60);
    expect(p.status).toBe("active");
  });

  it("a day nobody marked off is still a miss", () => {
    const p = challengeProgress(
      { ...base, values: { "2026-08-20": 1 } },
      "2026-08-24"
    );
    expect(p.missed).toBe(3);
    expect(p.rested).toBe(0);
    expect(p.perfect).toBe(false);
  });
});
