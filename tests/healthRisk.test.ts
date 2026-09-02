import { describe, expect, it } from "vitest";
import {
  blankDay,
  summarize,
  timingsOf,
  type HealthDay,
  type HealthMetrics,
} from "../lib/health";
import { forecasts, riskBand, risksOf } from "../lib/healthRisk";
import { TIPS, tipsFor } from "../lib/healthTips";
import type { Answers } from "../lib/cortisolCheck";

/**
 * Predictions are the easiest thing on a health page to write and the hardest
 * to trust, so these check the three properties that make them worth
 * printing: that a risk whose inputs are not logged is **absent rather than
 * zero**, that each one **moves the right way** when its driver moves, and
 * that every one of them can say what it was calculated from.
 */

const day = (over: Partial<HealthDay> & { date: string }): HealthDay => ({
  ...blankDay(over.date),
  ...over,
});

const days = (n: number, over: Partial<HealthDay> = {}): HealthDay[] =>
  Array.from({ length: n }, (_, i) =>
    day({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, ...over })
  );

const metricsFor = (list: HealthDay[], check: Answers | null = null): HealthMetrics =>
  summarize(list, check, list.length || 14);

const risk = (m: HealthMetrics, id: string, check: Answers | null = null) =>
  risksOf(m, null, check).find((r) => r.id === id) ?? null;

describe("risks appear only when something feeds them", () => {
  it("returns nothing at all for an empty log", () => {
    expect(risksOf(metricsFor([]), null, null)).toEqual([]);
  });

  it("does not invent a back risk for somebody who logs no desk time", () => {
    const m = metricsFor(days(14, { nightMinutes: 480, bed: 1380, wake: 420 }));
    expect(risk(m, "back")).toBeNull();
  });

  it("does not invent a hydration risk with no water logged", () => {
    const m = metricsFor(days(14, { nightMinutes: 480 }));
    expect(risk(m, "dehydration")).toBeNull();
  });
});

describe("back strain — the block, the total, and the offset", () => {
  it("rises when the same hours arrive in one unbroken block", () => {
    const broken = risk(
      metricsFor(days(14, { sitting: 480, sittingLongest: 45 })),
      "back"
    );
    const unbroken = risk(
      metricsFor(days(14, { sitting: 480, sittingLongest: 240 })),
      "back"
    );
    // Identical totals. The difference is entirely how it arrives, which is
    // the claim the whole risk rests on.
    expect(unbroken!.pct).toBeGreaterThan(broken!.pct);
  });

  it("falls when there is movement to offset it", () => {
    const still = risk(metricsFor(days(14, { sitting: 540, sittingLongest: 180 })), "back");
    const moving = risk(
      metricsFor(days(14, { sitting: 540, sittingLongest: 180, exercise: 40 })),
      "back"
    );
    expect(moving!.pct).toBeLessThan(still!.pct);
  });

  it("is low for a short, well-broken day", () => {
    const m = metricsFor(days(14, { sitting: 180, sittingLongest: 45, exercise: 30 }));
    expect(risk(m, "back")!.pct).toBeLessThan(30);
  });

  it("says what it was calculated from", () => {
    const r = risk(metricsFor(days(14, { sitting: 480, sittingLongest: 200 })), "back")!;
    expect(r.math).toContain("0.55");
    expect(r.drivers.length).toBeGreaterThanOrEqual(3);
    expect(r.lever.length).toBeGreaterThan(20);
  });

  it("names the movement offset as a negative contribution, not a positive one", () => {
    const r = risk(
      metricsFor(days(14, { sitting: 480, sittingLongest: 200, exercise: 40 })),
      "back"
    )!;
    const offset = r.drivers.find((d) => d.label.includes("Movement"));
    expect(offset!.share).toBeLessThan(0);
  });
});

describe("sleep debt — and how long it would take to clear", () => {
  it("is near zero when the nights are long enough", () => {
    const m = metricsFor(days(14, { nightMinutes: 480, bed: 1380, wake: 420 }));
    expect(risk(m, "sleepDebt")!.pct).toBeLessThan(20);
  });

  it("rises with the shortfall", () => {
    const mild = metricsFor(days(14, { nightMinutes: 400, bed: 1380, wake: 420 }));
    const severe = metricsFor(days(14, { nightMinutes: 300, bed: 1380, wake: 420 }));
    expect(risk(severe, "sleepDebt")!.pct).toBeGreaterThan(risk(mild, "sleepDebt")!.pct);
  });

  it("answers the catch-up question with a number of nights", () => {
    const m = metricsFor(days(14, { nightMinutes: 360, bed: 1380, wake: 420 }));
    const r = risk(m, "sleepDebt")!;
    // 14 nights an hour short is 14 hours owed, which is 14 nights of an
    // extra hour — and explicitly not one long Saturday.
    expect(r.lever).toContain("14");
    expect(r.lever).toContain("lie-in");
  });
});

