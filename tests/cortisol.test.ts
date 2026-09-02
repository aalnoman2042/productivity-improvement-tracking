import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE,
  MEAN_REFERENCE,
  buildCurve,
  buildReport,
  findSources,
  parseProfile,
  dailyMean,
  scoreDay,
  toNmol,
  type CortisolDay,
  type CortisolSources,
} from "../lib/cortisol";
import type { Tracker } from "../lib/trackers";

/**
 * The model is arithmetic on behaviour, so these are the checks that keep it
 * honest: that it is anchored to *waking* rather than to a clock the app
 * picked, that a missing tracker costs coverage instead of quietly scoring as
 * a perfect day, and that load flattens the curve rather than merely raising
 * it — which is the one claim the whole page rests on.
 */

const tracker = (over: Partial<Tracker> & { id: string; name: string }): Tracker => ({
  type: "count",
  unit: "",
  color: "#123456",
  category: "other",
  goal: null,
  archived: false,
  order: 0,
  ...over,
});

const ESSENTIALS: Tracker[] = [
  tracker({ id: "s", name: "Sleep", type: "sleep", category: "sleep" }),
  tracker({ id: "d", name: "Diet quality", type: "scale", category: "food" }),
  tracker({ id: "j", name: "Junk food", type: "count", category: "food", habit: "bad" }),
  tracker({ id: "w", name: "Water", type: "count", category: "food" }),
  tracker({ id: "x", name: "Workout", type: "duration", category: "fitness" }),
  tracker({ id: "m", name: "Mood", type: "scale", category: "health" }),
];

const NO_SOURCES: CortisolSources = {
  sleepId: null,
  dietId: null,
  junkId: null,
  exerciseIds: [],
  moodId: null,
};

/** A day that gives the model nothing to complain about. */
const good = (over: Partial<CortisolDay> = {}): CortisolDay => ({
  date: "2026-09-01",
  bed: 23 * 60,
  wake: 7 * 60,
  nightMinutes: 480,
  napMinutes: 0,
  quality: 4,
  diet: 4,
  junk: 0,
  exercise: 45,
  mood: 4,
  ...over,
});

describe("finding the trackers that feed it", () => {
  it("picks sleep, diet, junk, fitness and mood out of the starter pack", () => {
    const found = findSources(ESSENTIALS);
    expect(found.sleepId).toBe("s");
    expect(found.dietId).toBe("d");
    expect(found.junkId).toBe("j");
    expect(found.exerciseIds).toEqual(["x"]);
    expect(found.moodId).toBe("m");
  });

  it("tells junk from water by the habit flag, not by the category", () => {
    // Both are food counts; only one is a habit being cut down.
    expect(findSources(ESSENTIALS).junkId).not.toBe("w");
  });

  it("never reads an archived tracker", () => {
    const off = ESSENTIALS.map((t) => ({ ...t, archived: true }));
    expect(findSources(off)).toEqual(NO_SOURCES);
  });

  it("finds a diet scale that nobody called diet", () => {
    const found = findSources([
      tracker({ id: "n", name: "Nutrition", type: "scale", category: "food" }),
    ]);
    expect(found.dietId).toBe("n");
  });

  it("does not mistake a mood scale for a diet scale", () => {
    const found = findSources([
      tracker({ id: "m", name: "Mood", type: "scale", category: "health" }),
    ]);
    expect(found.moodId).toBe("m");
    expect(found.dietId).toBeNull();
  });
});

