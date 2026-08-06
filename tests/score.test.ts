import { describe, expect, it } from "vitest";
import { dayFactsFrom, dayScore, sleepCredit } from "../lib/score";
import type { Tracker } from "../lib/trackers";

const t = (over: Partial<Tracker> & { id: string }): Tracker => ({
  name: over.id,
  type: "duration",
  unit: "min",
  color: "#2a78d6",
  category: "study",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

describe("sleepCredit", () => {
  it("gives full credit inside 7-9h and slides outside", () => {
    expect(sleepCredit(7 * 60)).toBe(1);
    expect(sleepCredit(8 * 60)).toBe(1);
    expect(sleepCredit(9 * 60)).toBe(1);
    expect(sleepCredit(210)).toBeCloseTo(0.5); // 3h30m — half of 7h
    expect(sleepCredit(11 * 60)).toBeCloseTo(0.5); // 2h past the band
    expect(sleepCredit(0)).toBe(0);
  });
});

describe("dayScore", () => {
  it("is null on a blank day", () => {
    expect(
      dayScore({ goalsMet: 0, goalsTotal: 2, logged: 0, trackers: 3, sleep: null, clean: 0, cleanTotal: 1 })
    ).toBeNull();
  });

  it("scores a perfect day 100", () => {
    expect(
      dayScore({ goalsMet: 3, goalsTotal: 3, logged: 5, trackers: 5, sleep: 480, clean: 2, cleanTotal: 2 })
    ).toBe(100);
  });

  it("redistributes weight when a component doesn't apply", () => {
    // No goals, no sleep, no streaks — showing up is the whole score.
    expect(
      dayScore({ goalsMet: 0, goalsTotal: 0, logged: 2, trackers: 4, sleep: null, clean: 0, cleanTotal: 0 })
    ).toBe(50);
  });

  it("weighs goals heaviest", () => {
    // Everything perfect except goals at 0: loses the 50% goal weight.
    expect(
      dayScore({ goalsMet: 0, goalsTotal: 2, logged: 4, trackers: 4, sleep: 480, clean: 1, cleanTotal: 1 })
    ).toBe(50);
  });
});

describe("dayFactsFrom", () => {
  const trackers = [
    t({ id: "study", goal: { target: 120, period: "day", direction: "min" } }),
    t({ id: "sleep", type: "sleep" }),
    t({ id: "nofap", type: "streak" }),
    t({ id: "junk", type: "count", habit: "bad" }),
    t({ id: "old", archived: true }),
  ];

  it("reads a good day correctly", () => {
    const values = { study: 150, sleep: 470, nofap: 1 };
    const f = dayFactsFrom(trackers, values, new Set(Object.keys(values)));
    expect(f).toEqual({
      goalsMet: 1,
      goalsTotal: 1,
      logged: 3,
      trackers: 4, // archived excluded
      sleep: 470,
      clean: 2, // streak clean + bad habit untouched
      cleanTotal: 2,
    });
  });

  it("counts a slip and a bad-habit day against clean", () => {
    const values = { nofap: 0, junk: 3 }; // slipped, and junk food happened
    const f = dayFactsFrom(trackers, values, new Set(Object.keys(values)));
    expect(f.clean).toBe(0);
    expect(f.cleanTotal).toBe(2);
    // An unmet at-least goal on an unlogged tracker counts as missed.
    expect(f.goalsMet).toBe(0);
    expect(f.goalsTotal).toBe(1);
  });

  it("doesn't break a streak on an unlogged day", () => {
    const f = dayFactsFrom(trackers, { study: 60 }, new Set(["study"]));
    expect(f.clean).toBe(2);
  });
});
