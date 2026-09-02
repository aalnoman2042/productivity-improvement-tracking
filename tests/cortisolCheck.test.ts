import { describe, expect, it } from "vitest";
import {
  QUESTIONS,
  SCOREABLE,
  SECTIONS,
  bmiOf,
  checkDue,
  cleanAnswers,
  monthOfDate,
  morningFactor,
  pressureOf,
  scoreCheck,
  type Answers,
} from "../lib/cortisolCheck";

/**
 * The questions are data, and data with a mistake in it fails silently: a
 * choice whose pressures never reach 1 quietly cannot move the score, and a
 * question in a section nobody renders is a question nobody answers. These
 * are the checks that catch that here rather than on a real account.
 *
 * The two rules that matter most have tests of their own below: silence must
 * not buy a better score, and a medication must not be scored as a worse one.
 */

/** Every question answered at its best. */
const best = (): Answers => {
  const out: Answers = {};
  for (const q of QUESTIONS) {
    if (q.kind === "choice") {
      out[q.id] = [...q.options].sort((a, b) => a.p - b.p)[0].value;
    } else if (q.kind === "scale") {
      out[q.id] = q.worst === "high" ? q.min : q.max;
    } else if (q.kind === "number" && q.bad !== q.good) {
      out[q.id] = q.good;
    }
  }
  return out;
};

/** Every question answered at its worst. */
const worst = (): Answers => {
  const out: Answers = {};
  for (const q of QUESTIONS) {
    if (q.kind === "choice") {
      out[q.id] = [...q.options].sort((a, b) => b.p - a.p)[0].value;
    } else if (q.kind === "multi") {
      out[q.id] = q.options.map((o) => o.value);
    } else if (q.kind === "scale") {
      out[q.id] = q.worst === "high" ? q.max : q.min;
    } else if (q.kind === "number" && q.bad !== q.good) {
      out[q.id] = q.bad;
    }
  }
  return out;
};