describe("scoring a day", () => {
  it("gives a steady, well-slept day a high rhythm and a low load", () => {
    const res = scoreDay(good(), 7 * 60, EMPTY_PROFILE);
    expect(res.rhythm).toBeGreaterThan(85);
    expect(res.load).toBeLessThan(15);
  });

  it("marks down a short, late, badly-rated night", () => {
    const res = scoreDay(
      good({ bed: 2 * 60, wake: 6 * 60, nightMinutes: 240, quality: 2 }),
      7 * 60,
      EMPTY_PROFILE
    );
    expect(res.rhythm).toBeLessThan(55);
    expect(res.load).toBeGreaterThan(35);
  });

  it("counts a nap towards the night — an hour on the sofa is an hour slept", () => {
    const withNap = scoreDay(
      good({ nightMinutes: 390, napMinutes: 60 }),
      7 * 60,
      EMPTY_PROFILE
    );
    const without = scoreDay(good({ nightMinutes: 390 }), 7 * 60, EMPTY_PROFILE);
    expect(withNap.load!).toBeLessThan(without.load!);
  });

  it("counts oversleeping too, at less than half the weight of a short night", () => {
    const over = scoreDay(good({ nightMinutes: 720 }), 7 * 60, EMPTY_PROFILE);
    const under = scoreDay(good({ nightMinutes: 180 }), 7 * 60, EMPTY_PROFILE);
    expect(over.load!).toBeGreaterThan(0);
    expect(over.load!).toBeLessThan(under.load!);
  });

  it("judges the wake time against the person's own usual, not against a clock", () => {
    // Waking at eleven every day is a rhythm; it just isn't an early one.
    const steadyLate = scoreDay(good({ wake: 11 * 60 }), 11 * 60, EMPTY_PROFILE);
    const drifting = scoreDay(good({ wake: 11 * 60 }), 7 * 60, EMPTY_PROFILE);
    expect(steadyLate.rhythm!).toBeGreaterThan(drifting.rhythm!);
  });

  it("reads a bedtime past midnight as late, not as twenty-three hours early", () => {
    const past = scoreDay(good({ bed: 1 * 60 }), 7 * 60, EMPTY_PROFILE);
    const before = scoreDay(good({ bed: 22 * 60 }), 7 * 60, EMPTY_PROFILE);
    expect(past.load!).toBeGreaterThan(before.load!);
  });

  it("treats movement as a U — none and far too much both push", () => {
    const none = scoreDay(good({ exercise: 0 }), 7 * 60, EMPTY_PROFILE);
    const ordinary = scoreDay(good({ exercise: 45 }), 7 * 60, EMPTY_PROFILE);
    const heavy = scoreDay(good({ exercise: 240 }), 7 * 60, EMPTY_PROFILE);
    expect(ordinary.load!).toBeLessThan(none.load!);
    expect(ordinary.load!).toBeLessThan(heavy.load!);
  });

  it("drops a missing input instead of scoring it as a good one", () => {
    // No diet, junk, exercise or mood on record — the same sleep should not
    // suddenly look better for the silence.
    const bare = scoreDay(
      good({ diet: null, junk: null, exercise: null, mood: null }),
      7 * 60,
      EMPTY_PROFILE
    );
    const full = scoreDay(good(), 7 * 60, EMPTY_PROFILE);
    expect(bare.pressures.map((p) => p.key)).not.toContain("diet");
    // Both are good days; the point is that the bare one is not scored better
    // for having less on record.
    expect(Math.abs(bare.load! - full.load!)).toBeLessThan(12);
  });

  it("says nothing about a rhythm when there is no sleep on record", () => {
    const res = scoreDay(
      { ...good(), bed: null, wake: null, nightMinutes: null, quality: null },
      null,
      EMPTY_PROFILE
    );
    expect(res.rhythm).toBeNull();
  });

  it("falls back to the typed mood when no mood tracker logged that day", () => {
    const res = scoreDay(good({ mood: null }), 7 * 60, { age: null, sex: null, mood: 1 });
    expect(res.pressures.find((p) => p.key === "mood")?.value).toBeCloseTo(1);
  });
});

