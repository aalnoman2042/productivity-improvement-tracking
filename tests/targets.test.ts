import { describe, expect, it } from "vitest";
import { parseTarget, targetProgress, type Target } from "../lib/targets";

const TODAY = "2026-08-25";

const total = (over: Partial<Target> = {}): Target => ({
  kind: "total",
  value: 100,
  by: "2026-09-30",
  from: "2026-08-16",
  ...over,
});

const level = (over: Partial<Target> = {}): Target => ({
  kind: "level",
  value: 70,
  by: "2026-12-01",
  from: "2026-08-16",
  ...over,
});

/** Ten days of the same number, ending today. */
function daily(value: number, from = "2026-08-16", to = TODAY) {
  const out: { date: string; value: number }[] = [];
  for (let d = from; d <= to; ) {
    out.push({ date: d, value });
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

describe("targetProgress — adding up to something", () => {
  it("sums what is on record inside the window", () => {
    const p = targetProgress(total(), daily(5), TODAY);
    // Ten days at 5 = 50 of the 100.
    expect(p.current).toBe(50);
    expect(p.remaining).toBe(50);
    expect(p.pct).toBe(50);
  });

  it("ignores anything before the target was set", () => {
    const points = [{ date: "2026-08-01", value: 999 }, ...daily(5)];
    expect(targetProgress(total(), points, TODAY).current).toBe(50);
  });

  it("projects the arrival at the pace so far", () => {
    const p = targetProgress(total(), daily(5), TODAY);
    // 5 a day, 50 to go — ten more days.
    expect(p.pace).toBe(5);
    expect(p.projected).toBe("2026-09-04");
    expect(p.onTrack).toBe(true);
  });

  it("says what each remaining day has to carry", () => {
    const p = targetProgress(total(), daily(5), TODAY);
    // 50 left over the 36 days from today to the deadline, today included.
    expect(p.needPerDay).toBeCloseTo(50 / 37, 5);
  });

  it("refuses to project when nothing has moved", () => {
    const p = targetProgress(total(), [], TODAY);
    expect(p.current).toBe(0);
    expect(p.pace).toBeNull();
    expect(p.projected).toBeNull();
    expect(p.onTrack).toBeNull();
  });

  it("knows when it has been reached", () => {
    const p = targetProgress(total({ value: 20 }), daily(5), TODAY);
    expect(p.done).toBe(true);
    expect(p.remaining).toBe(0);
    expect(p.pct).toBe(100);
    expect(p.onTrack).toBe(true);
  });

  it("marks a deadline that has passed", () => {
    const p = targetProgress(total({ by: "2026-08-20" }), daily(5), TODAY);
    expect(p.over).toBe(true);
    expect(p.daysLeft).toBeLessThan(0);
    expect(p.needPerDay).toBeNull();
  });
});

describe("targetProgress — getting to a level", () => {
  const falling = [
    { date: "2026-08-16", value: 80 },
    { date: "2026-08-20", value: 78 },
    { date: "2026-08-25", value: 76 },
  ];

  it("reads the latest number, and which way it is going", () => {
    const p = targetProgress(level(), falling, TODAY);
    expect(p.current).toBe(76);
    expect(p.start).toBe(80);
    expect(p.remaining).toBe(6);
  });

  it("measures progress against the distance it set out to cover", () => {
    // 4 of the 10 kg between 80 and 70.
    expect(targetProgress(level(), falling, TODAY).pct).toBe(40);
  });

  it("projects a date from the movement towards the target", () => {
    const p = targetProgress(level(), falling, TODAY);
    expect(p.pace).toBeCloseTo(4 / 10, 5);
    expect(p.projected).toBe("2026-09-09");
    expect(p.onTrack).toBe(true);
  });

  it("gives no date at all when it is moving the wrong way", () => {
    const rising = [
      { date: "2026-08-16", value: 80 },
      { date: "2026-08-25", value: 82 },
    ];
    const p = targetProgress(level(), rising, TODAY);
    expect(p.pace).toBeNull();
    expect(p.projected).toBeNull();
    expect(p.onTrack).toBeNull();
    expect(p.pct).toBe(0);
  });

  it("works upwards too, without being told", () => {
    const lifting = [
      { date: "2026-08-16", value: 60 },
      { date: "2026-08-25", value: 70 },
    ];
    const p = targetProgress(level({ value: 100 }), lifting, TODAY);
    expect(p.done).toBe(false);
    expect(p.remaining).toBe(30);
    expect(p.pct).toBe(25);
  });

  it("counts arriving from either side as arriving", () => {
    const there = [
      { date: "2026-08-16", value: 80 },
      { date: "2026-08-25", value: 69 },
    ];
    const p = targetProgress(level(), there, TODAY);
    expect(p.done).toBe(true);
    expect(p.pct).toBe(100);
  });

  it("has nothing to say with no readings at all", () => {
    const p = targetProgress(level(), [], TODAY);
    expect(p.done).toBe(false);
    expect(p.start).toBeNull();
    expect(p.projected).toBeNull();
  });
});

describe("parseTarget", () => {
  it("takes a well-formed target", () => {
    expect(parseTarget({ kind: "level", value: 70, by: "2026-12-01" })).toEqual({
      kind: "level",
      value: 70,
      by: "2026-12-01",
      from: null,
    });
  });

  it("defaults an unknown kind to adding up", () => {
    expect(parseTarget({ value: 20, by: "2026-12-31" })?.kind).toBe("total");
  });

  it("refuses anything that isn't one", () => {
    expect(parseTarget(null)).toBeNull();
    expect(parseTarget({ value: 10 })).toBeNull();
    expect(parseTarget({ value: 10, by: "December" })).toBeNull();
    expect(parseTarget({ value: -1, by: "2026-12-31" })).toBeNull();
  });
});
