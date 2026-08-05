import { describe, expect, it } from "vitest";
import {
  clockToMinutes,
  nightLabel,
  nightToClock,
  shiftLabel,
  toNight,
} from "../lib/clock";

describe("clockToMinutes", () => {
  it("parses HH:MM", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("23:59")).toBe(23 * 60 + 59);
    expect(clockToMinutes("7:30")).toBe(450);
  });

  it("rejects everything that isn't a clock time", () => {
    expect(clockToMinutes("24:00")).toBeNull();
    expect(clockToMinutes("12:60")).toBeNull();
    expect(clockToMinutes("noon")).toBeNull();
    expect(clockToMinutes("")).toBeNull();
    expect(clockToMinutes(null)).toBeNull();
    expect(clockToMinutes(1230)).toBeNull();
  });
});

describe("toNight — the night axis", () => {
  it("puts an evening bedtime and the next morning in order", () => {
    // The README's own example: 23:00 → 300, 00:30 → 390, 07:00 → 780.
    expect(toNight("23:00")).toBe(300);
    expect(toNight("00:30")).toBe(390);
    expect(toNight("07:00")).toBe(780);
  });

  it("makes near-midnight bedtimes forty minutes apart, not 1400", () => {
    const a = toNight("23:40")!;
    const b = toNight("00:20")!;
    expect(Math.abs(b - a)).toBe(40);
    // ...and their average is a sane bedtime, not lunchtime.
    const avg = (a + b) / 2;
    expect(nightLabel(avg)).toBe("12:00 am");
  });

  it("round-trips through nightToClock", () => {
    for (const t of ["18:00", "23:15", "00:00", "03:30", "17:59"]) {
      const [h, m] = t.split(":").map(Number);
      expect(nightToClock(toNight(t)!)).toBe(h * 60 + m);
    }
  });
});

describe("shiftLabel", () => {
  it("calls under five minutes the same", () => {
    expect(shiftLabel(300, 304)).toBe("about the same");
    expect(shiftLabel(300, 296)).toBe("about the same");
  });

  it("says earlier when the new bedtime is smaller on the axis", () => {
    expect(shiftLabel(300 - 22, 300)).toBe("22 min earlier");
    expect(shiftLabel(300 + 30, 300)).toBe("30 min later");
  });

  it("speaks in hours past sixty minutes", () => {
    expect(shiftLabel(300 + 90, 300)).toBe("1h 30m later");
    expect(shiftLabel(300 - 120, 300)).toBe("2h earlier");
  });
});
