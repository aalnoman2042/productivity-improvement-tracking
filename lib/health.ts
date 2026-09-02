import { bmiOf, type Answers } from "./cortisolCheck";
import {
  buildCurve,
  clockText,
  dailyMean,
  type CortisolReport,
} from "./cortisol";
import { GLASS_ML, ML_PER_KG_MAX, waterNeed } from "./water";

/**
 * The health page's arithmetic.
 *
 * The cortisol model in `lib/cortisol.ts` answers one question well. This
 * answers the rest of them: how much of the sleep you need you are actually
 * getting, how far off your own water target you are, whether a week has 150
 * minutes of movement in it, how many hours a day you spend in a chair and
 * how much of that is unbroken, what your BMI is, whether the coffee is
 * landing too late to leave the system before bed.
 *
 * **Everything here is arithmetic, and every reference is written down.**
 * That is the difference between this page and a wellness app: the number is
 * always shown next to the band it is being judged against, and the band is
 * always shown next to where it came from. A score of 62 with no reference
 * beside it is a mood, not a measurement.
 *
 * It is **not medical advice and cannot be.** These are population reference
 * ranges applied to numbers you typed. A reference range is a description of
 * most people; it is not a diagnosis of you, it does not know your history,
 * and the page says so above the fold rather than in a footer.
 *
 * A missing input is **reported missing and dropped from the weighting** —
 * never scored as a good day. `lib/trackerRoles.ts` is what finds the inputs
 * in the first place, because the trackers are named by the person who keeps
 * them and no two people name them the same way.
 */

/* ---------------------------- reference values --------------------------- */

export type Reference = {
  id: string;
  label: string;
  /** The band itself, as a person would say it. */
  band: string;
  /** Where the number comes from. Shown on the page — no unsourced bands. */
  note: string;
};

/**
 * Every band this file judges against, in one table, printed on the page.
 *
 * Kept as data for the same reason the check-up's questions are: the number
 * used in the arithmetic and the number shown to the reader have to be the
 * same number, and the only way to guarantee that is to have one of them.
 */
export const REFERENCES: Reference[] = [
  {
    id: "sleepDuration",
    label: "Sleep, adults",
    band: "7-9 hours a night",
    note: "The consensus recommendation for adults 18-64. Under 7 is where the measurable costs start showing up in the literature; over 9 regularly is worth a look of its own.",
  },
  {
    id: "sleepRegularity",
    label: "Wake-time steadiness",
    band: "within about 30 minutes, day to day",
    note: "Sleep-timing variability tracks a flatter cortisol slope independently of how long you slept. An hour of drift is the point where studies start calling it irregular.",
  },
  {
    id: "socialJetlag",
    label: "Weekend drift",
    band: "under 1 hour",
    note: "The gap between your weekday and weekend sleep midpoint. Two hours is a time zone you fly to every Friday and back from every Monday.",
  },
  {
    id: "water",
    label: "Water",
    band: `${ML_PER_KG_MAX} ml per kg of body weight, plus sweat`,
    note: `Worked out from your own weight rather than the eight-glasses rule, and counted in glasses of ${GLASS_ML} ml. About a fifth of your daily water normally arrives in food.`,
  },
  {
    id: "movement",
    label: "Movement",
    band: "150-300 minutes a week, moderate",
    note: "The WHO adult activity guideline. Half of it is where most of the benefit already is; none of it is the risk factor, not the missing half.",
  },
  {
    id: "steps",
    label: "Steps",
    band: "about 7,000 a day",
    note: "Where most of the mortality benefit has levelled off in recent cohort work — rather lower than the 10,000 that came from a 1960s pedometer's brand name.",
  },
  {
    id: "sitting",
    label: "Sitting",
    band: "under 8 hours a day, broken every 30-60 minutes",
    note: "Sitting over 8 hours a day carries a risk that 30-40 minutes of daily activity largely offsets. The break matters separately from the total: an unbroken block is its own load on the back.",
  },
  {
    id: "screenBreaks",
    label: "Screen breaks",
    band: "20-20-20 — every 20 minutes, 20 seconds, 20 feet away",
    note: "The standard optometric guidance for near-work. Continuous screen work beyond about 2 hours is where digital eye strain symptoms usually begin.",
  },
  {
    id: "bmi",
    label: "BMI",
    band: "18.5-24.9 (18.5-22.9 on South Asian cut-offs)",
    note: "WHO recommends lower cut-offs for South and East Asian populations, where the same BMI carries more metabolic risk. Both are shown because both are true depending on who is reading.",
  },
  {
    id: "caffeine",
    label: "Caffeine",
    band: "under 400 mg a day, none within 6 hours of bed",
    note: "400 mg taken 6 hours before bed measurably shortened sleep in controlled trials — the dose you notice and the dose that costs you sleep are different doses.",
  },
  {
    id: "screenCutoff",
    label: "Screens before bed",
    band: "off about an hour before",
    note: "Evening screen use is associated with a blunted cortisol awakening response the next morning, which is why this page treats it as a morning problem as much as a night one.",
  },
  {
    id: "cortisolMean",
    label: "Cortisol, daily mean",
    band: "4-9 nmol/L in saliva",
    note: "Salivary, never serum — the two differ about twentyfold. Modelled here from behaviour, not measured, and printed as an estimate everywhere it appears.",
  },
];

export function reference(id: string): Reference | null {
  return REFERENCES.find((r) => r.id === id) ?? null;
}

/* ------------------------------ the numbers ------------------------------ */

/** The minutes of sleep the reference band's floor asks for. */
export const SLEEP_TARGET = 7 * 60;
export const SLEEP_CEILING = 9 * 60;
export const MOVEMENT_WEEKLY = 150;
export const STEPS_TARGET = 7000;
export const SITTING_LIMIT = 8 * 60;
/** An unbroken block past this is what the back actually feels. */
export const BLOCK_LIMIT = 60;
export const SCREEN_CONTINUOUS = 120;
export const CAFFEINE_CUTOFF_HOURS = 6;
export const SCREEN_CUTOFF_MIN = 60;

