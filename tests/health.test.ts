import { describe, expect, it } from "vitest";
import {
  MOVEMENT_WEEKLY,
  REFERENCES,
  SLEEP_TARGET,
  balanceOf,
  blankDay,
  domainsOf,
  summarize,
  timingsOf,
  type HealthDay,
} from "../lib/health";
import { foldDays, sourcesFromRoles, toCortisolDays } from "../lib/healthDays";
import { buildMap, trackerFor } from "../lib/trackerRoles";
import type { Tracker } from "../lib/trackers";
import type { Answers } from "../lib/cortisolCheck";

/**
 * The health engine is arithmetic on somebody's own days, so these are the
 * checks that keep the arithmetic honest: that a missing input is missing
 * rather than a zero, that a blank day is not a day with nothing in it, that
 * an unbroken block of sitting is the biggest session rather than the sum,
 * and that every band a score is judged against is written down somewhere the
 * reader can find it.
 */

const day = (over: Partial<HealthDay> & { date: string }): HealthDay => ({
  ...blankDay(over.date),
  ...over,
});

/** A fortnight of unremarkable nights: 7h30, up at seven, to the minute. */
const steadyNights = (n: number, minutes = 450): HealthDay[] =>
  Array.from({ length: n }, (_, i) =>
    day({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      bed: 23 * 60 + 30,
      wake: 7 * 60,
      nightMinutes: minutes,
      quality: 4,
    })
  );

describe("summarize — sleep", () => {
  it("counts debt against the seven-hour floor and nothing else", () => {
    const m = summarize(steadyNights(10, 360), null, 10);
    // An hour short, ten times.
    expect(m.sleep.debtMinutes).toBe(600);
    expect(m.sleep.shortNights).toBe(10);
    expect(m.sleep.avgMinutes).toBe(360);
  });

  it("owes nothing when the nights are long enough", () => {
    const m = summarize(steadyNights(7, 480), null, 7);
    expect(m.sleep.debtMinutes).toBe(0);
    expect(m.sleep.shortNights).toBe(0);
  });

  it("reads a steady wake time as steady", () => {
    const m = summarize(steadyNights(7), null, 7);
    expect(m.sleep.wakeSpread).toBe(0);
  });

  it("measures how far the wake time actually moves", () => {
    const days = steadyNights(4).map((d, i) => ({ ...d, wake: 7 * 60 + i * 60 }));
    const m = summarize(days, null, 4);
    // Four wake times an hour apart have a real spread; the number matters
    // less than that it is large and finite.
    expect(m.sleep.wakeSpread).toBeGreaterThan(60);
  });

  it("does not read a bedtime crossing midnight as a fourteen-hour swing", () => {
    // 23:50 and 00:10 are twenty minutes apart. Treated as clock minutes they
    // are 1,410 apart, which would make the steadiest sleeper look chaotic.
    const days = [
      day({ date: "2026-09-01", bed: 23 * 60 + 50, wake: 7 * 60, nightMinutes: 430 }),
      day({ date: "2026-09-02", bed: 10, wake: 7 * 60, nightMinutes: 410 }),
    ];
    const m = summarize(days, null, 2);
    expect(m.sleep.bedSpread).toBeLessThan(30);
  });

  it("finds the weekend drift when there is one", () => {
    // Tue-Thu are working days here; Sat and Sun are free. Friday counts as
    // free too — the weekend is not the same two days everywhere, and this
    // app is used where it starts on Friday.
    const days = [
      day({ date: "2026-09-01", bed: 23 * 60, wake: 7 * 60, nightMinutes: 480 }),
      day({ date: "2026-09-02", bed: 23 * 60, wake: 7 * 60, nightMinutes: 480 }),
      day({ date: "2026-09-03", bed: 23 * 60, wake: 7 * 60, nightMinutes: 480 }),
      // 1am to 10am: a midpoint of 5:30 against the working week's 3:00.
      day({ date: "2026-09-05", bed: 60, wake: 10 * 60, nightMinutes: 540 }),
      day({ date: "2026-09-06", bed: 60, wake: 10 * 60, nightMinutes: 540 }),
    ];
    const m = summarize(days, null, 5);
    expect(m.sleep.socialJetlag).toBe(150);
  });

  it("says nothing about nights it never saw", () => {
    const m = summarize([], null, 14);
    expect(m.sleep.nights).toBe(0);
    expect(m.sleep.avgMinutes).toBeNull();
    expect(m.sleep.wakeSpread).toBeNull();
  });
});

