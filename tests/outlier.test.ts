import { describe, expect, it } from "vitest";
import {
  MIN_HISTORY,
  buildBaselines,
  oddValue,
  type Baseline,
} from "../lib/outlier";
import type { RecentEntry } from "../lib/prefill";
import type { Tracker, TrackerType } from "../lib/trackers";

const tracker = (over: Partial<Tracker> = {}): Tracker => ({
  id: "t1",
  name: "Study",
  type: "duration" as TrackerType,
  unit: "",
  color: "1",
  category: "learning",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

/** `values.length` days of history for one tracker, newest last. */
function rows(values: number[], trackerId = "t1"): RecentEntry[] {
  return values.map((value, i) => ({
    trackerId,
    date: `2026-08-${String(10 + i).padStart(2, "0")}`,
    value,
    meta: null,
  }));
}

const base = (over: Partial<Baseline> = {}): Baseline => ({
  usual: 90,
  best: 120,
  days: 6,
  ...over,
});

describe("buildBaselines — what an ordinary day looks like", () => {
  it("takes the median, so one huge day cannot move the bar", () => {
    const b = buildBaselines([tracker()], rows([60, 90, 90, 100, 600]));
    expect(b.t1.usual).toBe(90);
    expect(b.t1.best).toBe(600);
    expect(b.t1.days).toBe(5);
  });

  it("says nothing at all until there is enough history", () => {
    const thin = buildBaselines([tracker()], rows(Array(MIN_HISTORY - 1).fill(90)));
    expect(thin.t1).toBeUndefined();
  });

  it("ignores zeroes — a day that happened is not a level", () => {
    const b = buildBaselines([tracker()], rows([0, 0, 60, 60, 60, 60]));
    expect(b.t1.usual).toBe(60);
    expect(b.t1.days).toBe(4);
  });

  it("leaves the bounded kinds alone", () => {
    for (const type of ["check", "streak", "scale", "prayer", "sleep"] as TrackerType[]) {
      const b = buildBaselines([tracker({ type })], rows([1, 1, 1, 1, 1, 1]));
      expect(b.t1, type).toBeUndefined();
    }
  });
});

describe("oddValue — the question, not the refusal", () => {
  it("asks about a slipped decimal point", () => {
    // 1h 40m typed as 14h.
    const odd = oddValue(tracker(), 840, base({ usual: 100, best: 140 }));
    expect(odd).toEqual({ direction: "high", usual: "1h 40m", times: 8 });
  });

  it("stays quiet on a good day that the week already knows about", () => {
    // Four times the usual, but the window holds a 9h Saturday already.
    expect(oddValue(tracker(), 540, base({ usual: 120, best: 540 }))).toBeNull();
  });

  it("stays quiet on an ordinary day", () => {
    expect(oddValue(tracker(), 150, base({ usual: 90, best: 120 }))).toBeNull();
  });

  it("needs both tests to agree", () => {
    // Way past the best day, but nowhere near four times the usual.
    expect(oddValue(tracker(), 260, base({ usual: 90, best: 100 }))).toBeNull();
  });

  it("never speaks without history", () => {
    expect(oddValue(tracker(), 840, undefined)).toBeNull();
    expect(oddValue(tracker(), 840, base({ days: MIN_HISTORY - 1 }))).toBeNull();
  });

  it("reads a measurement in both directions", () => {
    const kg = tracker({ type: "measure" as TrackerType, unit: "kg" });
    // 75 kg typed as 750, and as 7.5.
    expect(oddValue(kg, 750, base({ usual: 75, best: 77 }))?.direction).toBe("high");
    expect(oddValue(kg, 7.5, base({ usual: 75, best: 77 }))?.direction).toBe("low");
    // ...and says nothing about a real week of losing weight.
    expect(oddValue(kg, 73, base({ usual: 75, best: 77 }))).toBeNull();
  });

  it("only questions the high side of a duration — a short day is just short", () => {
    expect(oddValue(tracker(), 5, base({ usual: 300, best: 400 }))).toBeNull();
  });

  it("has nothing to say about an empty row", () => {
    expect(oddValue(tracker(), 0, base())).toBeNull();
  });
});
