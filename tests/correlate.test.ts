import { describe, expect, it } from "vitest";
import {
  MIN_DAYS,
  enoughData,
  findCorrelations,
  mean,
  median,
  pearson,
  type Series,
} from "../lib/correlate";
import type { Tracker } from "../lib/trackers";

/* --------------------------------- kit --------------------------------- */

function tracker(over: Partial<Tracker> & { name: string }): Tracker {
  return {
    id: over.name,
    type: "count",
    unit: "",
    color: "#3366aa",
    category: "life",
    goal: null,
    habit: "good",
    archived: false,
    order: 0,
    ...over,
  } as Tracker;
}

/** Sequential dates from July 1st — long enough for any window here. */
function dated(values: number[]): Map<string, number> {
  const m = new Map<string, number>();
  values.forEach((v, i) => {
    const d = new Date(Date.UTC(2026, 6, 1 + i));
    m.set(d.toISOString().slice(0, 10), v);
  });
  return m;
}

function series(t: Tracker, values: number[]): Series {
  return { tracker: t, byDate: dated(values) };
}

const NO_BEDS = new Map<string, number>();

/** 20 alternating days — a strong, clean association with a big gap. */
const HI_LO = [1, 5, 1, 5, 1, 5, 1, 5, 1, 5, 1, 5, 1, 5, 1, 5, 1, 5, 1, 5];
const FOLLOWS = HI_LO.map((v) => v * 30); // 30 vs 150 with the driver
const OPPOSES = HI_LO.map((v) => (v === 1 ? 150 : 30)); // high when driver is low

/* ------------------------------ statistics ----------------------------- */

describe("statistics", () => {
  it("mean and median behave on the edges", () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(median([1, 3, 100])).toBe(3);
    expect(median([1, 3])).toBe(2);
  });

  it("pearson sees direction and refuses flat series", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });
});

/* ---------------------------- habit awareness --------------------------- */

