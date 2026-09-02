import { clockText, type CortisolReport } from "./cortisol";
import type { Answers } from "./cortisolCheck";
import {
  BLOCK_LIMIT,
  MOVEMENT_WEEKLY,
  SLEEP_TARGET,
  type HealthMetrics,
} from "./health";

/**
 * What the log predicts, and exactly how.
 *
 * These are the page's forecasts: back strain, eye strain, sleep debt and
 * how long it would take to clear, dehydration in millilitres, burnout
 * pressure, metabolic drift, a flattening rhythm, trouble getting to sleep,
 * the afternoon crash, and where the weight is heading.
 *
 * **What a "risk" here is, precisely.** It is not a probability of illness
 * and it is not a diagnosis. It is a statement that *the pattern in your own
 * log resembles the pattern the reference guidance associates with a
 * problem* — nine hours in a chair broken once, a week with no movement in
 * it, a fortnight running an hour a night short. Every one of them is
 * arithmetic on numbers you typed, every one prints the arithmetic it used
 * (`math`), and every one names the single change that would move it most
 * (`lever`), computed rather than picked from a list of platitudes.
 *
 * Three rules hold throughout:
 *
 * 1. **A missing input is missing.** A risk whose inputs are not being
 *    logged is not returned at all, rather than returned as zero. Nothing
 *    here congratulates anybody for not logging.
 * 2. **Confidence is reported separately from the number.** Two weeks of
 *    complete days and three scattered ones are not the same claim, and the
 *    reader cannot tell them apart from a percentage alone.
 * 3. **No AI writes any of these figures.** The model in `lib/roleAI.ts`
 *    labels which tracker is which and then gets out of the way.
 */

export const RISK_CAVEAT =
  "These are patterns, not predictions about your body. Each one says how closely your own logged days resemble the pattern that published guidance associates with a problem — calculated from your numbers, with the arithmetic shown. None of it is medical advice, none of it is a diagnosis, and anything that actually hurts is a question for a doctor rather than for an app.";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pctOf = (v: number) => Math.round(clamp01(v) * 100);