describe("dehydration — in millilitres, against your own body", () => {
  const answers = { heightCm: 175, weightKg: 70 } as unknown as Answers;

  it("is zero when the target is met", () => {
    const m = metricsFor(days(14, { water: 7 }), answers);
    expect(risk(m, "dehydration", answers)!.pct).toBe(0);
  });

  it("scales with how far short the intake is", () => {
    const close = metricsFor(days(14, { water: 5 }), answers);
    const far = metricsFor(days(14, { water: 2 }), answers);
    expect(risk(far, "dehydration", answers)!.pct).toBeGreaterThan(
      risk(close, "dehydration", answers)!.pct
    );
  });

  it("says which target it used when there is no body weight", () => {
    const m = metricsFor(days(14, { water: 4 }));
    expect(risk(m, "dehydration")!.math).toContain("No body weight");
  });
});

describe("burnout — a combination that refuses to be one thing", () => {
  it("needs at least two inputs before it will say anything", () => {
    // Sleep alone is one term. One term is not a combination.
    const m = metricsFor(days(14, { nightMinutes: 300, bed: 1380, wake: 420 }));
    expect(risk(m, "burnout")).toBeNull();
  });

  it("appears once several things are being logged, and names the worst", () => {
    const m = metricsFor(
      days(14, {
        nightMinutes: 300,
        bed: 1380,
        wake: 420,
        mood: 2,
        sitting: 540,
        sittingLongest: 200,
      })
    );
    const r = risk(m, "burnout")!;
    expect(r.pct).toBeGreaterThan(40);
    expect(r.drivers.length).toBeGreaterThanOrEqual(2);
    expect(r.lever).toContain("carrying the most");
  });
});

describe("confidence is reported separately from the number", () => {
  it("calls three days low and a full fortnight good", () => {
    const thin = summarize(days(3, { sitting: 480, sittingLongest: 200 }), null, 14);
    const full = summarize(days(14, { sitting: 480, sittingLongest: 200 }), null, 14);
    expect(risk(thin, "back")!.confidence).toBe("low");
    expect(risk(full, "back")!.confidence).toBe("good");
  });
});

describe("risks are ordered worst first", () => {
  it("puts the highest percentage at the top", () => {
    const m = metricsFor(
      days(14, {
        nightMinutes: 300,
        bed: 1380,
        wake: 420,
        sitting: 600,
        sittingLongest: 240,
        water: 1,
        mood: 2,
      })
    );
    const list = risksOf(m, null, null);
    expect(list.length).toBeGreaterThan(2);
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1].pct).toBeGreaterThanOrEqual(list[i].pct);
    }
  });
});

describe("riskBand", () => {
  it("names each stretch of the scale once", () => {
    expect(riskBand(10)).toBe("low");
    expect(riskBand(30)).toBe("mild");
    expect(riskBand(50)).toBe("moderate");
    expect(riskBand(70)).toBe("high");
    expect(riskBand(95)).toBe("very high");
  });
});

describe("forecasts — straight lines, honestly labelled", () => {
  it("says nothing about weight it cannot see a trend in", () => {
    expect(forecasts(metricsFor(days(14)), null).some((f) => f.id === "weight")).toBe(
      false
    );
  });

  it("projects a weight trend once there are enough weigh-ins", () => {
    const list = days(6).map((d, i) => ({ ...d, weight: 70 + i * 0.5 }));
    const found = forecasts(metricsFor(list), null).find((f) => f.id === "weight");
    expect(found).toBeTruthy();
    expect(found!.direction).toBe("watch");
    expect(found!.detail).toContain("weigh-ins");
  });

  it("calls a movement week at the guideline good and a short one watch", () => {
    const enough = forecasts(metricsFor(days(14, { exercise: 30 })), null).find(
      (f) => f.id === "movement"
    );
    const short = forecasts(metricsFor(days(14, { exercise: 2 })), null).find(
      (f) => f.id === "movement"
    );
    expect(enough!.direction).toBe("good");
    expect(short!.direction).toBe("watch");
  });
});

/* --------------------------------- tips ---------------------------------- */

const context = (m: HealthMetrics, check: Answers | null = null) => ({
  m,
  cortisol: null,
  check,
  risks: risksOf(m, null, check),
  timings: timingsOf(m, null),
});

