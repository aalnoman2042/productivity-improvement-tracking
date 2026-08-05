import { describe, expect, it } from "vitest";
import { streakInfo } from "../lib/streak";

describe("streakInfo", () => {
  it("is empty before anything is logged", () => {
    expect(streakInfo(null, [], "2026-08-05")).toEqual({
      current: 0,
      best: 0,
      slips: 0,
      lastSlip: null,
      since: null,
    });
  });

  it("counts days since the first entry when there are no slips", () => {
    const s = streakInfo("2026-08-01", [], "2026-08-05");
    expect(s.current).toBe(5); // the 1st through the 5th, inclusive
    expect(s.best).toBe(5);
    expect(s.slips).toBe(0);
  });

  it("does not reset on a day that simply wasn't logged", () => {
    // Only slips are boundaries — a blank Aug 3rd doesn't appear here at all.
    const s = streakInfo("2026-07-01", [], "2026-08-05");
    expect(s.current).toBe(36);
  });

  it("resets to zero on a slip today", () => {
    const s = streakInfo("2026-08-01", ["2026-08-05"], "2026-08-05");
    expect(s.current).toBe(0);
    expect(s.lastSlip).toBe("2026-08-05");
  });

  it("counts from the day after the last slip", () => {
    const s = streakInfo("2026-08-01", ["2026-08-02"], "2026-08-05");
    expect(s.current).toBe(3); // the 3rd, 4th, 5th
  });

  it("keeps the best run even after it breaks", () => {
    // Eleven clean days (Jul 23 – Aug 2), a slip, then two days.
    const s = streakInfo("2026-07-23", ["2026-08-03"], "2026-08-05");
    expect(s.best).toBe(11);
    expect(s.current).toBe(2);
  });

  it("dedupes and ignores slips recorded for the future", () => {
    const s = streakInfo(
      "2026-08-01",
      ["2026-08-02", "2026-08-02", "2026-09-01"],
      "2026-08-05"
    );
    expect(s.slips).toBe(1);
    expect(s.current).toBe(3);
  });
});