describe("summarize — hydration against your own body", () => {
  const answers = { heightCm: 175, weightKg: 70 } as unknown as Answers;

  it("works the target out from body weight rather than folklore", () => {
    const days = steadyNights(7).map((d) => ({ ...d, water: 5 }));
    const m = summarize(days, answers, 7);
    // 70 kg x 35 ml = 2,450 ml, which is 6 glasses of 400.
    expect(m.hydration.targetGlasses).toBe(6);
    expect(m.hydration.avgGlasses).toBe(5);
    expect(m.hydration.deficitMl).toBe(400);
    expect(m.hydration.shortDays).toBe(7);
  });

  it("has no target at all without a weight, and says so with a null", () => {
    const days = steadyNights(7).map((d) => ({ ...d, water: 5 }));
    const m = summarize(days, null, 7);
    expect(m.hydration.targetGlasses).toBeNull();
    expect(m.hydration.pctOfTarget).toBeNull();
  });

  it("takes the weight from a tracker over the check-up when both exist", () => {
    const days = steadyNights(4).map((d, i) => ({ ...d, weight: 90 + i }));
    const m = summarize(days, answers, 4);
    expect(m.body.weightKg).toBe(93);
  });
});

describe("summarize — sitting", () => {
  it("sums the day's desk work but keeps the longest block separate", () => {
    const days = [
      day({ date: "2026-09-01", sitting: 480, sittingLongest: 240 }),
      day({ date: "2026-09-02", sitting: 480, sittingLongest: 60 }),
    ];
    const m = summarize(days, null, 2);
    expect(m.sedentary.avgSittingMinutes).toBe(480);
    // The same total; a completely different day for a back.
    expect(m.sedentary.avgLongestBlock).toBe(150);
    expect(m.sedentary.worstBlock).toBe(240);
  });

  it("counts the days over the eight-hour reference", () => {
    const days = [
      day({ date: "2026-09-01", sitting: 400, screen: 120 }),
      day({ date: "2026-09-02", sitting: 200, screen: 60 }),
    ];
    const m = summarize(days, null, 2);
    expect(m.sedentary.heavyDays).toBe(1);
  });
});

describe("summarize — the rest", () => {
  it("scales movement to a week whatever the window is", () => {
    const days = steadyNights(14).map((d) => ({ ...d, exercise: 30 }));
    const m = summarize(days, null, 14);
    expect(m.movement.weeklyMinutes).toBe(210);
    expect(m.movement.activeDays).toBe(14);
  });

  it("draws a weight trend only once there are enough weigh-ins", () => {
    const three = [1, 2, 3].map((i) =>
      day({ date: `2026-09-0${i}`, weight: 70 + i })
    );
    expect(summarize(three, null, 3).body.trendKgPerMonth).toBeNull();

    const many = [1, 2, 3, 4, 5].map((i) =>
      day({ date: `2026-09-0${i}`, weight: 70 + i })
    );
    // A kilogram a day is thirty a month, and the line should say so.
    expect(summarize(many, null, 5).body.trendKgPerMonth).toBeCloseTo(30, 0);
  });

  it("counts a clean streak forwards and breaks it on a slip", () => {
    const days = [
      day({ date: "2026-09-01", cleanHeld: 1 }),
      day({ date: "2026-09-02", cleanHeld: 1 }),
      day({ date: "2026-09-03", cleanSlipped: 1 }),
      day({ date: "2026-09-04", cleanHeld: 1 }),
    ];
    const m = summarize(days, null, 4);
    expect(m.discipline.longestStreak).toBe(2);
    expect(m.discipline.currentStreak).toBe(1);
    expect(m.discipline.slipDays).toBe(1);
    expect(m.discipline.cleanRate).toBe(75);
  });
});

