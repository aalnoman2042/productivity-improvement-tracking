import { describe, expect, it } from "vitest";
import {
  formatMoney,
  parseTimeValue,
  spendLine,
  timeSpend,
  type SpendTracker,
} from "../lib/timeValue";

const VALUE = { perMinute: 5, currency: "৳" };

const TRACKERS: SpendTracker[] = [
  { id: "study", name: "Self study", color: "#111111", type: "duration", habit: "good" },
  { id: "scroll", name: "Screen time", color: "#222222", type: "duration", habit: "bad" },
  { id: "sleep", name: "Sleep", color: "#333333", type: "sleep", habit: "good" },
  { id: "water", name: "Water", color: "#444444", type: "count", habit: "good" },
];

const WINDOW = { from: "2026-08-19", to: "2026-08-25", days: 7 };

const spend = (entries: { trackerId: string; value: number }[], value = VALUE) =>
  timeSpend({ trackers: TRACKERS, entries, ...WINDOW, value });

describe("parseTimeValue", () => {
  it("takes a price and a currency", () => {
    expect(parseTimeValue({ perMinute: 2.5, currency: "৳" })).toEqual({
      perMinute: 2.5,
      currency: "৳",
    });
  });

  it("refuses anything that isn't a price", () => {
    expect(parseTimeValue(null)).toBeNull();
    expect(parseTimeValue({ perMinute: 0 })).toBeNull();
    expect(parseTimeValue({ perMinute: -3 })).toBeNull();
    expect(parseTimeValue({ perMinute: "lots" })).toBeNull();
    // An hour worth six hundred thousand is a typo, not a wage.
    expect(parseTimeValue({ perMinute: 99_999 })).toBeNull();
  });

  it("falls back to a plain currency rather than refusing the price", () => {
    expect(parseTimeValue({ perMinute: 1 })?.currency).toBe("$");
  });
});

describe("formatMoney", () => {
  it("keeps a decimal while the number is small, and drops it when it isn't", () => {
    expect(formatMoney(12.34, "৳")).toBe("৳12.3");
    expect(formatMoney(1234.56, "৳")).toBe("৳1,235");
  });
});

describe("timeSpend", () => {
  it("prices every tracked minute, sleep included", () => {
    const s = spend([
      { trackerId: "study", value: 120 },
      { trackerId: "scroll", value: 180 },
      { trackerId: "sleep", value: 420 },
    ]);
    expect(s.tracked.minutes).toBe(720);
    expect(s.tracked.cost).toBe(3600);
  });

  it("splits what was burned from what was invested, by the habit flag", () => {
    const s = spend([
      { trackerId: "study", value: 120 },
      { trackerId: "scroll", value: 180 },
    ]);
    expect(s.burned.minutes).toBe(180);
    expect(s.burned.cost).toBe(900);
    expect(s.invested.minutes).toBe(120);
    expect(s.invested.cost).toBe(600);
  });

  it("puts sleep in neither column — it is not an hour you chose over another", () => {
    const s = spend([{ trackerId: "sleep", value: 420 }]);
    expect(s.slept.minutes).toBe(420);
    expect(s.burned.minutes).toBe(0);
    expect(s.invested.minutes).toBe(0);
    expect(s.tracked.minutes).toBe(420);
  });

  it("ignores what cannot be measured in hours", () => {
    const s = spend([{ trackerId: "water", value: 8 }]);
    expect(s.tracked.minutes).toBe(0);
  });

  it("adds a tracker's days together and ranks the biggest first", () => {
    const s = spend([
      { trackerId: "scroll", value: 60 },
      { trackerId: "scroll", value: 90 },
      { trackerId: "study", value: 30 },
    ]);
    expect(s.burned.rows).toHaveLength(1);
    expect(s.burned.rows[0].minutes).toBe(150);
    expect(s.tracked.rows[0].name).toBe("Screen time");
  });

  it("projects a year from the pace of the window, not from a wish", () => {
    // 7 hours over 7 days is an hour a day; a year of that is 365 hours.
    const s = spend([{ trackerId: "scroll", value: 420 }]);
    expect(s.perDay).toBe(60);
    expect(s.perYear.minutes).toBe(365 * 60);
    expect(s.perYear.cost).toBe(365 * 60 * 5);
  });

  it("measures the share against waking hours, once sleep is known", () => {
    const s = spend([
      { trackerId: "scroll", value: 480 },
      { trackerId: "sleep", value: 420 * 7 },
    ]);
    // 7 days = 10,080 minutes, less 2,940 asleep = 7,140 awake.
    expect(s.wakingShare).toBeCloseTo(480 / 7140, 5);
  });

  it("says nothing about the share when sleep was never tracked", () => {
    // The alternative is to assume eight hours a night, and an invented
    // denominator makes an invented percentage.
    expect(spend([{ trackerId: "scroll", value: 480 }]).wakingShare).toBeNull();
  });

  it("survives an empty window", () => {
    const s = spend([]);
    expect(s.tracked.minutes).toBe(0);
    expect(s.perYear.cost).toBe(0);
    expect(s.wakingShare).toBeNull();
  });
});

describe("spendLine", () => {
  it("states the cost and what a year of it comes to", () => {
    const line = spendLine(spend([{ trackerId: "scroll", value: 420 }]), "৳");
    expect(line).toContain("7h");
    expect(line).toContain("৳2,100");
    expect(line).toContain("a year costs");
  });

  it("never scolds", () => {
    const line = spendLine(spend([{ trackerId: "scroll", value: 600 }]), "৳");
    for (const word of ["wasted", "lost", "should", "failed", "shame"]) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });

  it("credits the good hours when nothing was burned", () => {
    const line = spendLine(spend([{ trackerId: "study", value: 300 }]), "৳");
    expect(line).toContain("what you're building");
  });

  it("says how to make it work when no habit is marked bad", () => {
    expect(spendLine(spend([]), "৳")).toContain("mark a tracker as a bad habit");
  });
});

/**
 * A rate needs enough days to be a rate.
 *
 * Periods are calendar units, so on the 1st of a month the window is one
 * partly-lived day — and 45 minutes before lunch multiplied by 365 is
 * arithmetic, not information. Found by the pre-deploy review, which is
 * exactly the class of bug a rolling 7/15/30-day window could never have.
 */
describe("spendLine on a very short window", () => {
  const value = { perMinute: 5, currency: "৳" };
  const spendFor = (days: number) =>
    timeSpend({
      trackers: [
        { id: "scroll", name: "Scrolling", color: "#111", type: "duration", habit: "bad" },
      ],
      entries: [{ trackerId: "scroll", value: 45 }],
      from: "2026-08-31",
      to: "2026-08-31",
      days,
      value,
    });

  it("keeps quiet about a yearly rate on day one of a unit", () => {
    const line = spendLine(spendFor(1), "৳");
    expect(line).toContain("45m went to habits");
    expect(line).not.toContain("a year costs");
  });

  it("says it once the window is long enough to mean it", () => {
    expect(spendLine(spendFor(30), "৳")).toContain("a year costs");
  });
});