describe("the questions as data", () => {
  it("gives every question a unique id", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every question in a section that is actually rendered", () => {
    const known = new Set(SECTIONS.map((s) => s.id));
    for (const q of QUESTIONS) expect(known.has(q.section)).toBe(true);
  });

  it("keeps every choice pressure inside 0 and 1", () => {
    for (const q of QUESTIONS) {
      if (q.kind !== "choice" && q.kind !== "multi") continue;
      for (const o of q.options) {
        expect(o.p).toBeGreaterThanOrEqual(0);
        expect(o.p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives every scored choice a way to answer with no pressure at all", () => {
    // Otherwise the question is a tax rather than a measurement — nobody can
    // ever score full marks on it however well they live.
    for (const q of QUESTIONS) {
      if (q.kind !== "choice" || q.weight === 0) continue;
      expect(q.options.some((o) => o.p === 0)).toBe(true);
    }
  });

  it("scores nothing that is not meant to be scored", () => {
    const unscored = QUESTIONS.filter((q) => q.weight === 0).map((q) => q.id);
    expect(unscored).toContain("health");
    expect(unscored).toContain("heightCm");
    expect(unscored).toContain("weightKg");
    expect(SCOREABLE.every((q) => q.weight > 0)).toBe(true);
  });

  it("asks about the morning, which is the part behaviour moves most", () => {
    const morning = QUESTIONS.filter((q) => q.section === "morning");
    expect(morning.map((q) => q.id)).toContain("sunlight");
    expect(morning.map((q) => q.id)).toContain("firstThirty");
  });

  it("does not ask again for what the daily log already records", () => {
    // Rest rating and naps come from the sleep entry; asking twice invites
    // two answers that disagree.
    const ids = QUESTIONS.map((q) => q.id);
    expect(ids).not.toContain("refreshed");
    expect(ids).not.toContain("naps");
  });
});

describe("one answer at a time", () => {
  it("reads a choice, and refuses one that was never offered", () => {
    const q = QUESTIONS.find((x) => x.id === "sunlight")!;
    expect(pressureOf(q, "early")).toBe(0);
    expect(pressureOf(q, "rarely")).toBe(1);
    expect(pressureOf(q, "sometime-maybe")).toBeNull();
  });

  it("adds up a multi-select and caps it at one", () => {
    const q = QUESTIONS.find((x) => x.id === "stressfulContent")!;
    expect(pressureOf(q, [])).toBe(0);
    expect(pressureOf(q, ["news", "arguments", "work"])).toBe(1);
  });

  it("runs a scale the right way round in both directions", () => {
    const stress = QUESTIONS.find((x) => x.id === "stress")!;
    const mood = QUESTIONS.find((x) => x.id === "moodToday")!;
    expect(pressureOf(stress, 1)).toBe(0);
    expect(pressureOf(stress, 10)).toBe(1);
    // Mood is the other way: a low one is the pressure.
    expect(pressureOf(mood, 10)).toBe(0);
    expect(pressureOf(mood, 1)).toBe(1);
  });

  it("clamps a number past the bad end instead of running off the scale", () => {
    const q = QUESTIONS.find((x) => x.id === "caffeineCups")!;
    expect(pressureOf(q, 1)).toBe(0);
    expect(pressureOf(q, 20)).toBe(1);
  });

  it("says nothing about an unanswered question", () => {
    const q = QUESTIONS.find((x) => x.id === "onset")!;
    expect(pressureOf(q, undefined)).toBeNull();
    expect(pressureOf(q, "")).toBeNull();
  });

  it("never scores the health question", () => {
    const q = QUESTIONS.find((x) => x.id === "health")!;
    expect(pressureOf(q, ["steroid", "thyroid"])).toBeNull();
  });
});

describe("scoring a check-up", () => {
  it("scores a best-case answer sheet at or near 100", () => {
    expect(scoreCheck(best()).score).toBe(100);
  });

  it("scores a worst-case one at or near 0", () => {
    // Not exactly 0: a few worst answers stop short of full pressure on
    // purpose — being wiped out after exercise is bad, and it is not as bad
    // as a rotating night shift.
    expect(scoreCheck(worst()).score!).toBeLessThan(5);
  });

  it("says nothing at all when nothing was answered", () => {
    const res = scoreCheck({});
    expect(res.score).toBeNull();
    expect(res.pressure).toBeNull();
  });

  it("does not let silence buy a better score", () => {
    // One bad answer and nothing else is a bad check-up, not a nearly
    // perfect one with a blemish.
    const res = scoreCheck({ sunlight: "rarely" });
    expect(res.score).toBe(0);
    expect(res.answered).toBe(1);
  });

  it("renormalises over what was answered, so a part sheet still scores", () => {
    const res = scoreCheck({ sunlight: "early", stress: 1 });
    expect(res.score).toBe(100);
    expect(res.answered).toBe(2);
    expect(res.scoreable).toBe(SCOREABLE.length);
  });

  it("scores each section on its own", () => {
    const res = scoreCheck({ ...best(), sunlight: "rarely", firstThirty: "tired" });
    const morning = res.sections.find((s) => s.id === "morning")!;
    const stress = res.sections.find((s) => s.id === "stress")!;
    expect(morning.score!).toBeLessThan(stress.score!);
  });

  it("records a medication without scoring it as worse health", () => {
    const clean = scoreCheck(best());
    const flagged = scoreCheck({ ...best(), health: ["steroid"] });
    expect(flagged.score).toBe(clean.score);
    expect(flagged.flags).toEqual(["steroid"]);
    expect(flagged.confident).toBe(false);
    expect(clean.confident).toBe(true);
  });

  it("names the worst answers, worst first, and only real ones", () => {
    const res = scoreCheck({ ...best(), schedule: "night", sunlight: "rarely" });
    expect(res.drivers.length).toBeGreaterThan(0);
    // Shift work carries the heaviest weight on the form.
    expect(res.drivers[0].id).toBe("schedule");
    for (const d of res.drivers) expect(d.pressure).toBeGreaterThan(0.25);
  });

  it("counts BMI only when both numbers are there", () => {
    expect(bmiOf({ heightCm: 175, weightKg: 70 })).toBeCloseTo(22.9, 1);
    expect(bmiOf({ heightCm: 175 })).toBeNull();
    expect(bmiOf({})).toBeNull();

    const middle = scoreCheck({ ...best(), heightCm: 175, weightKg: 70 });
    const far = scoreCheck({ ...best(), heightCm: 175, weightKg: 130 });
    expect(far.score!).toBeLessThan(middle.score!);
  });
});

describe("the morning factor", () => {
  it("leaves the peak alone when the morning goes well", () => {
    expect(morningFactor(best())).toBe(1);
  });

  it("takes the top off a heavy, slow, sunless start", () => {
    const factor = morningFactor({
      firstThirty: "tired",
      fullyAwake: "long",
      sunlight: "rarely",
    });
    expect(factor).toBeLessThan(1);
    // Visible on a chart, nowhere near pretending to be an assay.
    expect(factor).toBeGreaterThan(0.7);
  });

  it("leaves it alone when the morning was not asked about", () => {
    expect(morningFactor({})).toBe(1);
  });
});

describe("what may be stored", () => {
  it("keeps only questions this app actually asks", () => {
    const cleaned = cleanAnswers({ sunlight: "early", sneaky: "value" });
    expect(cleaned).toEqual({ sunlight: "early" });
  });

  it("refuses a choice that was never offered", () => {
    expect(cleanAnswers({ sunlight: "whenever" })).toEqual({});
  });

  it("keeps only real options out of a multi-select", () => {
    expect(
      cleanAnswers({ stressfulContent: ["news", "conspiracy"] })
    ).toEqual({ stressfulContent: ["news"] });
  });

  it("refuses a scale outside its own range", () => {
    expect(cleanAnswers({ stress: 40 })).toEqual({});
    expect(cleanAnswers({ stress: 7 })).toEqual({ stress: 7 });
  });

  it("refuses a number past what the question allows", () => {
    expect(cleanAnswers({ caffeineCups: 900 })).toEqual({});
  });

  it("survives nonsense", () => {
    expect(cleanAnswers(null)).toEqual({});
    expect(cleanAnswers("nope")).toEqual({});
    expect(cleanAnswers({ health: "steroid" })).toEqual({});
  });
});

describe("the monthly cadence", () => {
  it("reads the month off a date", () => {
    expect(monthOfDate("2026-09-02")).toBe("2026-09");
  });

  it("is due when the newest answers are from another month", () => {
    expect(checkDue("2026-08", "2026-09-02")).toBe(true);
    expect(checkDue(null, "2026-09-02")).toBe(true);
  });

  it("is not due again in the month it was answered", () => {
    expect(checkDue("2026-09", "2026-09-30")).toBe(false);
  });
});