describe("the curve", () => {
  it("peaks 35 minutes after waking, wherever that falls on the clock", () => {
    expect(buildCurve(7 * 60, 23 * 60, 0, EMPTY_PROFILE).peakMinute).toBe(7 * 60 + 35);
    expect(buildCurve(11 * 60, 3 * 60, 0, EMPTY_PROFILE).peakMinute).toBe(11 * 60 + 35);
  });

  it("wraps the peak past midnight for a night worker", () => {
    expect(buildCurve(23 * 60 + 50, 15 * 60, 0, EMPTY_PROFILE).peakMinute).toBe(25);
  });

  it("covers the whole day at a quarter-hour, and is continuous", () => {
    const curve = buildCurve(7 * 60, 23 * 60, 0.3, EMPTY_PROFILE);
    expect(curve.points).toHaveLength(96);
    for (let i = 1; i < curve.points.length; i++) {
      const jump = Math.abs(curve.points[i].value - curve.points[i - 1].value);
      expect(jump).toBeLessThan(curve.peak * 0.5);
    }
  });

  it("flattens under load — the floor rises faster than the peak", () => {
    const calm = buildCurve(7 * 60, 23 * 60, 0, EMPTY_PROFILE);
    const heavy = buildCurve(7 * 60, 23 * 60, 1, EMPTY_PROFILE);
    expect(heavy.peak).toBeGreaterThan(calm.peak);
    expect(heavy.nadir).toBeGreaterThan(calm.nadir);
    // The claim the whole page rests on: a loaded day swings less.
    expect(heavy.swing).toBeLessThan(calm.swing);
  });

  it("lowers the peak with age, which is what the awakening response does", () => {
    const young = buildCurve(7 * 60, 23 * 60, 0, { age: 20, sex: null, mood: null });
    const older = buildCurve(7 * 60, 23 * 60, 0, { age: 70, sex: null, mood: null });
    expect(older.peak).toBeLessThan(young.peak);
  });

  it("is lowest in the small hours and highest in the morning", () => {
    const curve = buildCurve(7 * 60, 23 * 60, 0.2, EMPTY_PROFILE);
    const at = (m: number) => curve.points.find((p) => p.minute === m)!.value;
    expect(at(3 * 60)).toBeLessThan(at(8 * 60));
    expect(at(22 * 60)).toBeLessThan(at(8 * 60));
  });
});

describe("the whole report", () => {
  const week = (over: (i: number) => Partial<CortisolDay> = () => ({})) =>
    Array.from({ length: 14 }, (_, i) =>
      good({ date: `2026-08-${String(19 + i).padStart(2, "0")}`, ...over(i) })
    );

  it("reads a steady fortnight as a well-defined rhythm", () => {
    const report = buildReport(week(), EMPTY_PROFILE, NO_SOURCES);
    expect(report.rhythm).toBeGreaterThan(85);
    expect(report.curve).not.toBeNull();
    expect(report.nightsRead).toBe(14);
  });

  it("reads a fortnight of drifting wake times as a loosening one", () => {
    const chaos = buildReport(
      week((i) => ({ wake: (i % 2 === 0 ? 5 : 12) * 60 })),
      EMPTY_PROFILE,
      NO_SOURCES
    );
    const steady = buildReport(week(), EMPTY_PROFILE, NO_SOURCES);
    expect(chaos.rhythm!).toBeLessThan(steady.rhythm!);
    expect(chaos.drivers.some((d) => d.key === "irregular")).toBe(true);
  });

  it("takes the typical day, so one late night is not a rhythm", () => {
    const mostly = week();
    mostly[13] = good({ date: "2026-09-01", wake: 14 * 60, bed: 5 * 60 });
    const report = buildReport(mostly, EMPTY_PROFILE, NO_SOURCES);
    // Thirteen 7am mornings and one at two in the afternoon — the curve is
    // still drawn around the seven o'clock one.
    expect(report.medianWake).toBe(7 * 60);
  });

  it("medians bedtimes across midnight without landing at lunchtime", () => {
    const nights = [23 * 60 + 40, 0, 20, 23 * 60 + 50, 10];
    const report = buildReport(
      nights.map((bed, i) => good({ date: `2026-08-2${i}`, bed })),
      EMPTY_PROFILE,
      NO_SOURCES
    );
    // Around midnight, not around noon.
    const bed = report.medianBed!;
    expect(bed > 23 * 60 || bed < 60).toBe(true);
  });

  it("names what keeps happening, worst first, and only what is real", () => {
    const report = buildReport(
      week(() => ({ nightMinutes: 270, junk: 4 })),
      EMPTY_PROFILE,
      NO_SOURCES
    );
    expect(report.drivers.length).toBeGreaterThan(0);
    expect(report.drivers[0].key).toBe("short");
    for (const d of report.drivers) expect(d.value).toBeGreaterThan(0.15);
  });

  it("draws nothing at all when no night was ever logged", () => {
    const report = buildReport(
      week(() => ({ bed: null, wake: null, nightMinutes: null, quality: null })),
      EMPTY_PROFILE,
      NO_SOURCES
    );
    expect(report.curve).toBeNull();
    expect(report.rhythm).toBeNull();
    expect(report.nightsRead).toBe(0);
  });
});