/** One day, reduced to the numbers the engine reads. */
export type HealthDay = {
  date: string;
  /** Minutes past midnight, from the sleep entry's clock times. */
  bed: number | null;
  wake: number | null;
  nightMinutes: number | null;
  napMinutes: number;
  quality: number | null;
  water: number | null;
  diet: number | null;
  junk: number | null;
  exercise: number | null;
  /**
   * Movement logged as a tick or a count rather than as time. Kept apart from
   * `exercise` on purpose: adding a checkbox into a minutes field is how a
   * daily exerciser ends up scored at 7 minutes a week.
   */
  exerciseSessions: number;
  steps: number | null;
  mood: number | null;
  stress: number | null;
  energy: number | null;
  /** Minutes at a desk, summed across every sitting-role tracker. */
  sitting: number;
  /** The longest single sitting tracker on the day — the unbroken block. */
  sittingLongest: number;
  screen: number;
  outdoors: number | null;
  caffeine: number | null;
  smoking: number | null;
  /** Clean-streak days: how many held, how many slipped. */
  cleanHeld: number;
  cleanSlipped: number;
  meditation: number | null;
  prayer: number | null;
  weight: number | null;
};

export function blankDay(date: string): HealthDay {
  return {
    date,
    bed: null,
    wake: null,
    nightMinutes: null,
    napMinutes: 0,
    quality: null,
    water: null,
    diet: null,
    junk: null,
    exercise: null,
    exerciseSessions: 0,
    steps: null,
    mood: null,
    stress: null,
    energy: null,
    sitting: 0,
    sittingLongest: 0,
    screen: 0,
    outdoors: null,
    caffeine: null,
    smoking: null,
    cleanHeld: 0,
    cleanSlipped: 0,
    meditation: null,
    prayer: null,
    weight: null,
  };
}

