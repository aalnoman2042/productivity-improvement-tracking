import { describe, expect, it } from "vitest";
import {
  CATCHUP_DAYS,
  MAX_CATCHUP_DAYS,
  catchupBack,
  catchupLine,
  catchupWindow,
  missedDays,
  type CatchupDay,
} from "../lib/catchup";

const TODAY = "2026-08-25";

const day = (date: string, over: Partial<CatchupDay> = {}): CatchupDay => ({
  date,
  logged: 0,
  rest: false,
  ...over,
});

describe("catchupWindow", () => {
  it("ends yesterday — today is still being lived", () => {
    const w = catchupWindow(TODAY, 3);
    expect(w).toEqual(["2026-08-22", "2026-08-23", "2026-08-24"]);
    expect(w).not.toContain(TODAY);
  });

  it("runs oldest first", () => {
    const w = catchupWindow(TODAY);
    expect(w).toHaveLength(CATCHUP_DAYS);
    expect(w[0] < w[w.length - 1]).toBe(true);
  });
});

describe("catchupBack", () => {
  it("falls back to the default for anything that isn't a length", () => {
    expect(catchupBack(null)).toBe(CATCHUP_DAYS);
    expect(catchupBack("nonsense")).toBe(CATCHUP_DAYS);
    expect(catchupBack(0)).toBe(CATCHUP_DAYS);
    expect(catchupBack(-5)).toBe(CATCHUP_DAYS);
  });

  it("caps how far back anyone can dig", () => {
    expect(catchupBack(500)).toBe(MAX_CATCHUP_DAYS);
    expect(catchupBack("7")).toBe(7);
  });
});

describe("missedDays", () => {
  it("is the days with nothing on them", () => {
    const days = [
      day("2026-08-22", { logged: 3 }),
      day("2026-08-23"),
      day("2026-08-24"),
    ];
    expect(missedDays(days).map((d) => d.date)).toEqual([
      "2026-08-23",
      "2026-08-24",
    ]);
  });

  it("a day marked off was answered, not missed", () => {
    const days = [day("2026-08-23", { rest: true }), day("2026-08-24")];
    expect(missedDays(days).map((d) => d.date)).toEqual(["2026-08-24"]);
  });
});

describe("catchupLine", () => {
  it("says so plainly when nothing is missing", () => {
    const line = catchupLine([day("2026-08-24", { logged: 2 })], 14);
    expect(line).toContain("Nothing missing");
  });

  it("names the day when there is exactly one", () => {
    expect(catchupLine([day("2026-08-24")], 14)).toContain("Monday 24 Aug");
  });

  it("counts them, and never scolds", () => {
    const line = catchupLine([day("2026-08-23"), day("2026-08-24")], 14);
    expect(line).toContain("2 blank days");
    for (const word of ["failed", "should", "lazy", "again"]) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });

  it("counts a rested day as answered, not blank", () => {
    const line = catchupLine(
      [day("2026-08-23", { rest: true }), day("2026-08-24", { rest: true })],
      14
    );
    expect(line).toContain("Nothing missing");
  });
});