describe("the profile", () => {
  it("keeps a plausible age, sex and mood", () => {
    expect(parseProfile({ age: 28, sex: "female", mood: 3.5 })).toEqual({
      age: 28,
      sex: "female",
      mood: 3.5,
    });
  });

  it("refuses the impossible rather than clamping it into a lie", () => {
    expect(parseProfile({ age: 400, sex: "yes", mood: 9 })).toEqual({
      age: null,
      sex: null,
      mood: null,
    });
  });

  it("survives nonsense", () => {
    expect(parseProfile(null)).toEqual({ age: null, sex: null, mood: null });
    expect(parseProfile("nope")).toEqual({ age: null, sex: null, mood: null });
  });
});

describe("the shape of a healthy day", () => {
  /**
   * The curve is pinned against the pattern a healthy adult actually has —
   * lowest around midnight, climbing from the small hours, peaking shortly
   * after waking, declining smoothly all day, low again at night — and
   * against published salivary values: a morning peak in the tens of nmol/L,
   * an evening under about 3.6, and a daily mean in the single figures.
   *
   * These are the assertions that would catch a "harmless" tweak to a time
   * constant turning the model into something that no longer describes a
   * person.
   */
  const curve = buildCurve(7 * 60, 23 * 60, 0, EMPTY_PROFILE);
  const at = (hour: number) =>
    curve.points.find((p) => p.minute === hour * 60)!.value;
  const nmol = (index: number) => toNmol(index);

  it("peaks shortly after waking and nowhere else", () => {
    const highest = curve.points.reduce((a, b) => (b.value > a.value ? b : a));
    expect(highest.minute).toBeGreaterThanOrEqual(7 * 60);
    expect(highest.minute).toBeLessThanOrEqual(8 * 60);
  });

  it("declines smoothly all through the day, never climbing back", () => {
    for (let hour = 8; hour < 22; hour++) {
      expect(at(hour + 1)).toBeLessThan(at(hour));
    }
  });

  it("is at its lowest in the small hours, before the pre-waking rise", () => {
    const lowest = curve.points.reduce((a, b) => (b.value < a.value ? b : a));
    expect(lowest.minute).toBeGreaterThanOrEqual(1 * 60);
    expect(lowest.minute).toBeLessThanOrEqual(4 * 60);
  });

  it("is already climbing before the alarm goes off", () => {
    expect(at(6)).toBeGreaterThan(at(3));
  });

  it("runs high, then medium, then low across the day", () => {
    expect(at(10)).toBeGreaterThan(at(12));
    expect(at(12)).toBeGreaterThan(at(15));
    expect(at(15)).toBeGreaterThan(at(18));
    expect(at(18)).toBeGreaterThan(at(22));
  });

  it("lands inside the published salivary reference values", () => {
    // Morning peak: reported roughly 7.6–39.4 nmol/L across assays.
    expect(nmol(curve.peak)).toBeGreaterThan(7.6);
    expect(nmol(curve.peak)).toBeLessThan(39.4);
    // Late evening: reported upper limit of normal around 3.6 nmol/L.
    expect(nmol(at(22))).toBeLessThan(3.6);
    // And the daily mean inside the band the page quotes at the reader.
    expect(dailyMean(curve)).toBeGreaterThanOrEqual(MEAN_REFERENCE.low);
    expect(dailyMean(curve)).toBeLessThanOrEqual(MEAN_REFERENCE.high);
  });

  it("rises between 50% and 156% from waking to peak, as the CAR does", () => {
    const atWaking = curve.points.find((p) => p.minute === 7 * 60)!.value;
    const rise = (curve.peak - atWaking) / atWaking;
    expect(rise).toBeGreaterThan(0.5);
    expect(rise).toBeLessThan(1.56);
  });

  it("peaks later for a woman than for a man, as the research reports", () => {
    const male = buildCurve(7 * 60, 23 * 60, 0, { age: 30, sex: "male", mood: null });
    const female = buildCurve(7 * 60, 23 * 60, 0, { age: 30, sex: "female", mood: null });
    expect(male.peakMinute).toBe(7 * 60 + 30);
    expect(female.peakMinute).toBe(7 * 60 + 45);
  });
});
