import { describe, expect, it } from "vitest";
import {
  completeWeeksSince,
  isComplete,
  lastCompleteWeek,
  weekOf,
  weekTitle,
} from "../lib/weeklyReview";

// 2026-08-23 is a Sunday; 2026-08-24 the Monday after it.

describe("weekOf", () => {
  it("runs Monday to Sunday", () => {
    expect(weekOf("2026-08-19")).toEqual({ start: "2026-08-17", end: "2026-08-23" });
  });

  it("keeps Sunday in the week it ends, not the one it precedes", () => {
    expect(weekOf("2026-08-23")).toEqual({ start: "2026-08-17", end: "2026-08-23" });
    expect(weekOf("2026-08-24")).toEqual({ start: "2026-08-24", end: "2026-08-30" });
  });
});

describe("lastCompleteWeek", () => {
  it("reviews last week while this one is still being lived", () => {
    // Wednesday: the week you are in is not over, so it is not reviewable.
    expect(lastCompleteWeek("2026-08-19")).toEqual({
      start: "2026-08-10",
      end: "2026-08-16",
    });
  });

  it("does not review the week it is still Sunday of", () => {
    // The evening can still change the verdict — so Sunday reviews the week
    // before it, and Monday reviews the one that just ended.
    expect(lastCompleteWeek("2026-08-23")).toEqual({
      start: "2026-08-10",
      end: "2026-08-16",
    });
    expect(lastCompleteWeek("2026-08-24")).toEqual({
      start: "2026-08-17",
      end: "2026-08-23",
    });
  });

  it("always returns a week that is genuinely over", () => {
    for (const today of ["2026-01-01", "2026-03-15", "2026-08-23", "2026-12-31"]) {
      expect(isComplete(lastCompleteWeek(today), today)).toBe(true);
    }
  });
});

describe("weekTitle", () => {
  it("names a week inside one month once", () => {
    expect(weekTitle({ start: "2026-08-17", end: "2026-08-23" })).toBe("17–23 Aug");
  });

  it("names both months when the week straddles them", () => {
    expect(weekTitle({ start: "2026-06-29", end: "2026-07-05" })).toBe("29 Jun – 5 Jul");
  });
});

describe("completeWeeksSince", () => {
  it("counts back from the last complete week, newest first", () => {
    const weeks = completeWeeksSince("2026-07-01", "2026-08-24", 3);
    expect(weeks).toEqual([
      { start: "2026-08-17", end: "2026-08-23" },
      { start: "2026-08-10", end: "2026-08-16" },
      { start: "2026-08-03", end: "2026-08-09" },
    ]);
  });

  it("stops at the day the account has history from", () => {
    // Nothing before the first entry is a week worth offering to review.
    const weeks = completeWeeksSince("2026-08-12", "2026-08-24");
    expect(weeks).toEqual([
      { start: "2026-08-17", end: "2026-08-23" },
      { start: "2026-08-10", end: "2026-08-16" },
    ]);
  });

  it("never offers more than it was asked for", () => {
    expect(completeWeeksSince("2020-01-01", "2026-08-24")).toHaveLength(8);
  });

  it("offers nothing when no week has finished yet", () => {
    expect(completeWeeksSince("2026-08-24", "2026-08-26")).toEqual([]);
  });
});