describe("domainsOf — a missing input is missing, never a zero", () => {
  it("scores nothing at all when nothing is logged", () => {
    const m = summarize([], null, 14);
    expect(domainsOf(m, null)).toEqual([]);
  });

  it("scores only what it can see", () => {
    const m = summarize(steadyNights(7), null, 7);
    const ids = domainsOf(m, null).map((d) => d.id);
    expect(ids).toContain("sleep");
    // Nothing was logged about food or water, so neither is scored — a person
    // who logs only sleep is scored on sleep.
    expect(ids).not.toContain("hydration");
    expect(ids).not.toContain("nutrition");
  });

  it("marks a good week as balanced and a short one as not", () => {
    const good = domainsOf(summarize(steadyNights(10, 480), null, 10), null);
    const bad = domainsOf(summarize(steadyNights(10, 300), null, 10), null);
    const scoreOf = (list: typeof good) =>
      list.find((d) => d.id === "sleep")?.score ?? 0;
    expect(scoreOf(good)).toBeGreaterThan(scoreOf(bad));
    expect(scoreOf(good)).toBeGreaterThan(80);
  });

  it("prints a reference band beside every score it gives", () => {
    const days = steadyNights(10).map((d) => ({
      ...d,
      water: 6,
      diet: 4,
      junk: 0,
      exercise: 30,
      mood: 4,
      sitting: 300,
      sittingLongest: 90,
    }));
    const domains = domainsOf(summarize(days, null, 10), null);
    expect(domains.length).toBeGreaterThan(3);
    for (const domain of domains) {
      expect(domain.reference.length, domain.id).toBeGreaterThan(5);
      expect(domain.value.length, domain.id).toBeGreaterThan(0);
    }
  });
});

describe("balanceOf — renormalised over what exists", () => {
  it("is null when there is nothing to average", () => {
    expect(balanceOf([]).score).toBeNull();
  });

  it("does not punish somebody for the domains they do not log", () => {
    // One perfect domain alone should read as perfect, not as one tenth of it.
    const one = balanceOf([
      {
        id: "sleep",
        label: "Sleep",
        icon: "",
        score: 100,
        band: "",
        value: "",
        reference: "",
        referenceId: "",
        note: "",
        weight: 0.24,
      },
    ]);
    expect(one.score).toBe(100);
    expect(one.scored).toBe(1);
    expect(one.possible).toBeGreaterThan(1);
  });

  it("names the weakest areas, worst first", () => {
    const domain = (id: string, score: number) => ({
      id,
      label: id,
      icon: "",
      score,
      band: "",
      value: "",
      reference: "",
      referenceId: "",
      note: "",
      weight: 0.1,
    });
    const balance = balanceOf([domain("a", 30), domain("b", 90), domain("c", 50)]);
    expect(balance.weakest.map((d) => d.id)).toEqual(["a", "c"]);
  });
});

describe("timingsOf — subtractions from your own night", () => {
  it("says nothing without a wake time to subtract from", () => {
    expect(timingsOf(summarize([], null, 14), null)).toEqual([]);
  });

  it("puts the bedtime a night's sleep before the wake time", () => {
    const m = summarize(steadyNights(7, SLEEP_TARGET), null, 7);
    const timings = timingsOf(m, null);
    const bed = timings.find((t) => t.id === "bed");
    // Up at seven, seven hours wanted, so lights out at midnight.
    expect(bed?.time).toBe("12:00 am");
  });

  it("puts the last coffee six hours before that", () => {
    const m = summarize(steadyNights(7, SLEEP_TARGET), null, 7);
    const caffeine = timingsOf(m, null).find((t) => t.id === "caffeine");
    expect(caffeine?.time).toBe("6:00 pm");
  });
});

/* --------------------------- entries into days --------------------------- */

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