/* ------------------------------- small math ------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const round = (v: number, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Standard deviation. The steadiness number, not the average one. */
function spread(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Clock minutes onto a line that does not wrap at midnight.
 *
 * A bedtime of 23:40 one night and 00:10 the next is thirty minutes of drift
 * and would read as 1,410 without this — which would make the steadiest
 * sleeper in the app look like the least steady. Anything before 6am is
 * treated as belonging to the night before.
 */
function nightMinute(clock: number | null): number | null {
  if (clock === null) return null;
  return clock < 6 * 60 ? clock + 1440 : clock;
}

/** The middle of the night, which is the number sleep timing is judged on. */
function midpoint(bed: number | null, wake: number | null): number | null {
  const b = nightMinute(bed);
  if (b === null || wake === null) return null;
  const w = wake < 6 * 60 ? wake + 1440 : wake + (b > 1440 ? 1440 : 0);
  const end = w > b ? w : w + 1440;
  return (b + end) / 2;
}

/** Saturday and Sunday, plus Friday — the weekend depends where you are. */
function isFreeDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

/* ------------------------------ the metrics ------------------------------ */

export type SleepMetrics = {
  nights: number;
  avgMinutes: number | null;
  medianBed: number | null;
  medianWake: number | null;
  /** Standard deviation of wake time, in minutes. The steadiness number. */
  wakeSpread: number | null;
  bedSpread: number | null;
  /** Weekday-to-free-day drift in the sleep midpoint, in minutes. */
  socialJetlag: number | null;
  /** Minutes owed against the 7-hour floor, summed across the window. */
  debtMinutes: number;
  /** Nights that came in under the floor. */
  shortNights: number;
  longNights: number;
  avgQuality: number | null;
  avgNapMinutes: number;
};

export type HydrationMetrics = {
  days: number;
  avgGlasses: number | null;
  /** Worked out from body weight when there is one; null when there is not. */
  targetGlasses: number | null;
  targetMl: number | null;
  pctOfTarget: number | null;
  shortDays: number;
  /** The daily shortfall in millilitres, when a target exists. */
  deficitMl: number | null;
};

export type NutritionMetrics = {
  avgDiet: number | null;
  junkDays: number;
  junkPerWeek: number | null;
  daysRead: number;
  skipsMeals: boolean | null;
  eatsLate: boolean | null;
};

export type MovementMetrics = {
  /** Null when nothing TIMES the movement — sessions are not minutes. */
  weeklyMinutes: number | null;
  /** Sessions a week, for the people whose movement tracker is a tick. */
  sessionsPerWeek: number | null;
  activeDays: number;
  activeDaysPerWeek: number | null;
  avgSteps: number | null;
  daysRead: number;
};

export type SedentaryMetrics = {
  daysRead: number;
  avgSittingMinutes: number | null;
  avgScreenMinutes: number | null;
  /** Sitting and screen together — the day's total time not moving. */
  avgSedentaryMinutes: number | null;
  /** The longest single unbroken desk block, averaged over the days. */
  avgLongestBlock: number | null;
  worstBlock: number;
  /** Days over the 8-hour reference. */
  heavyDays: number;
};

export type MindMetrics = {
  avgMood: number | null;
  avgStress: number | null;
  avgEnergy: number | null;
  /** The check-up's 1-10 stress answer, when one exists. */
  reportedStress: number | null;
  lowMoodDays: number;
  daysRead: number;
  /** Days with daylight or time outdoors logged, and days with a sit. */
  outdoorDays: number;
  meditationDays: number;
  /** Share of the window carrying either — the recovery term. */
  recoveryRate: number | null;
};

export type DisciplineMetrics = {
  trackedDays: number;
  cleanDays: number;
  slipDays: number;
  currentStreak: number;
  longestStreak: number;
  cleanRate: number | null;
};

export type BodyMetrics = {
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  /** Kilograms a fortnight, from the slope of the logged weights. */
  trendKgPerMonth: number | null;
  weighIns: number;
};

export type SubstanceMetrics = {
  caffeinePerDay: number | null;
  lastCaffeine: string | null;
  cigarettesPerDay: number | null;
  drinks: string | null;
};

export type HealthMetrics = {
  windowDays: number;
  daysLogged: number;
  sleep: SleepMetrics;
  hydration: HydrationMetrics;
  nutrition: NutritionMetrics;
  movement: MovementMetrics;
  sedentary: SedentaryMetrics;
  mind: MindMetrics;
  discipline: DisciplineMetrics;
  body: BodyMetrics;
  substances: SubstanceMetrics;
};

const has = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined;

/** A number typed into the check-up, or null. */
function answerNumber(check: Answers | null, id: string): number | null {
  if (!check) return null;
  const v = Number(check[id]);
  return Number.isFinite(v) ? v : null;
}

function answerString(check: Answers | null, id: string): string | null {
  if (!check) return null;
  const v = check[id];
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * The window, reduced to everything the page reads.
 *
 * Days with nothing on them are already absent from `days` — a blank Tuesday
 * is not a Tuesday with no sleep on it, and averaging zeroes into it would
 * turn a week off into a health crisis.
 */
export function summarize(
  days: HealthDay[],
  check: Answers | null,
  windowDays: number
): HealthMetrics {
  const weeks = Math.max(1, windowDays) / 7;

  /* ------------------------------- sleep -------------------------------- */
  const nights = days.filter((d) => has(d.nightMinutes) && d.nightMinutes > 0);
  const clocked = days.filter((d) => has(d.bed) && has(d.wake));
  const wakes = clocked.map((d) => d.wake as number);
  const beds = clocked.map((d) => nightMinute(d.bed) as number);

  const midpoints = clocked
    .map((d) => ({ date: d.date, mid: midpoint(d.bed, d.wake) }))
    .filter((m): m is { date: string; mid: number } => m.mid !== null);
  const freeMid = mean(midpoints.filter((m) => isFreeDay(m.date)).map((m) => m.mid));
  const workMid = mean(midpoints.filter((m) => !isFreeDay(m.date)).map((m) => m.mid));

  const debtMinutes = nights.reduce(
    (sum, d) => sum + Math.max(0, SLEEP_TARGET - (d.nightMinutes as number)),
    0
  );

  const sleep: SleepMetrics = {
    nights: nights.length,
    avgMinutes: mean(nights.map((d) => d.nightMinutes as number)),
    medianBed: median(beds),
    medianWake: median(wakes),
    // Wake time is the steadier of the two anchors and the one the cortisol
    // curve hangs off, so it leads.
    wakeSpread: spread(wakes),
    bedSpread: spread(beds),
    socialJetlag:
      freeMid !== null && workMid !== null ? Math.abs(freeMid - workMid) : null,
    debtMinutes,
    shortNights: nights.filter((d) => (d.nightMinutes as number) < SLEEP_TARGET).length,
    longNights: nights.filter((d) => (d.nightMinutes as number) > SLEEP_CEILING).length,
    avgQuality: mean(days.filter((d) => has(d.quality)).map((d) => d.quality as number)),
    avgNapMinutes: mean(days.map((d) => d.napMinutes)) ?? 0,
  };

  /* ------------------------------ the body ------------------------------ */
  // Weight comes from a tracker when one exists and from the check-up when it
  // does not — the check-up asks because BMI needs it, and it would be silly
  // to ask twice.
  const weighIns = days.filter((d) => has(d.weight) && (d.weight as number) > 0);
  const loggedWeight = weighIns.length > 0 ? (weighIns[weighIns.length - 1].weight as number) : null;
  const checkWeight = answerNumber(check, "weightKg");
  const heightCm = answerNumber(check, "heightCm");
  const weightKg = loggedWeight ?? checkWeight;

  const bmi =
    heightCm && weightKg && heightCm > 80
      ? round(weightKg / (heightCm / 100) ** 2, 1)
      : bmiOf(check ?? {});

  const body: BodyMetrics = {
    weightKg: weightKg !== null ? round(weightKg, 1) : null,
    heightCm,
    bmi,
    trendKgPerMonth: weightTrend(weighIns),
    weighIns: weighIns.length,
  };

  /* ---------------------------- hydration ------------------------------- */
  const wateredDays = days.filter((d) => has(d.water));
  const need = weightKg ? waterNeed(weightKg, "still") : null;
  const avgGlasses = mean(wateredDays.map((d) => d.water as number));
  const targetGlasses = need?.glasses ?? null;

  const hydration: HydrationMetrics = {
    days: wateredDays.length,
    avgGlasses: avgGlasses !== null ? round(avgGlasses, 1) : null,
    targetGlasses,
    targetMl: need?.ml ?? null,
    pctOfTarget:
      avgGlasses !== null && targetGlasses
        ? Math.round((avgGlasses / targetGlasses) * 100)
        : null,
    shortDays: targetGlasses
      ? wateredDays.filter((d) => (d.water as number) < targetGlasses).length
      : 0,
    deficitMl:
      avgGlasses !== null && targetGlasses
        ? Math.round(Math.max(0, targetGlasses - avgGlasses) * GLASS_ML)
        : null,
  };

  /* ---------------------------- nutrition ------------------------------- */
  const dietDays = days.filter((d) => has(d.diet));
  const junkDays = days.filter((d) => has(d.junk) && (d.junk as number) > 0);
  const junkRead = days.filter((d) => has(d.junk));

  const nutrition: NutritionMetrics = {
    avgDiet: mean(dietDays.map((d) => d.diet as number)),
    junkDays: junkDays.length,
    junkPerWeek: junkRead.length > 0 ? round(junkDays.length / weeks, 1) : null,
    daysRead: Math.max(dietDays.length, junkRead.length),
    skipsMeals: check ? answerString(check, "skipMeals") === "often" : null,
    eatsLate: check ? answerString(check, "lateMeal") === "late" : null,
  };

  /* ----------------------------- movement ------------------------------- */
  const timedDays = days.filter((d) => has(d.exercise) && (d.exercise as number) > 0);
  const timedRead = days.filter((d) => has(d.exercise));
  const totalMove = timedDays.reduce((sum, d) => sum + (d.exercise as number), 0);
  const sessionDays = days.filter((d) => d.exerciseSessions > 0);
  const totalSessions = days.reduce((sum, d) => sum + d.exerciseSessions, 0);
  // Any day with movement on it, timed or ticked.
  const moveDays = days.filter(
    (d) => (has(d.exercise) && (d.exercise as number) > 0) || d.exerciseSessions > 0
  );
  const moveRead = timedRead.length + sessionDays.length;
  const stepDays = days.filter((d) => has(d.steps));

  const movement: MovementMetrics = {
    weeklyMinutes: timedRead.length > 0 ? Math.round(totalMove / weeks) : null,
    sessionsPerWeek: totalSessions > 0 ? round(totalSessions / weeks, 1) : null,
    activeDays: moveDays.length,
    activeDaysPerWeek: moveRead > 0 ? round(moveDays.length / weeks, 1) : null,
    avgSteps: mean(stepDays.map((d) => d.steps as number)),
    daysRead: Math.max(moveRead, stepDays.length),
  };

  /* ---------------------------- sedentary ------------------------------- */
  const sitDays = days.filter((d) => d.sitting > 0 || d.screen > 0);
  const sedentaryTotals = sitDays.map((d) => d.sitting + d.screen);

  const sedentary: SedentaryMetrics = {
    daysRead: sitDays.length,
    avgSittingMinutes: mean(sitDays.map((d) => d.sitting)),
    avgScreenMinutes: mean(sitDays.map((d) => d.screen)),
    avgSedentaryMinutes: mean(sedentaryTotals),
    avgLongestBlock: mean(sitDays.map((d) => d.sittingLongest)),
    worstBlock: sitDays.reduce((max, d) => Math.max(max, d.sittingLongest), 0),
    heavyDays: sedentaryTotals.filter((v) => v >= SITTING_LIMIT).length,
  };

  /* ------------------------------- mind --------------------------------- */
  const moodDays = days.filter((d) => has(d.mood));
  const outdoorDays = days.filter((d) => has(d.outdoors) && (d.outdoors as number) > 0);
  const meditationDays = days.filter(
    (d) => has(d.meditation) && (d.meditation as number) > 0
  );
  const recoveryDays = days.filter(
    (d) =>
      (has(d.outdoors) && (d.outdoors as number) > 0) ||
      (has(d.meditation) && (d.meditation as number) > 0)
  );
  const tracksRecovery =
    days.some((d) => has(d.outdoors)) || days.some((d) => has(d.meditation));

  const mind: MindMetrics = {
    avgMood: mean(moodDays.map((d) => d.mood as number)),
    avgStress: mean(days.filter((d) => has(d.stress)).map((d) => d.stress as number)),
    avgEnergy: mean(days.filter((d) => has(d.energy)).map((d) => d.energy as number)),
    reportedStress: answerNumber(check, "stress"),
    lowMoodDays: moodDays.filter((d) => (d.mood as number) <= 2).length,
    daysRead: moodDays.length,
    outdoorDays: outdoorDays.length,
    meditationDays: meditationDays.length,
    // Against the whole window rather than against logged days: a recovery
    // day that was never logged did not happen as far as this can tell, and
    // dividing by logged days would score one good Sunday as a perfect month.
    recoveryRate: tracksRecovery
      ? Math.round((recoveryDays.length / Math.max(1, windowDays)) * 100)
      : null,
  };

  /* ---------------------------- discipline ------------------------------ */
  const discipline = streakOf(days);

  /* ---------------------------- substances ------------------------------ */
  const caffeineDays = days.filter((d) => has(d.caffeine));
  const smokeDays = days.filter((d) => has(d.smoking));
  const substances: SubstanceMetrics = {
    caffeinePerDay:
      caffeineDays.length > 0
        ? round(mean(caffeineDays.map((d) => d.caffeine as number)) as number, 1)
        : answerNumber(check, "caffeineCups"),
    lastCaffeine: answerString(check, "lastCaffeine"),
    cigarettesPerDay:
      smokeDays.length > 0
        ? round(mean(smokeDays.map((d) => d.smoking as number)) as number, 1)
        : null,
    drinks: answerString(check, "alcohol"),
  };

  return {
    windowDays,
    daysLogged: days.length,
    sleep,
    hydration,
    nutrition,
    movement,
    sedentary,
    mind,
    discipline,
    body,
    substances,
  };
}

/**
 * Kilograms a month, from the straight line through the logged weights.
 *
 * Least squares rather than first-minus-last, because a single odd weigh-in
 * at either end would otherwise set the whole trend. Null under four
 * readings: three points can draw any line you like.
 */
function weightTrend(weighIns: HealthDay[]): number | null {
  if (weighIns.length < 4) return null;
  const start = new Date(`${weighIns[0].date}T00:00:00Z`).getTime();
  const points = weighIns.map((d) => ({
    x: (new Date(`${d.date}T00:00:00Z`).getTime() - start) / 86_400_000,
    y: d.weight as number,
  }));
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return round(slope * 30, 2);
}

/** Clean-streak days, counted forward so the current run ends at the last day. */
function streakOf(days: HealthDay[]): DisciplineMetrics {
  const tracked = days.filter((d) => d.cleanHeld > 0 || d.cleanSlipped > 0);
  let current = 0;
  let longest = 0;
  for (const d of tracked) {
    if (d.cleanSlipped > 0) {
      current = 0;
    } else {
      current += 1;
      longest = Math.max(longest, current);
    }
  }
  const cleanDays = tracked.filter((d) => d.cleanSlipped === 0).length;
  return {
    trackedDays: tracked.length,
    cleanDays,
    slipDays: tracked.filter((d) => d.cleanSlipped > 0).length,
    currentStreak: current,
    longestStreak: longest,
    cleanRate: tracked.length > 0 ? Math.round((cleanDays / tracked.length) * 100) : null,
  };
}

/* ------------------------------ the domains ------------------------------ */

export type Domain = {
  id: string;
  label: string;
  icon: string;
  /** 0-100, or null when nothing feeds it. Never zero for "unknown". */
  score: number | null;
  band: string;
  /** The measured figure, said the way a person would say it. */
  value: string;
  /** What it is being judged against. Always shown beside the value. */
  reference: string;
  referenceId: string;
  /** One sentence of reading, built from the numbers rather than about them. */
  note: string;
  /** Share of the overall balance. Renormalised over what exists. */
  weight: number;
};

/** Nearer 1 is better, always — which way is "good" is settled here, once. */
function bandOf(score: number | null): string {
  if (score === null) return "not enough to say";
  if (score >= 85) return "balanced";
  if (score >= 70) return "mostly balanced";
  if (score >= 55) return "drifting";
  if (score >= 40) return "out of balance";
  return "well out of balance";
}

export { bandOf as healthBandOf };

/** A score from a value that has an ideal window with falloff on both sides. */
function window(value: number, low: number, high: number, slack: number): number {
  if (value >= low && value <= high) return 100;
  const away = value < low ? low - value : value - high;
  return Math.round(100 * clamp01(1 - away / slack));
}

/** A score from a value where more is better up to a target. */
function upTo(value: number, target: number): number {
  return Math.round(100 * clamp01(value / target));
}

/** A score from a value where less is better, hitting zero at `worst`. */
function downFrom(value: number, best: number, worst: number): number {
  if (value <= best) return 100;
  return Math.round(100 * clamp01(1 - (value - best) / (worst - best)));
}

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

/**
 * Every domain the page can score, with the ones it cannot left out.
 *
 * A domain with no inputs is **absent**, not zero. That distinction is the
 * whole ethic of this page: an app that scores what it cannot see is an app
 * that tells someone who logs nothing that they are doing badly, which is
 * both false and the surest way to make them stop logging.
 */
export function domainsOf(
  m: HealthMetrics,
  cortisol: CortisolReport | null
): Domain[] {
  const out: Domain[] = [];

  /* -------------------------------- sleep ------------------------------- */
  if (m.sleep.nights > 0) {
    const parts: number[] = [];
    const avg = m.sleep.avgMinutes as number;
    parts.push(window(avg, SLEEP_TARGET, SLEEP_CEILING, 180));
    if (m.sleep.wakeSpread !== null) {
      parts.push(downFrom(m.sleep.wakeSpread, 30, 120));
    }
    if (m.sleep.avgQuality !== null) {
      parts.push(Math.round(((m.sleep.avgQuality - 1) / 4) * 100));
    }
    const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    out.push({
      id: "sleep",
      label: "Sleep",
      icon: "🌙",
      score,
      band: bandOf(score),
      value: `${hours(avg)} a night over ${m.sleep.nights} night${m.sleep.nights === 1 ? "" : "s"}`,
      reference: "7-9 hours, waking within about 30 minutes of the same time",
      referenceId: "sleepDuration",
      note:
        m.sleep.debtMinutes > 120
          ? `${hours(m.sleep.debtMinutes)} short of the 7-hour floor across the window, over ${m.sleep.shortNights} night${m.sleep.shortNights === 1 ? "" : "s"}.`
          : m.sleep.wakeSpread !== null && m.sleep.wakeSpread > 60
            ? `The hours are there; the timing is not — your wake time moves by about ${Math.round(m.sleep.wakeSpread)} minutes night to night.`
            : "Both the length and the timing are inside the reference band.",
      weight: 0.24,
    });
  }

  /* ------------------------------- rhythm ------------------------------- */
  if (cortisol?.rhythm !== null && cortisol?.rhythm !== undefined) {
    const score = cortisol.rhythm;
    out.push({
      id: "rhythm",
      label: "Cortisol rhythm",
      icon: "🧪",
      score,
      band: bandOf(score),
      value:
        cortisol.meanNmol !== null
          ? `about ${cortisol.meanNmol} nmol/L across the day, est.`
          : "modelled from your sleep times",
      reference: "4-9 nmol/L daily mean, in saliva",
      referenceId: "cortisolMean",
      note: cortisol.curve
        ? `Peaks around ${clockText(cortisol.curve.peakMinute)} and falls ${cortisol.curve.swing}x by evening. A flattened rhythm is an evening that never comes down, not a higher morning.`
        : "Modelled from behaviour, never measured.",
      weight: 0.16,
    });
  }

  /* ------------------------------ movement ------------------------------ */
  if (
    m.movement.weeklyMinutes !== null ||
    m.movement.avgSteps !== null ||
    m.movement.sessionsPerWeek !== null
  ) {
    const parts: number[] = [];
    if (m.movement.weeklyMinutes !== null) {
      // Over 600 a week is its own load rather than more credit — the same U
      // the cortisol model reads movement as.
      parts.push(
        m.movement.weeklyMinutes > 600
          ? downFrom(m.movement.weeklyMinutes, 600, 1200)
          : upTo(m.movement.weeklyMinutes, MOVEMENT_WEEKLY)
      );
    }
    if (m.movement.avgSteps !== null) parts.push(upTo(m.movement.avgSteps, STEPS_TARGET));
    if (m.movement.sessionsPerWeek !== null) {
      // A tick says a session happened and refuses to say how long it was, so
      // it is judged against a count — five a week — rather than being turned
      // into minutes nobody logged.
      parts.push(upTo(m.movement.sessionsPerWeek, 5));
    }
    const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    out.push({
      id: "movement",
      label: "Movement",
      icon: "🏃",
      score,
      band: bandOf(score),
      value:
        m.movement.weeklyMinutes !== null
          ? `${m.movement.weeklyMinutes} min a week across ${m.movement.activeDays} active day${m.movement.activeDays === 1 ? "" : "s"}`
          : m.movement.sessionsPerWeek !== null
            ? `${m.movement.sessionsPerWeek} session${m.movement.sessionsPerWeek === 1 ? "" : "s"} a week — untimed, so read as a count`
            : `about ${Math.round(m.movement.avgSteps as number).toLocaleString()} steps a day`,
      reference: "150-300 minutes a week, or about 7,000 steps a day",
      referenceId: "movement",
      note:
        m.movement.weeklyMinutes === null && m.movement.sessionsPerWeek !== null
          ? "Your movement tracker records that it happened, not how long for — so this is scored against five sessions a week. Timing it would read against the 150-minute guideline instead."
          : m.movement.weeklyMinutes !== null && m.movement.weeklyMinutes < MOVEMENT_WEEKLY
          ? `${MOVEMENT_WEEKLY - m.movement.weeklyMinutes} minutes a week short — that is about ${Math.ceil((MOVEMENT_WEEKLY - (m.movement.weeklyMinutes ?? 0)) / 30)} more half-hour walk${Math.ceil((MOVEMENT_WEEKLY - (m.movement.weeklyMinutes ?? 0)) / 30) === 1 ? "" : "s"}.`
          : "At or above the guideline, which is also what most offsets a day spent sitting.",
      weight: 0.14,
    });
  }

  /* ----------------------------- sedentary ------------------------------ */
  if (m.sedentary.daysRead > 0) {
    const sedentaryMin = m.sedentary.avgSedentaryMinutes as number;
    const block = m.sedentary.avgLongestBlock ?? 0;
    // Two separate things, and they are scored separately because they are:
    // the total, and whether it comes in one piece.
    const total = downFrom(sedentaryMin, 4 * 60, 12 * 60);
    const unbroken = downFrom(block, BLOCK_LIMIT, 240);
    const score = Math.round(total * 0.6 + unbroken * 0.4);
    out.push({
      id: "sedentary",
      label: "Sitting",
      icon: "🪑",
      score,
      band: bandOf(score),
      value: `${hours(sedentaryMin)} a day, longest block ${hours(block)}`,
      reference: "under 8 hours a day, broken every 30-60 minutes",
      referenceId: "sitting",
      note:
        block > 120
          ? `The block is the problem more than the total: ${hours(block)} in one posture is where the back and neck actually pay.`
          : sedentaryMin >= SITTING_LIMIT
            ? `Over the 8-hour reference on ${m.sedentary.heavyDays} day${m.sedentary.heavyDays === 1 ? "" : "s"}. Daily movement offsets most of that risk; nothing else does.`
            : "Inside the reference, and broken up often enough to matter.",
      weight: 0.12,
    });
  }

  /* ----------------------------- hydration ------------------------------ */
  if (m.hydration.days > 0) {
    const pct = m.hydration.pctOfTarget;
    // With no body weight there is no personal target, so it is read against
    // the generic eight glasses and the page says which it used.
    const score =
      pct !== null ? Math.min(100, pct) : upTo(m.hydration.avgGlasses as number, 8);
    out.push({
      id: "hydration",
      label: "Hydration",
      icon: "💧",
      score,
      band: bandOf(score),
      value: `${m.hydration.avgGlasses} glasses a day${
        m.hydration.targetGlasses ? ` of ${m.hydration.targetGlasses}` : ""
      }`,
      reference: m.hydration.targetMl
        ? `${ML_PER_KG_MAX} ml per kg — about ${m.hydration.targetMl} ml for you`
        : "8 glasses, for want of a body weight to work it out from",
      referenceId: "water",
      note:
        m.hydration.deficitMl && m.hydration.deficitMl > 0
          ? `About ${m.hydration.deficitMl} ml a day short, on ${m.hydration.shortDays} of ${m.hydration.days} days read.`
          : m.hydration.targetGlasses === null
            ? "Add a body weight and this becomes your target rather than everybody's."
            : "At or above your own target.",
      weight: 0.1,
    });
  }

  /* ----------------------------- nutrition ------------------------------ */
  if (m.nutrition.daysRead > 0) {
    const parts: number[] = [];
    if (m.nutrition.avgDiet !== null) {
      parts.push(Math.round(((m.nutrition.avgDiet - 1) / 4) * 100));
    }
    if (m.nutrition.junkPerWeek !== null) {
      parts.push(downFrom(m.nutrition.junkPerWeek, 1, 7));
    }
    const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    out.push({
      id: "nutrition",
      label: "Nutrition",
      icon: "🍽️",
      score,
      band: bandOf(score),
      value:
        m.nutrition.avgDiet !== null
          ? `diet rated ${round(m.nutrition.avgDiet, 1)}/5${
              m.nutrition.junkPerWeek !== null
                ? `, junk on ${m.nutrition.junkPerWeek} days a week`
                : ""
            }`
          : `junk on ${m.nutrition.junkPerWeek} days a week`,
      reference: "a rating of 4+ most days, junk on about one day a week",
      referenceId: "bmi",
      note: m.nutrition.skipsMeals
        ? "You reported skipping meals often, which does more to the afternoon than the food itself does."
        : m.nutrition.eatsLate
          ? "You reported eating late, which pushes the evening cortisol floor up at exactly the wrong hour."
          : "Read as load rather than as sin — the number that moves things here is the frequency, not one bad meal.",
      weight: 0.1,
    });
  }

  /* -------------------------------- mind -------------------------------- */
  if (
    m.mind.daysRead > 0 ||
    m.mind.reportedStress !== null ||
    m.mind.avgStress !== null ||
    m.mind.avgEnergy !== null ||
    m.mind.recoveryRate !== null
  ) {
    const parts: number[] = [];
    if (m.mind.avgMood !== null) parts.push(Math.round(((m.mind.avgMood - 1) / 4) * 100));
    if (m.mind.avgStress !== null) {
      parts.push(Math.round(((5 - m.mind.avgStress) / 4) * 100));
    }
    if (m.mind.avgEnergy !== null) {
      parts.push(Math.round(((m.mind.avgEnergy - 1) / 4) * 100));
    }
    if (m.mind.reportedStress !== null) {
      parts.push(Math.round(((10 - m.mind.reportedStress) / 9) * 100));
    }
    if (m.mind.recoveryRate !== null) {
      // Daylight and breathing are the two inputs here that lower the evening
      // floor directly rather than by tiring you out, which is why they score
      // beside mood rather than beside movement. Most days is the target.
      parts.push(upTo(m.mind.recoveryRate, 70));
    }
    const score =
      parts.length > 0
        ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
        : null;
    out.push({
      id: "mind",
      label: "Mind",
      icon: "🧠",
      score,
      band: bandOf(score),
      value:
        m.mind.avgMood !== null
          ? `mood ${round(m.mind.avgMood, 1)}/5 over ${m.mind.daysRead} days`
          : m.mind.avgStress !== null
            ? `stress ${round(m.mind.avgStress, 1)}/5 on the days you rated it`
            : m.mind.avgEnergy !== null
              ? `energy ${round(m.mind.avgEnergy, 1)}/5 on the days you rated it`
              : m.mind.reportedStress !== null
                ? `stress reported at ${m.mind.reportedStress}/10`
                : "rated, but not in a way this can summarise",
      reference: "mood 4+, stress under 5/10, energy steady across the day",
      referenceId: "cortisolMean",
      note:
        m.mind.recoveryRate !== null && m.mind.recoveryRate < 30
          ? `Daylight or breathing logged on ${m.mind.recoveryRate}% of the window. Those are the two things here that lower the evening floor directly rather than by tiring you out.`
          : m.mind.lowMoodDays >= 3
          ? `${m.mind.lowMoodDays} days at 2 or below. This page reads that as a flatter evening slope, and nothing more — it is not a diagnosis of anything.`
          : "Read alongside the rhythm, because a flat curve and a flat afternoon usually arrive together.",
      weight: 0.08,
    });
  }

  /* -------------------------------- body -------------------------------- */
  if (m.body.bmi !== null) {
    const score = window(m.body.bmi, 18.5, 24.9, 8);
    out.push({
      id: "body",
      label: "Body",
      icon: "⚖️",
      score,
      band: bandOf(score),
      value: `BMI ${m.body.bmi}${m.body.weightKg ? ` at ${m.body.weightKg} kg` : ""}`,
      reference: "18.5-24.9, or 18.5-22.9 on South Asian cut-offs",
      referenceId: "bmi",
      note:
        m.body.trendKgPerMonth !== null && Math.abs(m.body.trendKgPerMonth) >= 0.3
          ? `Trending ${m.body.trendKgPerMonth > 0 ? "up" : "down"} about ${Math.abs(m.body.trendKgPerMonth)} kg a month on ${m.body.weighIns} weigh-ins.`
          : "BMI says nothing about what the weight is made of, which is its main limitation and worth remembering.",
      weight: 0.06,
    });
  }

  /* ----------------------------- discipline ----------------------------- */
  if (m.discipline.trackedDays > 0) {
    const score = m.discipline.cleanRate;
    out.push({
      id: "discipline",
      label: "Discipline",
      icon: "🛡️",
      score,
      band: bandOf(score),
      value: `${m.discipline.cleanDays} of ${m.discipline.trackedDays} days clean, ${m.discipline.currentStreak}-day run`,
      reference: "your own streak, and nobody else's",
      referenceId: "sleepRegularity",
      note:
        m.discipline.slipDays > 0
          ? "Counted, not judged. What this page can actually measure about it is the timing — a late-night pattern shows up as a later bedtime, and that is the part with a number on it."
          : "Held across every day read in this window.",
      weight: 0.05,
    });
  }

  /* ----------------------------- substances ----------------------------- */
  if (m.substances.caffeinePerDay !== null || m.substances.cigarettesPerDay !== null) {
    const parts: number[] = [];
    if (m.substances.caffeinePerDay !== null) {
      parts.push(downFrom(m.substances.caffeinePerDay, 3, 8));
    }
    if (m.substances.cigarettesPerDay !== null) {
      parts.push(downFrom(m.substances.cigarettesPerDay, 0, 15));
    }
    if (m.substances.lastCaffeine === "evening") parts.push(20);
    const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    out.push({
      id: "substances",
      label: "Caffeine & co.",
      icon: "☕",
      score,
      band: bandOf(score),
      value: [
        m.substances.caffeinePerDay !== null
          ? `${m.substances.caffeinePerDay} cups a day`
          : null,
        m.substances.cigarettesPerDay ? `${m.substances.cigarettesPerDay} cigarettes` : null,
      ]
        .filter(Boolean)
        .join(", "),
      reference: "under 400 mg of caffeine, none within 6 hours of bed",
      referenceId: "caffeine",
      note:
        m.substances.lastCaffeine === "evening"
          ? "Evening caffeine costs sleep whether or not you feel it — that is the finding, and it is the reason this scores separately from the amount."
          : "The hour matters more than the cup count, which is why both are read.",
      weight: 0.05,
    });
  }

  return out;
}

/* ------------------------------ the balance ------------------------------ */

export type Balance = {
  /** 0-100 across every domain that could be scored. Null when none could. */
  score: number | null;
  band: string;
  /** How many domains fed it, out of how many exist. */
  scored: number;
  possible: number;
  /** The lowest-scoring domains, worst first — at most three. */
  weakest: Domain[];
  strongest: Domain[];
};

/** How many domains this engine can score when everything is being logged. */
export const DOMAIN_COUNT = 10;

/**
 * The headline, renormalised over what exists.
 *
 * A domain nothing feeds contributes nothing and takes its weight with it —
 * so a person logging only sleep is scored on sleep, not on sleep plus eight
 * silent zeroes. It also means the number moves when a tracker is added, and
 * the page says so rather than letting that look like a change in health.
 */
export function balanceOf(domains: Domain[]): Balance {
  const scored = domains.filter(
    (d): d is Domain & { score: number } => d.score !== null
  );
  const totalWeight = scored.reduce((sum, d) => sum + d.weight, 0);
  const score =
    totalWeight > 0
      ? Math.round(
          scored.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight
        )
      : null;

  const byScore = [...scored].sort((a, b) => a.score - b.score);
  return {
    score,
    band: bandOf(score),
    scored: scored.length,
    possible: DOMAIN_COUNT,
    weakest: byScore.filter((d) => d.score < 70).slice(0, 3),
    strongest: [...byScore].reverse().slice(0, 2),
  };
}

/* --------------------------- personal timings ---------------------------- */

export type Timing = {
  id: string;
  label: string;
  time: string;
  why: string;
};

/**
 * The clock times that fall out of this person's own rhythm.
 *
 * Not advice so much as arithmetic on their median night: if you are up at
 * 6:40 and want seven and a half hours, bed is 11:10, the last coffee that
 * clears is 5:10, and the screens want to be down by 10:10. Every one of
 * these is a subtraction from a number the app already holds, which is why
 * they can be printed with a straight face.
 */
export function timingsOf(m: HealthMetrics, cortisol: CortisolReport | null): Timing[] {
  const wake = m.sleep.medianWake ?? cortisol?.medianWake ?? null;
  if (wake === null) return [];

  const target = Math.max(SLEEP_TARGET, Math.min(SLEEP_CEILING, m.sleep.avgMinutes ?? 450));
  const bed = (wake - target + 1440) % 1440;

  const out: Timing[] = [
    {
      id: "bed",
      label: "Lights out",
      time: clockText(bed),
      why: `${hours(target)} before your usual ${clockText(wake)} wake. Move the bedtime, not the alarm — the morning has jobs in it.`,
    },
    {
      id: "caffeine",
      label: "Last coffee",
      time: clockText((bed - CAFFEINE_CUTOFF_HOURS * 60 + 1440) % 1440),
      why: "Six hours before bed. 400 mg that late still measurably shortened sleep in controlled trials, whether or not it was felt.",
    },
    {
      id: "screens",
      label: "Screens down",
      time: clockText((bed - SCREEN_CUTOFF_MIN + 1440) % 1440),
      why: "An hour before. Evening screens track a blunter awakening response the next morning, so this is a morning decision made the night before.",
    },
    {
      id: "daylight",
      label: "Get daylight",
      time: `${clockText(wake)}-${clockText((wake + 60) % 1440)}`,
      why: "Within an hour of waking. It is the strongest and cheapest signal your body clock takes, and nothing else on this page competes with it.",
    },
  ];

  if (cortisol?.curve) {
    out.push({
      id: "hard",
      label: "Hardest work",
      time: `${clockText(cortisol.curve.peakMinute)}-${clockText((cortisol.curve.peakMinute + 180) % 1440)}`,
      why: "The three hours after your modelled peak, which is when the curve says you have the most to spend.",
    });
    out.push({
      id: "dip",
      label: "Expect the dip",
      time: clockText((wake + 8 * 60) % 1440),
      why: "About eight hours after waking, where the curve's fall is steepest. Worth putting the dull work here rather than fighting it with a fourth coffee.",
    });
  }

  return out;
}

/* ---------------------- the level, day by day ---------------------------- */

export type LevelPoint = {
  date: string;
  /** The modelled daily mean for that day alone, in saliva-equivalent nmol/L. */
  nmol: number | null;
  /** Hours slept that night, for the axis this trend is actually about. */
  sleepHours: number | null;
  /** Minutes past midnight, so the sleep cycle can be drawn beside the level. */
  wake: number | null;
  bed: number | null;
  rhythm: number | null;
  load: number | null;
};

/**
 * The level trend, and the sleep cycle underneath it.
 *
 * The single-day curve on this page answers "what does a typical recent day
 * look like". This answers the more useful question: **which way is it
 * going, and what is moving it.** Each day gets its own curve, built from
 * that day's own load, and the mean of that curve is the day's level.
 *
 * Sleep is returned alongside deliberately, because that is the whole claim.
 * A level that climbs across a fortnight means nothing on its own; a level
 * that climbs across the same fortnight in which the wake time slid two
 * hours later is the page saying something. The two are drawn on one chart
 * so the reader can see whether they move together, and the honest answer is
 * sometimes that they do not.
 *
 * A day with no clock times gets `null` and is drawn as a gap, never as a
 * zero — the same rule the rest of the app keeps about blank days.
 */
export function levelTrend(report: CortisolReport): LevelPoint[] {
  const morning = report.check?.morning ?? 1;
  return report.days.map((day) => {
    const canDraw = day.wake !== null && day.bed !== null && day.load !== null;
    const curve = canDraw
      ? buildCurve(
          day.wake as number,
          day.bed as number,
          (day.load as number) / 100,
          report.profile,
          morning
        )
      : null;
    return {
      date: day.date,
      nmol: curve ? dailyMean(curve) : null,
      sleepHours: null,
      wake: day.wake,
      bed: day.bed,
      rhythm: day.rhythm,
      load: day.load,
    };
  });
}

/** The same trend with each night's hours filled in from the logged days. */
export function levelTrendWithSleep(
  report: CortisolReport,
  days: HealthDay[]
): LevelPoint[] {
  const nightBy = new Map(days.map((d) => [d.date, d.nightMinutes]));
  return levelTrend(report).map((point) => {
    const minutes = nightBy.get(point.date) ?? null;
    return {
      ...point,
      sleepHours: minutes === null ? null : Math.round((minutes / 60) * 10) / 10,
    };
  });
}