describe("tips are attached to numbers", () => {
  it("says nothing at all when there is nothing to say it about", () => {
    expect(tipsFor(context(metricsFor([])))).toEqual([]);
  });

  it("tells somebody with one long block to break the block", () => {
    const m = metricsFor(days(14, { sitting: 480, sittingLongest: 210 }));
    const ids = tipsFor(context(m)).map((t) => t.id);
    expect(ids).toContain("breakTheBlock");
  });

  it("does not tell somebody with short broken sessions to break them", () => {
    const m = metricsFor(days(14, { sitting: 180, sittingLongest: 40 }));
    expect(tipsFor(context(m)).map((t) => t.id)).not.toContain("breakTheBlock");
  });

  it("puts the sleep floor above everything else when the nights are short", () => {
    const m = metricsFor(
      days(14, { nightMinutes: 330, bed: 1380, wake: 420, sitting: 300, sittingLongest: 90 })
    );
    expect(tipsFor(context(m))[0].id).toBe("sleepFloor");
  });

  it("quotes the reader's own numbers rather than generic advice", () => {
    const m = metricsFor(days(14, { nightMinutes: 330, bed: 1380, wake: 420 }));
    const tip = tipsFor(context(m)).find((t) => t.id === "sleepFloor")!;
    expect(tip.why).toContain("14 nights");
    expect(tip.how).toMatch(/\d/);
  });

  it("has something good to say when a week deserves it", () => {
    const m = metricsFor(days(14, { nightMinutes: 480, bed: 1380, wake: 420 }));
    expect(tipsFor(context(m)).map((t) => t.id)).toContain("sleepSolid");
  });

  it("caps the list, because twenty pieces of advice is the same as none", () => {
    const m = metricsFor(
      days(14, {
        nightMinutes: 300,
        bed: 1380,
        wake: 420,
        sitting: 600,
        sittingLongest: 240,
        screen: 180,
        water: 1,
        junk: 2,
        mood: 2,
        exercise: 2,
        steps: 1000,
      })
    );
    expect(tipsFor(context(m)).length).toBeLessThanOrEqual(8);
  });

  it("never throws on a metric shape a tip did not expect", () => {
    // Every tip runs against an empty log without taking the page down.
    expect(() => tipsFor(context(metricsFor([])), 50)).not.toThrow();
  });
});

describe("the tip table itself", () => {
  it("has unique ids", () => {
    const ids = TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every tip an instruction and a first step", () => {
    for (const tip of TIPS) {
      expect(tip.title.length, tip.id).toBeGreaterThan(5);
      expect(tip.topic.length, tip.id).toBeGreaterThan(0);
    }
  });
});

describe("no tip ever prints a value it does not have", () => {
  const scan = (tip: { id: string; why: string; how: string }) => {
    for (const text of [tip.why, tip.how]) {
      expect(text, `${tip.id}: ${text}`).not.toMatch(/null/);
      expect(text, `${tip.id}: ${text}`).not.toMatch(/NaN/);
      expect(text, `${tip.id}: ${text}`).not.toMatch(/undefined/);
    }
  };

  it("holds for heavy sitting with no movement tracker at all", () => {
    // This printed "with null minutes of movement a week" — and worse, it
    // was scoring an input nobody logs as if it were a zero.
    const m = metricsFor(days(14, { sitting: 540, sittingLongest: 200 }));
    const tips = tipsFor(context(m), 50);
    expect(tips.map((t) => t.id)).toContain("walkOffset");
    tips.forEach(scan);
  });

  it("holds across a spread of awkward logs", () => {
    const shapes: Partial<HealthDay>[] = [
      {},
      { nightMinutes: 300, bed: 1380, wake: 420 },
      { sitting: 600, sittingLongest: 300, screen: 200 },
      { water: 1, junk: 3, mood: 1 },
      { exercise: 5, steps: 400 },
      { nightMinutes: 480, bed: 1380, wake: 420, sitting: 200, sittingLongest: 50 },
      { stress: 5, energy: 1 },
      { cleanHeld: 1, meditation: 10, outdoors: 20 },
    ];
    for (const shape of shapes) {
      const m = metricsFor(days(14, shape));
      tipsFor(context(m), 50).forEach(scan);
      for (const risk of risksOf(m, null, null)) {
        for (const text of [risk.headline, risk.math, risk.lever]) {
          expect(text, `${risk.id}: ${text}`).not.toMatch(/null|NaN|undefined/);
        }
        risk.drivers.forEach((d) =>
          expect(d.value, `${risk.id}/${d.label}`).not.toMatch(/null|NaN|undefined/)
        );
      }
      for (const f of forecasts(m, null)) {
        expect(`${f.headline} ${f.detail}`).not.toMatch(/null|NaN|undefined/);
      }
    }
  });
});

describe("recovery is the one term that lowers burnout by being present", () => {
  it("reads a week with daylight and breathing in it as less pressure", () => {
    const base = { nightMinutes: 330, bed: 1380, wake: 420, mood: 2, stress: 4 };
    const without = risk(metricsFor(days(14, base)), "burnout");
    const withRecovery = risk(
      metricsFor(days(14, { ...base, outdoors: 25, meditation: 10 })),
      "burnout"
    );
    expect(without).toBeTruthy();
    expect(withRecovery!.pct).toBeLessThan(without!.pct);
    expect(withRecovery!.drivers.some((d) => d.label === "Recovery days")).toBe(true);
  });
});