describe("good/bad habit awareness", () => {
  it("an outcome rising with the driver is good — for a good habit", () => {
    const study = series(tracker({ name: "Study", type: "duration", unit: "min" }), HI_LO.map((v) => v * 30));
    const reading = series(tracker({ name: "Reading", type: "count", unit: "pages" }), FOLLOWS);
    const [f] = findCorrelations({ series: [study, reading], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.tone).toBe("good");
  });

  it("the same rise is bad when the outcome is a bad habit", () => {
    const study = series(tracker({ name: "Study", type: "duration", unit: "min" }), HI_LO.map((v) => v * 30));
    const junk = series(tracker({ name: "Junk food", type: "count", unit: "pcs", habit: "bad" }), FOLLOWS);
    const [f] = findCorrelations({ series: [study, junk], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.tone).toBe("bad");
  });

  it("and a bad habit falling as the driver rises is good", () => {
    const study = series(tracker({ name: "Study", type: "duration", unit: "min" }), HI_LO.map((v) => v * 30));
    const junk = series(tracker({ name: "Junk food", type: "count", unit: "pcs", habit: "bad" }), OPPOSES);
    const [f] = findCorrelations({ series: [study, junk], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.tone).toBe("good");
  });

  it("a clean streak counts clean days, so more is good even on a bad habit", () => {
    const sleep = series(tracker({ name: "Sleep", type: "sleep", unit: "min" }), HI_LO.map((v) => v * 90));
    const clean = series(
      tracker({ name: "No smoking", type: "streak", habit: "bad" }),
      HI_LO.map((v) => (v === 5 ? 1 : 0))
    );
    const [f] = findCorrelations({ series: [sleep, clean], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.tone).toBe("good");
  });
});

/* ---------------------------- yes/no trackers --------------------------- */

describe("yes/no trackers in pairs", () => {
  it("a check tracker can drive, split on did-vs-didn't", () => {
    const gym = series(tracker({ name: "Gym", type: "check" }), HI_LO.map((v) => (v === 5 ? 1 : 0)));
    const energy = series(tracker({ name: "Energy", type: "scale", unit: "/5" }), HI_LO.map((v) => (v === 5 ? 4 : 2)));
    const [f] = findCorrelations({ series: [gym, energy], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.title).toContain("days you do Gym");
    expect(f.detail).toContain("On days you did Gym");
  });

  it("a streak tracker speaks in clean days and slip days", () => {
    const clean = series(tracker({ name: "No junk", type: "streak" }), HI_LO.map((v) => (v === 5 ? 1 : 0)));
    const mood = series(tracker({ name: "Mood", type: "scale", unit: "/5" }), HI_LO.map((v) => (v === 5 ? 4 : 2)));
    const [f] = findCorrelations({ series: [clean, mood], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.title).toContain("clean No junk days");
    expect(f.detail).toContain("slip days");
  });

  it("a yes/no outcome is reported as a share of days, never as 'Done'", () => {
    const sleep = series(tracker({ name: "Sleep", type: "sleep", unit: "min" }), HI_LO.map((v) => v * 90));
    const gym = series(tracker({ name: "Gym", type: "check" }), HI_LO.map((v) => (v === 5 ? 1 : 0)));
    const [f] = findCorrelations({ series: [sleep, gym], bedByDate: NO_BEDS });
    expect(f).toBeDefined();
    expect(f.detail).toMatch(/\d+%/);
    expect(f.detail).not.toContain("Done");
  });
});

/* ------------------------------- ranking ------------------------------- */

describe("impact ranking", () => {
  it("every finding carries an impact score", () => {
    const study = series(tracker({ name: "Study", type: "duration", unit: "min" }), HI_LO.map((v) => v * 30));
    const reading = series(tracker({ name: "Reading", type: "count", unit: "pages" }), FOLLOWS);
    const found = findCorrelations({ series: [study, reading], bedByDate: NO_BEDS });
    for (const f of found) {
      expect(f.impact).toBeGreaterThan(0);
      expect(f.impact).toBeLessThanOrEqual(1);
    }
  });

  it("returns findings sorted by impact, not raw correlation", () => {
    // Both pairs correlate near-perfectly; only the second's gap is worth
    // acting on. Impact must put the big gap first.
    const a = series(tracker({ name: "A", type: "count" }), HI_LO.map((v) => v * 30));
    const b = series(tracker({ name: "B", type: "count" }), HI_LO.map((v) => (v === 5 ? 100 : 80))); // 20% gap
    const d = series(tracker({ name: "D", type: "count" }), HI_LO.map((v) => (v === 5 ? 100 : 20))); // 80% gap
    const found = findCorrelations({ series: [a, b, d], bedByDate: NO_BEDS });
    const impacts = found.map((f) => f.impact);
    expect([...impacts].sort((x, y) => y - x)).toEqual(impacts);
    const smallGap = found.find((f) => f.kind === "pair" && f.detail.includes("B averaged"));
    const bigGap = found.find((f) => f.kind === "pair" && f.detail.includes("D averaged"));
    expect(bigGap).toBeDefined();
    expect(smallGap).toBeDefined();
    expect(bigGap!.impact).toBeGreaterThan(smallGap!.impact);
  });
});

/* ------------------------------- weekdays ------------------------------- */

describe("weekday findings", () => {
  it("a bad habit's spike day is called out as bad", () => {
    // 28 days, doubled every Friday. 2026-07-03 is a Friday.
    const values = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      return d.getUTCDay() === 5 ? 8 : 2;
    });
    const junk = series(tracker({ name: "Junk food", type: "count", habit: "bad" }), values);
    const found = findCorrelations({ series: [junk], bedByDate: NO_BEDS });
    const wd = found.find((f) => f.kind === "weekday");
    expect(wd).toBeDefined();
    expect(wd!.title).toBe("Fridays are when Junk food creeps up");
    expect(wd!.tone).toBe("bad");
  });

  it("a good tracker's low day stays neutral — it might just be the weekend", () => {
    const values = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      return d.getUTCDay() === 5 ? 30 : 120;
    });
    const study = series(tracker({ name: "Study", type: "duration", unit: "min" }), values);
    const found = findCorrelations({ series: [study], bedByDate: NO_BEDS });
    const wd = found.find((f) => f.kind === "weekday");
    expect(wd).toBeDefined();
    expect(wd!.tone).toBe("neutral");
  });
});

/* ------------------------------ thresholds ------------------------------ */

describe("restraint", () => {
  it("says nothing on too few days", () => {
    const a = series(tracker({ name: "A" }), HI_LO.slice(0, MIN_DAYS - 2));
    const b = series(tracker({ name: "B" }), FOLLOWS.slice(0, MIN_DAYS - 2));
    expect(findCorrelations({ series: [a, b], bedByDate: NO_BEDS })).toEqual([]);
    expect(enoughData([a, b])).toBe(false);
  });

  it("says nothing about noise", () => {
    // Same days, no relationship: the outcome repeats a 4-cycle against the
    // driver's 2-cycle, so the halves average out identical.
    const a = series(tracker({ name: "A" }), HI_LO);
    const b = series(tracker({ name: "B" }), HI_LO.map((_, i) => [10, 90, 90, 10][i % 4]));
    const found = findCorrelations({ series: [a, b], bedByDate: NO_BEDS });
    expect(found.filter((f) => f.kind === "pair")).toEqual([]);
  });
});