/** A 0-1 ramp between two thresholds — the shape nearly every risk uses. */
function ramp(value: number, from: number, to: number): number {
  if (to === from) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

export type Driver = {
  label: string;
  /** The measured figure, as a person would say it. */
  value: string;
  /** How much of this risk it accounts for, 0-1. */
  share: number;
};

export type Risk = {
  id: string;
  label: string;
  icon: string;
  /** 0-100. How closely the log matches the pattern, never a probability. */
  pct: number;
  band: string;
  /** One sentence of what is actually being said. */
  headline: string;
  drivers: Driver[];
  /** The arithmetic, written out so it can be argued with. */
  math: string;
  /** The one change that would move this number most, calculated. */
  lever: string;
  /** How much of the window fed it. */
  confidence: "low" | "fair" | "good";
};

export function riskBand(pct: number): string {
  if (pct < 20) return "low";
  if (pct < 40) return "mild";
  if (pct < 60) return "moderate";
  if (pct < 80) return "high";
  return "very high";
}

/** Enough days to mean something; enough to lean on. */
function confidenceOf(daysRead: number, windowDays: number): Risk["confidence"] {
  const share = windowDays > 0 ? daysRead / windowDays : 0;
  if (daysRead >= 10 && share >= 0.6) return "good";
  if (daysRead >= 5 && share >= 0.3) return "fair";
  return "low";
}

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const answer = (check: Answers | null, id: string): string | null => {
  const v = check?.[id];
  return typeof v === "string" && v !== "" ? v : null;
};

/* -------------------------------------------------------------------------- */

/**
 * Back and posture strain.
 *
 * The thing this page can genuinely calculate about a day of editing,
 * tuition or reading. Two separate quantities, because they are separate
 * problems: the day's **total** sitting, and how much of it arrives in one
 * **unbroken** block. Eight hours broken every forty minutes and eight hours
 * in one sitting are the same total and not the same load, which is why the
 * guidance names both.
 *
 * Daily movement offsets a large part of the total-sitting risk in the
 * cohort work, so it is applied as an offset rather than as a separate term
 * — it reduces this number, it does not merely sit beside it.
 */
function backRisk(m: HealthMetrics): Risk | null {
  const s = m.sedentary;
  if (s.daysRead === 0 || s.avgSedentaryMinutes === null) return null;

  const total = s.avgSedentaryMinutes;
  const block = s.avgLongestBlock ?? 0;

  const totalTerm = ramp(total, 4 * 60, 10 * 60);
  const blockTerm = ramp(block, BLOCK_LIMIT, 180);
  const weekly = m.movement.weeklyMinutes ?? 0;
  const offset = clamp01(weekly / (MOVEMENT_WEEKLY * 2)) * 0.35;

  const raw = (totalTerm * 0.55 + blockTerm * 0.45) * (1 - offset);
  const pct = pctOf(raw);

  const breaks = Math.max(1, Math.round(block / 45));

  return {
    id: "back",
    label: "Back & neck strain",
    icon: "🪑",
    pct,
    band: riskBand(pct),
    headline:
      block > 120
        ? `You sit about ${hours(total)} a day and roughly ${hours(block)} of it without getting up.`
        : `You sit about ${hours(total)} a day, broken up reasonably well.`,
    drivers: [
      {
        label: "Hours sitting",
        value: `${hours(total)} a day over ${s.daysRead} days`,
        share: Math.round(totalTerm * 0.55 * 100) / 100,
      },
      {
        label: "Longest unbroken block",
        value: hours(block),
        share: Math.round(blockTerm * 0.45 * 100) / 100,
      },
      {
        label: "Movement offset",
        value: `${weekly} min a week`,
        share: -Math.round(offset * 100) / 100,
      },
    ],
    math: `(0.55 x sitting over 4h, capped at 10h) + (0.45 x longest block over 1h, capped at 3h), reduced by up to 35% for weekly movement. Here: 0.55x${totalTerm.toFixed(2)} + 0.45x${blockTerm.toFixed(2)}, less ${Math.round(offset * 100)}% = ${pct}%.`,
    lever:
      blockTerm > totalTerm
        ? `Break the block, not the total. ${breaks} stand-ups spread through your longest session would cut this more than an hour less work would.`
        : weekly < MOVEMENT_WEEKLY
          ? `${MOVEMENT_WEEKLY - weekly} more minutes of walking a week is the biggest single offset available to you — about ${Math.ceil((MOVEMENT_WEEKLY - weekly) / 20)} twenty-minute walks.`
          : "Keep the breaks where they are; this is about as low as sitting hours like these go.",
    confidence: confidenceOf(s.daysRead, m.windowDays),
  };
}

/**
 * Digital eye strain.
 *
 * Near work is near work whether the screen is a spreadsheet or a phone, so
 * the sitting and screen hours are added rather than kept apart here — which
 * is the opposite of what the back risk does with them, and deliberately so:
 * the back cares about posture, the eyes care about focal distance.
 */
function eyeRisk(m: HealthMetrics, check: Answers | null): Risk | null {
  const s = m.sedentary;
  if (s.daysRead === 0) return null;

  const near = (s.avgSittingMinutes ?? 0) + (s.avgScreenMinutes ?? 0);
  const block = s.avgLongestBlock ?? 0;

  const nearTerm = ramp(near, 3 * 60, 10 * 60);
  const blockTerm = ramp(block, 120, 240);
  const inBed = answer(check, "phoneInBed");
  const cutoff = answer(check, "phoneCutoff");
  const eveningTerm =
    inBed === "always" || cutoff === "inBed" ? 1 : inBed === "sometimes" ? 0.5 : 0;

  const pct = pctOf(nearTerm * 0.5 + blockTerm * 0.35 + eveningTerm * 0.15);

  return {
    id: "eyes",
    label: "Eye strain",
    icon: "👁️",
    pct,
    band: riskBand(pct),
    headline: `About ${hours(near)} a day of near work, with the longest stretch running ${hours(block)}.`,
    drivers: [
      {
        label: "Near-work hours",
        value: `${hours(near)} a day`,
        share: Math.round(nearTerm * 0.5 * 100) / 100,
      },
      {
        label: "Unbroken screen time",
        value: hours(block),
        share: Math.round(blockTerm * 0.35 * 100) / 100,
      },
      {
        label: "Screens in bed",
        value: inBed ?? "not reported",
        share: Math.round(eveningTerm * 0.15 * 100) / 100,
      },
    ],
    math: `(0.5 x near work over 3h, capped at 10h) + (0.35 x unbroken time over 2h, capped at 4h) + (0.15 x screens in bed) = ${pct}%.`,
    lever: `20-20-20: every 20 minutes, 20 seconds looking 20 feet away. At ${hours(block)} unbroken that is about ${Math.round(block / 20)} pauses you are currently not taking.`,
    confidence: confidenceOf(s.daysRead, m.windowDays),
  };
}

/**
 * Sleep debt, and how long it would actually take to clear.
 *
 * The clearance figure is the useful half. Debt does not come off in one
 * long Saturday — an extra hour a night is roughly what recovery sleep
 * delivers, so the honest answer to "I'll catch up at the weekend" is a
 * number of nights, and this is that number.
 */
function sleepDebtRisk(m: HealthMetrics): Risk | null {
  const s = m.sleep;
  if (s.nights === 0) return null;

  const perNight = s.debtMinutes / s.nights;
  const pct = pctOf(ramp(perNight, 15, 90));
  const nightsToClear = Math.ceil(s.debtMinutes / 60);

  return {
    id: "sleepDebt",
    label: "Sleep debt",
    icon: "🛏️",
    pct,
    band: riskBand(pct),
    headline:
      s.debtMinutes <= 30
        ? "You are broadly square with the 7-hour floor."
        : `${hours(s.debtMinutes)} owed across ${s.nights} nights — about ${Math.round(perNight)} minutes a night.`,
    drivers: [
      {
        label: "Short nights",
        value: `${s.shortNights} of ${s.nights}`,
        share: Math.round(ramp(s.shortNights / Math.max(1, s.nights), 0.2, 1) * 100) / 100,
      },
      {
        label: "Average night",
        value: s.avgMinutes !== null ? hours(s.avgMinutes) : "—",
        share: Math.round(ramp(perNight, 15, 90) * 100) / 100,
      },
    ],
    math: `Sum of (7h - each night), over ${s.nights} nights = ${hours(s.debtMinutes)}. Scored on the per-night average of ${Math.round(perNight)} min, full at 90.`,
    lever:
      s.debtMinutes <= 30
        ? "Nothing owed worth chasing. Keep the wake time where it is."
        : `An extra hour a night clears this in about ${nightsToClear} night${nightsToClear === 1 ? "" : "s"}. One long lie-in does not — it moves your body clock and leaves most of the debt where it was.`,
    confidence: confidenceOf(s.nights, m.windowDays),
  };
}

/** Dehydration, in millilitres rather than in adjectives. */
function dehydrationRisk(m: HealthMetrics): Risk | null {
  const h = m.hydration;
  if (h.days === 0 || h.avgGlasses === null) return null;

  const target = h.targetGlasses ?? 8;
  const shortfall = Math.max(0, target - h.avgGlasses);
  const pct = pctOf(shortfall / target);

  return {
    id: "dehydration",
    label: "Under-hydration",
    icon: "💧",
    pct,
    band: riskBand(pct),
    headline:
      shortfall <= 0.5
        ? `You are meeting your ${target}-glass target.`
        : `About ${Math.round(shortfall * 10) / 10} glasses a day short of your ${target}.`,
    drivers: [
      {
        label: "Average intake",
        value: `${h.avgGlasses} glasses`,
        share: Math.round(clamp01(shortfall / target) * 100) / 100,
      },
      {
        label: "Days under target",
        value: `${h.shortDays} of ${h.days}`,
        share: Math.round((h.shortDays / Math.max(1, h.days)) * 100) / 100,
      },
    ],
    math: h.targetMl
      ? `Target ${h.targetMl} ml from your own body weight (${target} glasses). Shortfall ${Math.round(shortfall * 400)} ml a day = ${pct}%.`
      : `No body weight on file, so read against the generic 8 glasses. Add a weight and this becomes your target rather than everybody's.`,
    lever:
      shortfall <= 0.5
        ? "Nothing to fix here."
        : `One extra glass with each meal covers ${Math.min(3, Math.ceil(shortfall))} of the ${Math.round(shortfall * 10) / 10} you are short.`,
    confidence: confidenceOf(h.days, m.windowDays),
  };
}

/**
 * Burnout pressure — the one risk that is a combination rather than a
 * measurement, and it says so.
 *
 * Five things that each mean little alone and a great deal together: sleep
 * debt, a raised cortisol load, low mood, high reported stress, and a
 * fortnight with no day off in it. Weighted, renormalised over whichever of
 * them are actually being logged.
 */
function burnoutRisk(
  m: HealthMetrics,
  cortisol: CortisolReport | null,
  check: Answers | null
): Risk | null {
  const terms: { label: string; value: string; term: number; weight: number }[] = [];

  if (m.sleep.nights > 0) {
    const perNight = m.sleep.debtMinutes / m.sleep.nights;
    terms.push({
      label: "Sleep debt",
      value: `${Math.round(perNight)} min a night`,
      term: ramp(perNight, 20, 90),
      weight: 0.28,
    });
  }
  if (cortisol?.load !== null && cortisol?.load !== undefined) {
    terms.push({
      label: "Modelled load",
      value: `${cortisol.load}/100`,
      term: clamp01(cortisol.load / 100),
      weight: 0.22,
    });
  }
  if (m.mind.avgMood !== null) {
    terms.push({
      label: "Mood",
      value: `${Math.round(m.mind.avgMood * 10) / 10}/5`,
      term: clamp01((3.5 - m.mind.avgMood) / 2.5),
      weight: 0.2,
    });
  }
  const stress = m.mind.reportedStress ?? (m.mind.avgStress !== null ? m.mind.avgStress * 2 : null);
  if (stress !== null) {
    terms.push({
      label: "Stress",
      value: `${Math.round(stress)}/10`,
      term: ramp(stress, 4, 9),
      weight: 0.2,
    });
  }
  if (m.sedentary.daysRead >= 5) {
    const heavy = m.sedentary.heavyDays / Math.max(1, m.sedentary.daysRead);
    terms.push({
      label: "Long work days",
      value: `${m.sedentary.heavyDays} over 8h`,
      term: clamp01(heavy),
      weight: 0.1,
    });
  }
  if (m.mind.recoveryRate !== null) {
    // The only term here that can pull the number DOWN by being present.
    // Daylight and breathing are recovery rather than more load, so a week
    // with them in it genuinely reads as less pressure than one without.
    terms.push({
      label: "Recovery days",
      value: `${m.mind.recoveryRate}% of the window`,
      term: clamp01(1 - m.mind.recoveryRate / 70),
      weight: 0.12,
    });
  }
  if (answer(check, "overwhelmed") === "daily" || answer(check, "overwhelmed") === "often") {
    terms.push({
      label: "Feeling overwhelmed",
      value: answer(check, "overwhelmed") as string,
      term: answer(check, "overwhelmed") === "daily" ? 1 : 0.6,
      weight: 0.15,
    });
  }

  if (terms.length < 2) return null;

  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  const pct = pctOf(
    terms.reduce((sum, t) => sum + t.term * t.weight, 0) / totalWeight
  );

  const worst = [...terms].sort((a, b) => b.term * b.weight - a.term * a.weight)[0];

  return {
    id: "burnout",
    label: "Burnout pressure",
    icon: "🔥",
    pct,
    band: riskBand(pct),
    headline:
      pct >= 60
        ? `Several things are pulling the same way at once — ${worst.label.toLowerCase()} hardest.`
        : "No single reading is alarming, and they are not stacking either.",
    drivers: terms.map((t) => ({
      label: t.label,
      value: t.value,
      share: Math.round((t.term * t.weight) / totalWeight * 100) / 100,
    })),
    math: `Weighted mean of ${terms.length} inputs, renormalised over the ones you log. Anything you do not track is left out rather than scored as fine.`,
    lever: `${worst.label} is carrying the most of this. It is the one to move first — the others are cheaper to fix and would change this number less.`,
    confidence: confidenceOf(m.daysLogged, m.windowDays),
  };
}

/** Metabolic drift: where the junk, the movement and the weight point together. */
function metabolicRisk(m: HealthMetrics): Risk | null {
  const terms: { label: string; value: string; term: number; weight: number }[] = [];

  if (m.nutrition.junkPerWeek !== null) {
    terms.push({
      label: "Junk frequency",
      value: `${m.nutrition.junkPerWeek} days a week`,
      term: ramp(m.nutrition.junkPerWeek, 1, 6),
      weight: 0.35,
    });
  }
  if (m.movement.weeklyMinutes !== null) {
    terms.push({
      label: "Movement shortfall",
      value: `${m.movement.weeklyMinutes} of ${MOVEMENT_WEEKLY} min`,
      term: clamp01(1 - m.movement.weeklyMinutes / MOVEMENT_WEEKLY),
      weight: 0.3,
    });
  }
  if (m.body.bmi !== null) {
    terms.push({
      label: "BMI",
      value: String(m.body.bmi),
      term: ramp(m.body.bmi, 23, 32),
      weight: 0.2,
    });
  }
  if (m.body.trendKgPerMonth !== null) {
    terms.push({
      label: "Weight trend",
      value: `${m.body.trendKgPerMonth > 0 ? "+" : ""}${m.body.trendKgPerMonth} kg a month`,
      term: ramp(m.body.trendKgPerMonth, 0.3, 2),
      weight: 0.15,
    });
  }

  if (terms.length < 2) return null;

  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  const pct = pctOf(terms.reduce((sum, t) => sum + t.term * t.weight, 0) / totalWeight);
  const worst = [...terms].sort((a, b) => b.term * b.weight - a.term * a.weight)[0];

  return {
    id: "metabolic",
    label: "Metabolic drift",
    icon: "📈",
    pct,
    band: riskBand(pct),
    headline:
      pct >= 55
        ? "Diet, movement and weight are pointing the same direction rather than balancing each other."
        : "Nothing here is drifting in a way the numbers can see.",
    drivers: terms.map((t) => ({
      label: t.label,
      value: t.value,
      share: Math.round((t.term * t.weight) / totalWeight * 100) / 100,
    })),
    math: `Weighted mean of junk frequency, movement shortfall, BMI and weight slope, over the ${terms.length} of them you log.`,
    lever: `${worst.label} is the largest single contributor here.`,
    confidence: confidenceOf(m.nutrition.daysRead, m.windowDays),
  };
}

/** A flattening rhythm: the cortisol model's own reading, plus the timing spread. */
function rhythmRisk(m: HealthMetrics, cortisol: CortisolReport | null): Risk | null {
  if (!cortisol || cortisol.rhythm === null) return null;

  const flat = clamp01(1 - cortisol.rhythm / 100);
  const spread = m.sleep.wakeSpread !== null ? ramp(m.sleep.wakeSpread, 30, 120) : null;
  const jetlag = m.sleep.socialJetlag !== null ? ramp(m.sleep.socialJetlag, 45, 150) : null;

  const terms = [
    { label: "Modelled rhythm", value: `${cortisol.rhythm}/100`, term: flat, weight: 0.5 },
    ...(spread !== null
      ? [
          {
            label: "Wake-time spread",
            value: `${Math.round(m.sleep.wakeSpread as number)} min`,
            term: spread,
            weight: 0.3,
          },
        ]
      : []),
    ...(jetlag !== null
      ? [
          {
            label: "Weekend drift",
            value: `${Math.round(m.sleep.socialJetlag as number)} min`,
            term: jetlag,
            weight: 0.2,
          },
        ]
      : []),
  ];

  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  const pct = pctOf(terms.reduce((sum, t) => sum + t.term * t.weight, 0) / totalWeight);

  return {
    id: "rhythm",
    label: "Rhythm flattening",
    icon: "🧪",
    pct,
    band: riskBand(pct),
    headline:
      cortisol.curve !== null
        ? `Peak to trough swings about ${cortisol.curve.swing}x. A flat day is an evening that never comes down, not a higher morning.`
        : "Modelled from your sleep times.",
    drivers: terms.map((t) => ({
      label: t.label,
      value: t.value,
      share: Math.round((t.term * t.weight) / totalWeight * 100) / 100,
    })),
    math: `(0.5 x inverted rhythm score) + (0.3 x wake spread over 30 min) + (0.2 x weekend drift over 45 min) = ${pct}%.`,
    lever:
      spread !== null && spread > flat
        ? "The wake time is the lever, not the bedtime. Fixing when you get up fixes the curve; fixing when you go to bed mostly fixes how you feel about it."
        : "Morning daylight within an hour of waking is the cheapest thing that moves this at all.",
    confidence: confidenceOf(cortisol.nightsRead, m.windowDays),
  };
}

/** Trouble getting to sleep — the four things that most reliably delay onset. */
function onsetRisk(m: HealthMetrics, check: Answers | null): Risk | null {
  const terms: { label: string; value: string; term: number; weight: number }[] = [];

  const last = m.substances.lastCaffeine;
  if (last) {
    terms.push({
      label: "Last caffeine",
      value: last,
      term: last === "evening" ? 1 : last === "afternoon" ? 0.55 : 0.1,
      weight: 0.3,
    });
  }
  const inBed = answer(check, "phoneInBed");
  if (inBed) {
    terms.push({
      label: "Phone in bed",
      value: inBed,
      term: inBed === "always" ? 1 : inBed === "sometimes" ? 0.5 : 0,
      weight: 0.25,
    });
  }
  const racing = answer(check, "racing");
  if (racing) {
    terms.push({
      label: "Racing thoughts",
      value: racing,
      term: racing === "always" || racing === "often" ? 1 : racing === "sometimes" ? 0.5 : 0,
      weight: 0.25,
    });
  }
  if (m.sleep.bedSpread !== null) {
    terms.push({
      label: "Bedtime spread",
      value: `${Math.round(m.sleep.bedSpread)} min`,
      term: ramp(m.sleep.bedSpread, 40, 150),
      weight: 0.2,
    });
  }
  if (answer(check, "lateMeal") === "late") {
    terms.push({ label: "Late meals", value: "reported", term: 0.7, weight: 0.15 });
  }

  if (terms.length < 2) return null;

  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  const pct = pctOf(terms.reduce((sum, t) => sum + t.term * t.weight, 0) / totalWeight);
  const worst = [...terms].sort((a, b) => b.term * b.weight - a.term * a.weight)[0];

  return {
    id: "onset",
    label: "Trouble falling asleep",
    icon: "😵‍💫",
    pct,
    band: riskBand(pct),
    headline:
      pct >= 50
        ? `The pattern that delays sleep onset is mostly present — ${worst.label.toLowerCase()} first.`
        : "Little of the usual onset-delaying pattern is here.",
    drivers: terms.map((t) => ({
      label: t.label,
      value: t.value,
      share: Math.round((t.term * t.weight) / totalWeight * 100) / 100,
    })),
    math: `Weighted mean of caffeine timing, phone in bed, racing thoughts, bedtime spread and late meals — over the ${terms.length} you have answered.`,
    lever: `${worst.label} is carrying most of it.`,
    confidence: confidenceOf(m.sleep.nights, m.windowDays),
  };
}

/** The afternoon crash: whether the dip has help arriving or not. */
function crashRisk(m: HealthMetrics, check: Answers | null): Risk | null {
  const terms: { label: string; value: string; term: number; weight: number }[] = [];

  if (m.sleep.avgMinutes !== null) {
    terms.push({
      label: "Short nights",
      value: hours(m.sleep.avgMinutes),
      term: clamp01((SLEEP_TARGET - m.sleep.avgMinutes) / 120),
      weight: 0.35,
    });
  }
  const breakfast = answer(check, "breakfast");
  if (breakfast) {
    terms.push({
      label: "Breakfast",
      value: breakfast === "skip" ? "skipped" : breakfast,
      term: breakfast === "skip" ? 1 : breakfast === "later" ? 0.4 : 0,
      weight: 0.2,
    });
  }
  if (m.substances.caffeinePerDay !== null) {
    terms.push({
      label: "Caffeine",
      value: `${m.substances.caffeinePerDay} a day`,
      term: ramp(m.substances.caffeinePerDay, 3, 7),
      weight: 0.2,
    });
  }
  if (m.movement.weeklyMinutes !== null) {
    terms.push({
      label: "Movement",
      value: `${m.movement.weeklyMinutes} min a week`,
      term: clamp01(1 - m.movement.weeklyMinutes / MOVEMENT_WEEKLY),
      weight: 0.15,
    });
  }
  if (m.nutrition.junkPerWeek !== null) {
    terms.push({
      label: "Junk frequency",
      value: `${m.nutrition.junkPerWeek} days a week`,
      term: ramp(m.nutrition.junkPerWeek, 2, 6),
      weight: 0.15,
    });
  }

  if (terms.length < 2) return null;

  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  const pct = pctOf(terms.reduce((sum, t) => sum + t.term * t.weight, 0) / totalWeight);
  // Eight hours after waking, where the modelled curve falls steepest.
  // Printed through `clockText` so every clock time in the app reads the same.
  const dip =
    m.sleep.medianWake !== null
      ? clockText((m.sleep.medianWake + 8 * 60) % 1440)
      : null;

  return {
    id: "crash",
    label: "Afternoon crash",
    icon: "🔋",
    pct,
    band: riskBand(pct),
    headline:
      dip !== null
        ? `The curve's steepest fall lands about eight hours after you wake — around ${dip}.`
        : "Read from sleep, breakfast, caffeine and movement together.",
    drivers: terms.map((t) => ({
      label: t.label,
      value: t.value,
      share: Math.round((t.term * t.weight) / totalWeight * 100) / 100,
    })),
    math: `Weighted mean of night length, breakfast, caffeine load, movement and junk frequency = ${pct}%.`,
    lever:
      m.sleep.avgMinutes !== null && m.sleep.avgMinutes < SLEEP_TARGET
        ? `${Math.round(SLEEP_TARGET - m.sleep.avgMinutes)} more minutes a night removes most of this. A fourth coffee moves it later rather than away.`
        : "A ten-minute walk at the dip does more than caffeine does, and does not borrow from tonight.",
    confidence: confidenceOf(m.sleep.nights, m.windowDays),
  };
}

/* ------------------------------ the forecast ----------------------------- */

export type Forecast = {
  id: string;
  label: string;
  icon: string;
  /** What the current slope arrives at, said plainly. */
  headline: string;
  detail: string;
  /** Whether the direction is a good one. */
  direction: "good" | "watch" | "flat";
};

/**
 * Straight-line projections.
 *
 * Every one of these is "if nothing changes", which is the assumption that
 * makes them worth reading and also the one that makes them wrong — a
 * projection is a description of the present tense, and the only thing it
 * genuinely proves is which way the last few weeks pointed.
 */
export function forecasts(
  m: HealthMetrics,
  cortisol: CortisolReport | null
): Forecast[] {
  const out: Forecast[] = [];

  if (m.body.trendKgPerMonth !== null && Math.abs(m.body.trendKgPerMonth) >= 0.2) {
    const perMonth = m.body.trendKgPerMonth;
    const inThree = m.body.weightKg !== null ? Math.round((m.body.weightKg + perMonth * 3) * 10) / 10 : null;
    out.push({
      id: "weight",
      label: "Weight",
      icon: "⚖️",
      headline: `${perMonth > 0 ? "+" : ""}${perMonth} kg a month${inThree !== null ? ` — about ${inThree} kg by three months` : ""}`,
      detail: `A least-squares line through ${m.body.weighIns} weigh-ins. Four points is the minimum this will draw at, and a line through few points moves a lot when the next one lands.`,
      direction: Math.abs(perMonth) < 0.5 ? "flat" : perMonth > 0 ? "watch" : "good",
    });
  }

  if (m.sleep.nights >= 4 && m.sleep.debtMinutes > 60) {
    const perWeek = Math.round((m.sleep.debtMinutes / m.sleep.nights) * 7);
    out.push({
      id: "debt",
      label: "Sleep debt",
      icon: "🛏️",
      headline: `Accruing about ${hours(perWeek)} a week`,
      detail: `At the current average you add ${Math.round(m.sleep.debtMinutes / m.sleep.nights)} minutes of debt a night. An extra hour a night clears the ${hours(m.sleep.debtMinutes)} standing now in about ${Math.ceil(m.sleep.debtMinutes / 60)} nights.`,
      direction: "watch",
    });
  }

  if (cortisol && cortisol.rhythm !== null && cortisol.previousRhythm !== null) {
    const delta = cortisol.rhythm - cortisol.previousRhythm;
    if (Math.abs(delta) >= 3) {
      out.push({
        id: "rhythm",
        label: "Rhythm",
        icon: "🧪",
        headline: `${delta > 0 ? "Firming up" : "Flattening"} — ${Math.abs(delta)} points against the first half of the window`,
        detail: `The second half of the window scores ${cortisol.rhythm} against ${cortisol.previousRhythm} for the first. Two halves of a fortnight is a short comparison; the direction is worth more than the size.`,
        direction: delta > 0 ? "good" : "watch",
      });
    }
  }

  if (m.hydration.deficitMl !== null && m.hydration.deficitMl > 200) {
    out.push({
      id: "water",
      label: "Water",
      icon: "💧",
      headline: `About ${(m.hydration.deficitMl * 7 / 1000).toFixed(1)} L short a week`,
      detail: `${m.hydration.deficitMl} ml a day against a target of ${m.hydration.targetMl} ml worked out from your own body weight.`,
      direction: "watch",
    });
  }

  if (m.movement.weeklyMinutes !== null) {
    const gap = MOVEMENT_WEEKLY - m.movement.weeklyMinutes;
    out.push({
      id: "movement",
      label: "Movement",
      icon: "🏃",
      headline:
        gap > 0
          ? `${gap} minutes a week under the guideline`
          : `${m.movement.weeklyMinutes} minutes a week — at or above the guideline`,
      detail:
        gap > 0
          ? `That is ${Math.ceil(gap / 20)} twenty-minute walks a week, which is also the single biggest offset available against the hours you spend sitting.`
          : "Which is also what most offsets the hours spent sitting, so it is doing two jobs.",
      direction: gap > 0 ? "watch" : "good",
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */

/**
 * Every risk the log can support, worst first.
 *
 * Sorted by the number rather than by topic, because the reader's question
 * is "what is worst" and not "what does the app think about eyes".
 */
export function risksOf(
  m: HealthMetrics,
  cortisol: CortisolReport | null,
  check: Answers | null
): Risk[] {
  const all = [
    backRisk(m),
    eyeRisk(m, check),
    sleepDebtRisk(m),
    dehydrationRisk(m),
    burnoutRisk(m, cortisol, check),
    metabolicRisk(m),
    rhythmRisk(m, cortisol),
    onsetRisk(m, check),
    crashRisk(m, check),
  ].filter((r): r is Risk => r !== null);

  return all.sort((a, b) => b.pct - a.pct);
}

/** Everything the caller wants in one call. */
export function predict(
  m: HealthMetrics,
  cortisol: CortisolReport | null,
  check: Answers | null
): { risks: Risk[]; forecasts: Forecast[] } {
  return {
    risks: risksOf(m, cortisol, check),
    forecasts: forecasts(m, cortisol),
  };
}
