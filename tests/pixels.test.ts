import { describe, expect, it } from "vitest";
import { levelFor, monthLabels, pixelYear, startOfWeek } from "../lib/pixels";

describe("startOfWeek", () => {
  it("goes back to Monday", () => {
    // 2026-08-25 is a Tuesday.
    expect(startOfWeek("2026-08-25")).toBe("2026-08-24");
  });

  it("treats Sunday as the end of its week, not the start", () => {
    // 2026-08-23 is a Sunday.
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
  });

  it("leaves a Monday where it is", () => {
    expect(startOfWeek("2026-08-24")).toBe("2026-08-24");
  });
});

describe("levelFor", () => {
  it("gives nothing its own level, never a shade of something", () => {
    expect(levelFor(0, 100)).toBe(0);
  });

  it("spreads the rest over four steps", () => {
    expect(levelFor(10, 100)).toBe(1);
    expect(levelFor(40, 100)).toBe(2);
    expect(levelFor(60, 100)).toBe(3);
    expect(levelFor(100, 100)).toBe(4);
  });

  it("survives a window whose best day is zero", () => {
    expect(levelFor(5, 0)).toBe(1);
  });
});

describe("pixelYear", () => {
  const values = {
    "2026-08-24": 60,
    "2026-08-25": 30,
    "2026-08-27": 120,
  };

  it("lays days out in columns of seven", () => {
    const y = pixelYear("2026-08-24", "2026-08-30", values);
    expect(y.weeks).toHaveLength(1);
    expect(y.weeks[0]).toHaveLength(7);
    expect(y.weeks[0][0]?.date).toBe("2026-08-24");
    expect(y.weeks[0][6]?.date).toBe("2026-08-30");
  });

  it("leaves the days before the window empty rather than inventing them", () => {
    // Starts on a Wednesday, so Monday and Tuesday are outside the range.
    const y = pixelYear("2026-08-26", "2026-08-30", values);
    expect(y.weeks[0][0]).toBeNull();
    expect(y.weeks[0][1]).toBeNull();
    expect(y.weeks[0][2]?.date).toBe("2026-08-26");
  });

  it("pads the final week so every column is seven tall", () => {
    const y = pixelYear("2026-08-24", "2026-08-26", values);
    expect(y.weeks[0]).toHaveLength(7);
    expect(y.weeks[0][6]).toBeNull();
  });

  it("counts the days that hold something, and the biggest of them", () => {
    const y = pixelYear("2026-08-24", "2026-08-30", values);
    expect(y.logged).toBe(3);
    expect(y.max).toBe(120);
    expect(y.total).toBe(210);
  });

  it("shades against the best day in the window", () => {
    const y = pixelYear("2026-08-24", "2026-08-30", values);
    const day = (d: string) => y.weeks.flat().find((x) => x?.date === d)!;
    expect(day("2026-08-27").level).toBe(4);
    expect(day("2026-08-24").level).toBe(2);
    expect(day("2026-08-26").level).toBe(0);
  });

  it("marks a rest day as itself, not as a hole", () => {
    const y = pixelYear(
      "2026-08-24",
      "2026-08-30",
      values,
      new Set(["2026-08-26"])
    );
    const day = y.weeks.flat().find((x) => x?.date === "2026-08-26")!;
    expect(day.rest).toBe(true);
    expect(day.level).toBe(0);
    expect(y.rested).toBe(1);
    // And it is still not a logged day — a flag can never add to a count.
    expect(y.logged).toBe(3);
  });
});

describe("monthLabels", () => {
  it("labels a column only when the month changes", () => {
    const y = pixelYear("2026-08-24", "2026-09-13", {});
    const labels = monthLabels(y.weeks);
    expect(labels[0]).toBe("2026-08");
    expect(labels.filter(Boolean)).toEqual(["2026-08", "2026-09"]);
  });
});
