import { describe, expect, it } from "vitest";
import {
  FIRST,
  goalOn,
  goalSpans,
  parseGoalHistory,
  recordGoal,
  sameGoal,
} from "../lib/goalHistory";
import type { Goal } from "../lib/trackers";

/**
 * A promise kept must survive the making of a harder one.
 *
 * The bug this exists to prevent, in the owner's words: "if I set this week
 * editing daily 2 hours, then next week 5 hours, the previous target record
 * should stay the same." Before this, the goal was one mutable number — raise
 * it and every past day was silently re-judged at the new target, so a week
 * you actually kept became a week you failed. An app that punishes ambition
 * teaches you not to raise the bar.
 */

const g = (target: number, period: "day" | "week" = "day"): Goal => ({
  target,
  period,
  direction: "min",
});

describe("goalOn", () => {
  it("uses the current goal when nothing has ever changed", () => {
    expect(goalOn(null, "2026-08-14", g(120))).toEqual(g(120));
    expect(goalOn([], "2026-08-14", g(120))).toEqual(g(120));
  });

  it("judges each day at the goal that was in force on it", () => {
    const history = [
      { from: FIRST, goal: g(120) }, // 2 hours
      { from: "2026-09-08", goal: g(300) }, // 5 hours, from the 8th
    ];
    expect(goalOn(history, "2026-09-07", g(300))).toEqual(g(120));
    expect(goalOn(history, "2026-09-08", g(300))).toEqual(g(300));
    expect(goalOn(history, "2026-09-30", g(300))).toEqual(g(300));
  });

  it("reaches the oldest promise backwards, before any change was recorded", () => {
    // The first entry is written at the moment of the first change and holds
    // the goal that came *before* it — so it governs everything earlier.
    const history = [{ from: "2026-09-08", goal: g(120) }, { from: "2026-09-15", goal: g(300) }];
    expect(goalOn(history, "2024-01-01", g(300))).toEqual(g(120));
  });

  it("treats a stretch with no goal as a real answer, not a missing one", () => {
    const history = [
      { from: FIRST, goal: g(120) },
      { from: "2026-09-08", goal: null },
      { from: "2026-09-20", goal: g(300) },
    ];
    expect(goalOn(history, "2026-09-10", g(300))).toBeNull();
    expect(goalOn(history, "2026-09-21", g(300))).toEqual(g(300));
  });
});

describe("recordGoal", () => {
  it("says nothing when the goal did not change", () => {
    // A PATCH fires on a rename or a colour too; only a changed promise
    // should leave a mark.
    expect(recordGoal(null, g(120), g(120), "2026-09-08")).toBeNull();
    expect(recordGoal(null, null, null, "2026-09-08")).toBeNull();
  });

  it("captures the old promise alongside the new one", () => {
    const out = recordGoal(null, g(120), g(300), "2026-09-08");
    expect(out).toEqual([
      { from: FIRST, goal: g(120) },
      { from: "2026-09-08", goal: g(300) },
    ]);
  });

  it("keeps every promise as they stack up", () => {
    const one = recordGoal(null, g(120), g(300), "2026-09-08")!;
    const two = recordGoal(one, g(300), g(420), "2026-09-15")!;
    expect(two.map((p) => p.from)).toEqual([FIRST, "2026-09-08", "2026-09-15"]);
    expect(goalOn(two, "2026-09-01", g(420))).toEqual(g(120));
    expect(goalOn(two, "2026-09-10", g(420))).toEqual(g(300));
    expect(goalOn(two, "2026-09-20", g(420))).toEqual(g(420));
  });

  it("collapses two changes made on the same day into one promise", () => {
    // Changing your mind at 9am and again at 11am is one promise made today,
    // not two — and two would put a zero-length span on the page.
    const one = recordGoal(null, g(120), g(300), "2026-09-08")!;
    const two = recordGoal(one, g(300), g(420), "2026-09-08")!;
    expect(two).toEqual([
      { from: FIRST, goal: g(120) },
      { from: "2026-09-08", goal: g(420) },
    ]);
  });

  it("drops a change that lands back where it started", () => {
    const one = recordGoal(null, g(120), g(300), "2026-09-08")!;
    const two = recordGoal(one, g(300), g(120), "2026-09-15")!;
    // Back to 2 hours: the middle span stays (it really happened), but no
    // two neighbours may hold the same promise.
    expect(two).toEqual([
      { from: FIRST, goal: g(120) },
      { from: "2026-09-08", goal: g(300) },
      { from: "2026-09-15", goal: g(120) },
    ]);
  });

  it("records dropping a goal, and picking one back up", () => {
    const off = recordGoal(null, g(120), null, "2026-09-08")!;
    expect(off[1]).toEqual({ from: "2026-09-08", goal: null });
    const on = recordGoal(off, null, g(300), "2026-09-20")!;
    expect(on).toHaveLength(3);
    expect(goalOn(on, "2026-09-10", g(300))).toBeNull();
  });
});

describe("goalSpans", () => {
  it("closes each span the day before the next one opens", () => {
    const history = [
      { from: FIRST, goal: g(120) },
      { from: "2026-09-08", goal: g(300) },
    ];
    expect(goalSpans(history, g(300))).toEqual([
      { goal: g(120), from: FIRST, to: "2026-09-07" },
      { goal: g(300), from: "2026-09-08", to: null },
    ]);
  });

  it("gives a never-changed tracker one open span", () => {
    expect(goalSpans(null, g(120))).toEqual([
      { goal: g(120), from: FIRST, to: null },
    ]);
  });

  it("survives a document whose entries are out of order", () => {
    const spans = goalSpans(
      [
        { from: "2026-09-08", goal: g(300) },
        { from: FIRST, goal: g(120) },
      ],
      g(300)
    );
    expect(spans.map((s) => s.from)).toEqual([FIRST, "2026-09-08"]);
    expect(spans[0].to).toBe("2026-09-07");
  });
});

describe("parseGoalHistory", () => {
  it("accepts what the route writes", () => {
    expect(
      parseGoalHistory([
        { from: "2026-09-08", goal: { target: 300, period: "day", direction: "min" } },
      ])
    ).toEqual([{ from: "2026-09-08", goal: g(300) }]);
  });

  it("keeps a null goal, which is a real stretch of having none", () => {
    expect(parseGoalHistory([{ from: "2026-09-08", goal: null }])).toEqual([
      { from: "2026-09-08", goal: null },
    ]);
  });

  it("refuses anything malformed rather than half-reading it", () => {
    // Falling back to "no history" is safe: the tracker is judged at its
    // current goal, which is exactly the old behaviour.
    expect(parseGoalHistory(null)).toBeNull();
    expect(parseGoalHistory([])).toBeNull();
    expect(parseGoalHistory("nope")).toBeNull();
    expect(parseGoalHistory([{ from: "8 Sept", goal: null }])).toBeNull();
    expect(parseGoalHistory([{ goal: null }])).toBeNull();
    expect(
      parseGoalHistory([{ from: "2026-09-08", goal: { target: 0 } }])
    ).toBeNull();
  });
});

describe("sameGoal", () => {
  it("compares the promise, not the object", () => {
    expect(
      sameGoal(g(120), { target: 120, period: "day", direction: "min" })
    ).toBe(true);
    expect(sameGoal(g(120), g(121))).toBe(false);
    expect(sameGoal(g(120), g(120, "week"))).toBe(false);
    expect(sameGoal(null, null)).toBe(true);
    expect(sameGoal(null, g(120))).toBe(false);
  });
});