describe("foldDays", () => {
  const trackers = [
    tracker({ id: "sleep", name: "Sleep", type: "sleep", category: "sleep" }),
    tracker({ id: "study", name: "Study", type: "duration", category: "study" }),
    tracker({ id: "edit", name: "Video editing", type: "duration", category: "work" }),
    tracker({ id: "water", name: "Water", type: "count", category: "food", unit: "glasses" }),
    tracker({ id: "clean", name: "Clean streak", type: "streak", category: "discipline" }),
  ];
  const map = buildMap(trackers, [], {});

  it("adds several sitting trackers up but keeps the longest as the block", () => {
    const days = foldDays(
      [
        { trackerId: "study", date: "2026-09-01", value: 180, meta: null },
        { trackerId: "edit", date: "2026-09-01", value: 240, meta: null },
      ],
      map
    );
    expect(days[0].sitting).toBe(420);
    // Seven hours of sitting, but the worst single stretch was four.
    expect(days[0].sittingLongest).toBe(240);
  });

  it("reads a night from its clock times rather than from the total", () => {
    const days = foldDays(
      [
        {
          trackerId: "sleep",
          date: "2026-09-01",
          value: 999,
          meta: { start: "23:00", end: "07:00", quality: 4 },
        },
      ],
      map
    );
    expect(days[0].nightMinutes).toBe(480);
    expect(days[0].wake).toBe(420);
    expect(days[0].quality).toBe(4);
  });

  it("takes naps back out when there are no clock times", () => {
    const days = foldDays(
      [
        {
          trackerId: "sleep",
          date: "2026-09-01",
          value: 500,
          meta: { naps: [{ mins: 40, at: "14:00" }] },
        },
      ],
      map
    );
    expect(days[0].napMinutes).toBe(40);
    expect(days[0].nightMinutes).toBe(460);
  });

  it("reads a slip from the meta, not from the value", () => {
    // A slip is stored as value 0 *with* meta. Reading the value alone would
    // make every slip indistinguishable from an untouched day.
    const days = foldDays(
      [{ trackerId: "clean", date: "2026-09-01", value: 0, meta: { status: "slip" } }],
      map
    );
    expect(days[0].cleanSlipped).toBe(1);
    expect(days[0].cleanHeld).toBe(0);
  });

  it("leaves a day with nothing on it out entirely", () => {
    expect(foldDays([], map)).toEqual([]);
  });

  it("ignores a tracker that fills no role", () => {
    const days = foldDays(
      [{ trackerId: "unknown", date: "2026-09-01", value: 5, meta: null }],
      map
    );
    expect(days).toEqual([]);
  });

  it("hands the cortisol model the same inputs under its own names", () => {
    const sources = sourcesFromRoles(map);
    expect(sources.sleepId).toBe("sleep");
    const days = foldDays(
      [{ trackerId: "water", date: "2026-09-01", value: 6, meta: null }],
      map
    );
    expect(toCortisolDays(days)).toHaveLength(1);
    expect(toCortisolDays(days)[0].date).toBe("2026-09-01");
  });
});

describe("the reference table", () => {
  it("gives every band a source note rather than asserting it", () => {
    for (const ref of REFERENCES) {
      expect(ref.band.length, ref.id).toBeGreaterThan(3);
      expect(ref.note.length, ref.id).toBeGreaterThan(40);
    }
  });

  it("has unique ids", () => {
    const ids = REFERENCES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the movement guideline the code uses and the one it prints in step", () => {
    expect(MOVEMENT_WEEKLY).toBe(150);
    expect(REFERENCES.find((r) => r.id === "movement")?.band).toContain("150");
  });
});

/* ------------- regressions the pre-deploy audit turned up ---------------- */

