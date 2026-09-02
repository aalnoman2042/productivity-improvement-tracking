import { describe, expect, it } from "vitest";
import { yearAgoLine, type YearAgo } from "../lib/history";

const ago = (over: Partial<YearAgo> = {}): YearAgo => ({
  month: "2025-09",
  daysLogged: 12,
  minutes: 2460,
  through: "2025-09-30",
  partial: false,
  ...over,
});

describe("yearAgoLine — the payoff for a year of logging", () => {
  it("says nothing at all when there is no year to compare against", () => {
    expect(yearAgoLine({ daysLogged: 18, minutes: 3780 }, null, "September")).toBeNull();
    // A cached month written before this existed carries no field at all.
    expect(
      yearAgoLine({ daysLogged: 18, minutes: 3780 }, undefined, "September")
    ).toBeNull();
  });

  it("puts both years in one sentence", () => {
    expect(yearAgoLine({ daysLogged: 18, minutes: 3780 }, ago(), "September")).toBe(
      "September last year: 12 days and 41h. This year: 18 days and 63h."
    );
  });

  it("says 'so far' when only part of the month was counted", () => {
    const line = yearAgoLine(
      { daysLogged: 2, minutes: 300 },
      ago({ daysLogged: 1, minutes: 120, through: "2025-09-02", partial: true }),
      "September"
    );
    expect(line).toBe(
      "September so far last year: 1 day and 2h. This year: 2 days and 5h."
    );
  });

  it("counts one day as a day", () => {
    const line = yearAgoLine({ daysLogged: 1, minutes: 60 }, ago({ daysLogged: 1 }), "May");
    expect(line).toContain("1 day and");
    expect(line).not.toContain("1 days");
  });

  it("does not flinch at a year that went better than this one", () => {
    const line = yearAgoLine({ daysLogged: 3, minutes: 60 }, ago(), "September");
    // No judgement in either direction — it states both and stops.
    expect(line).toBe(
      "September last year: 12 days and 41h. This year: 3 days and 1h."
    );
  });
});