describe("units and types, which an entry row does not carry", () => {
  const T = (over: Partial<Tracker> & { id: string; name: string }): Tracker => ({
    type: "count",
    unit: "",
    color: "#123456",
    category: "other",
    goal: null,
    archived: false,
    order: 0,
    ...over,
  });

  it("counts an abstinence streak's SLIPS as junk, never the days it held", () => {
    // "No junk food" as a clean streak. Reading the held days as junk eaten
    // inverts the meaning: a fortnight of eating none would have scored as
    // junk every single day, which is the worst possible mark for exactly the
    // behaviour the tracker exists to record.
    const trackers = [
      T({ id: "j", name: "No junk food", type: "streak", category: "food", habit: "bad" }),
    ];
    const map = buildMap(trackers, [], {});
    expect(trackerFor(map, "junk")).toBe("j");

    const held = foldDays(
      [
        { trackerId: "j", date: "2026-09-01", value: 1, meta: { status: "clean" } },
        { trackerId: "j", date: "2026-09-02", value: 1, meta: { status: "clean" } },
      ],
      map,
      trackers
    );
    expect(held.every((d) => d.junk === 0)).toBe(true);

    const slipped = foldDays(
      [{ trackerId: "j", date: "2026-09-03", value: 0, meta: { status: "slip" } }],
      map,
      trackers
    );
    expect(slipped[0].junk).toBe(1);
  });

  it("does not add a ticked workout into a field measured in minutes", () => {
    // Ticking a box every day for a fortnight used to read as 7 minutes a
    // week and score 5 out of 100 for somebody exercising daily.
    const trackers = [
      T({ id: "x", name: "Workout", type: "check", category: "fitness" }),
    ];
    const map = buildMap(trackers, [], {});
    const rows = Array.from({ length: 14 }, (_, i) => ({
      trackerId: "x",
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      value: 1,
      meta: null,
    }));
    const m = summarize(foldDays(rows, map, trackers), null, 14);

    expect(m.movement.weeklyMinutes).toBeNull();
    expect(m.movement.sessionsPerWeek).toBe(7);
    expect(m.movement.activeDays).toBe(14);

    const movement = domainsOf(m, null).find((d) => d.id === "movement");
    expect(movement).toBeTruthy();
    expect(movement!.score).toBe(100);
    expect(movement!.value).toContain("session");
  });

  it("reads a weight logged in pounds as kilograms", () => {
    const trackers = [T({ id: "w", name: "Weight", type: "measure", unit: "lb", category: "health" })];
    const map = buildMap(trackers, [], {});
    const days = foldDays(
      [{ trackerId: "w", date: "2026-09-01", value: 154, meta: null }],
      map,
      trackers
    );
    // 154 lb is 70 kg — read as 154 kg it gave a BMI of 50 and a water
    // target two litres too high.
    expect(days[0].weight).toBeCloseTo(69.9, 1);
  });

  it("reads caffeine logged in milligrams as cups", () => {
    const trackers = [T({ id: "c", name: "Caffeine", type: "measure", unit: "mg", category: "food" })];
    const map = buildMap(trackers, [], {});
    const days = foldDays(
      [{ trackerId: "c", date: "2026-09-01", value: 190, meta: null }],
      map,
      trackers
    );
    // Not "190 cups a day".
    expect(days[0].caffeine).toBeCloseTo(2, 1);
  });

  it("reads water logged in millilitres as glasses", () => {
    const trackers = [T({ id: "w", name: "Water", type: "measure", unit: "ml", category: "food" })];
    const map = buildMap(trackers, [], {});
    const days = foldDays(
      [{ trackerId: "w", date: "2026-09-01", value: 2000, meta: null }],
      map,
      trackers
    );
    expect(days[0].water).toBeCloseTo(5, 5);
  });
});

describe("nothing rendered is ever the word null", () => {
  const scan = (text: string) => {
    expect(text, text).not.toMatch(/null/);
    expect(text, text).not.toMatch(/NaN/);
    expect(text, text).not.toMatch(/undefined/);
  };

  it("holds for a stress tracker with no mood and no check-up", () => {
    // This printed "stress reported at null/10".
    const days = steadyNights(10).map((d) => ({ ...d, stress: 3 }));
    const mind = domainsOf(summarize(days, null, 10), null).find((d) => d.id === "mind");
    expect(mind).toBeTruthy();
    scan(mind!.value);
    scan(mind!.note);
  });

  it("holds across every domain for a sparse, awkward log", () => {
    const days = steadyNights(10).map((d, i) => ({
      ...d,
      water: i % 3 === 0 ? 2 : null,
      energy: i % 4 === 0 ? 2 : null,
      sitting: 540,
      sittingLongest: 200,
      caffeine: i % 2 === 0 ? 4 : null,
    }));
    for (const domain of domainsOf(summarize(days, null, 10), null)) {
      scan(domain.value);
      scan(domain.note);
      scan(domain.reference);
    }
  });
});

describe("balanceOf orders strongest best-first", () => {
  it("puts the highest score at index 0", () => {
    const domain = (id: string, score: number) => ({
      id,
      label: id,
      icon: "",
      score,
      band: "",
      value: "",
      reference: "",
      referenceId: "",
      note: "",
      weight: 0.1,
    });
    // The page reads strongest[0]; reading the last element named the
    // runner-up on every account with more than one scored domain.
    const balance = balanceOf([domain("a", 30), domain("b", 90), domain("c", 50)]);
    expect(balance.strongest[0].id).toBe("b");
  });
});
