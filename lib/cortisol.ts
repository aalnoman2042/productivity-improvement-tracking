import { toNight } from "./clock";
import { healthBand } from "./cortisolCheck";
import type { Tracker } from "./trackers";

/**
 * An **estimate of a cortisol rhythm from behaviour** — not a measurement of
 * one.
 *
 * Say that part plainly, because the difference matters and the page says it
 * too: cortisol is measured in saliva, blood or urine, and nothing in this
 * app touches any of those. What this file does is take the things the day
 * already records — when you slept and for how long, how steady those times
 * are, what you ate, whether you moved, how you felt — and run them through
 * the published shape of a diurnal cortisol curve. The output is a *model of
 * the pattern those inputs usually produce*. It is worth reading the way you
 * read a weather forecast, and it is worth nothing at all as a diagnosis.
 *
 * What it is actually good for is the thing an assay cannot do: it covers
 * every day at once, so the **trend** is honest even where the level is a
 * guess. A week where the wake time moved by two hours has a flatter modelled
 * rhythm than a week where it moved by ten minutes, and that difference is
 * real regardless of what the absolute numbers are.
 *
 * Everything here is arithmetic. No AI writes any number on this page —
 * the same rule the rest of the app holds to.
 */

/* ----------------------------- the profile ----------------------------- */

export type Sex = "male" | "female" | "other";

/**
 * The three things the day's log cannot know and the model wants: the
 * awakening response flattens with age, differs a little by sex, and a
 * persistently low mood tracks a flatter evening slope. All optional — each
 * one simply drops out of the weighting when it isn't there, rather than
 * being guessed at.
 */
export type CortisolProfile = {
  age: number | null;
  sex: Sex | null;
  /** Average mood, 1 (low) to 5 (high). */
  mood: number | null;
};

export const EMPTY_PROFILE: CortisolProfile = { age: null, sex: null, mood: null };

export const SEXES: { value: Sex; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Prefer not to say" },
];

/** Trim what arrived into a profile, or nulls. Shared by the route and the form. */
export function parseProfile(raw: unknown): CortisolProfile {
  if (!raw || typeof raw !== "object") return EMPTY_PROFILE;
  const r = raw as Record<string, unknown>;

  const ageNum = Number(r.age);
  const age =
    Number.isFinite(ageNum) && ageNum >= 10 && ageNum <= 120
      ? Math.round(ageNum)
      : null;

  const sex =
    r.sex === "male" || r.sex === "female" || r.sex === "other" ? r.sex : null;

  const moodNum = Number(r.mood);
  const mood =
    Number.isFinite(moodNum) && moodNum >= 1 && moodNum <= 5
      ? Math.round(moodNum * 10) / 10
      : null;

  return { age, sex, mood };
}

/* ---------------------------- the ingredients --------------------------- */

/**
 * Which of this account's trackers feed the model.
 *
 * Trackers are user-defined here — there is no fixed "diet quality" field to
 * read — so the sources are *found* rather than assumed, using the vocabulary
 * the app's own starter pack established: a sleep-typed tracker, a 1-5 scale
 * in the food or health category for diet, a food tracker marked as a bad
 * habit for junk, anything in fitness for movement, and a mood scale if one
 * exists. A source that isn't found is reported missing and its term is
 * dropped from the weighting — never scored as if it were perfect.
 */
export type CortisolSources = {
  sleepId: string | null;
  dietId: string | null;
  junkId: string | null;
  exerciseIds: string[];
  moodId: string | null;
};

const live = (t: Tracker) => !t.archived;
const cat = (t: Tracker) => (t.category ?? "").toLowerCase();
const named = (t: Tracker, ...words: string[]) => {
  const n = t.name.toLowerCase();
  return words.some((w) => n.includes(w));
};

export function findSources(trackers: Tracker[]): CortisolSources {
  const on = trackers.filter(live);

  const sleep = on.find((t) => t.type === "sleep") ?? null;

  // A 1-5 scale about what you ate. The name is only a tie-breaker, so a
  // tracker called "Nutrition" is found as readily as one called "Diet".
  const scales = on.filter(
    (t) => t.type === "scale" && (cat(t) === "food" || cat(t) === "health")
  );
  const diet =
    scales.find((t) => named(t, "diet", "food", "nutrition", "eating")) ??
    scales.find((t) => !named(t, "mood", "stress", "energy", "happy")) ??
    null;

  // A food habit being cut down rather than built up — that is what `habit`
  // means, and it is the field that tells junk from water.
  const foods = on.filter((t) => cat(t) === "food" && t.id !== diet?.id);
  const junk =
    foods.find((t) => t.habit === "bad" && named(t, "junk", "sugar", "fast")) ??
    foods.find((t) => t.habit === "bad") ??
    null;

  const exercise = on.filter(
    (t) => cat(t) === "fitness" && (t.type === "duration" || t.type === "count")
  );

  const mood =
    on.find((t) => t.type === "scale" && named(t, "mood", "happy", "feel")) ??
    null;

  return {
    sleepId: sleep?.id ?? null,
    dietId: diet?.id ?? null,
    junkId: junk?.id ?? null,
    exerciseIds: exercise.map((t) => t.id),
    moodId: mood?.id ?? null,
  };
}

/** One day, already reduced to the handful of numbers the model reads. */
export type CortisolDay = {
  date: string;
  /** Minutes past midnight, from the sleep entry's clock times. */
  bed: number | null;
  wake: number | null;
  /** The night itself, naps excluded — they are counted separately. */
  nightMinutes: number | null;
  napMinutes: number;
  /** 1-5, how the night was rated. */
  quality: number | null;
  diet: number | null;
  junk: number | null;
  /** Minutes moved, or reps when the fitness tracker counts rather than times. */
  exercise: number | null;
  mood: number | null;
};

/* ------------------------------ the model ------------------------------ */

/** A night this long, ended at this hour, is what the model calls unremarkable. */
const TARGET_SLEEP = 450; // 7h 30m
const LONG_SLEEP = 570; // past 9h 30m, oversleep starts counting too
const BED_ANCHOR = 23 * 60 + 30; // 23:30, as a clock time

/**
 * Where the awakening response lands, and how the day comes down from it.
 *
 * These are the numbers the published shape is built on, and they are worth
 * writing down rather than leaving as magic:
 *
 * - The awakening response **peaks 30-45 minutes after waking** — nearer 30
 *   in men and nearer 45 in women, which is the one place `sex` earns its
 *   keep beyond amplitude. 35 is the split when nobody has said.
 * - Its size is a **50-156% rise** over the level at the moment of waking.
 *   `PRE_WAKE_FRACTION` below is set so an unloaded day comes out at about
 *   +109%, in the middle of that band.
 * - It then **declines through the day**, and it is the *slope* of that
 *   decline that short sleep, irregular sleep and shift work flatten — they
 *   show up as a higher evening rather than as a lower morning.
 */
const PRE_WAKE_RISE = 240;
const DECAY_MINUTES = 300;
const PRE_WAKE_FRACTION = 0.42;

/** Peak concentrations land at 30 min post-waking in men, 45 in women. */
function carMinutes(profile: CortisolProfile): number {
  return profile.sex === "female" ? 45 : profile.sex === "male" ? 30 : 35;
}

/** Minutes past midnight for the evening reading the summary quotes. */
export const EVENING_MINUTE = 22 * 60;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (v: number, n: number) => ((v % n) + n) % n;

/**
 * One pressure on the rhythm: what it is, how hard it pushes today (0-1),
 * and how much the model lets it matter. Weights are renormalised over the
 * pressures that could actually be measured, so a missing tracker costs
 * coverage rather than silently scoring as a good day.
 */
export type Pressure = {
  key: string;
  label: string;
  weight: number;
  value: number;
  note: string;
};

/** The pressures that describe the *clock*, and their share of the rhythm score. */
const CIRCADIAN: Record<string, number> = {
  irregular: 0.45,
  short: 0.25,
  late: 0.15,
  quality: 0.15,
};

const WEIGHTS: Record<string, number> = {
  short: 0.22,
  irregular: 0.2,
  late: 0.12,
  quality: 0.12,
  diet: 0.1,
  junk: 0.08,
  exercise: 0.08,
  mood: 0.08,
};

function minutes(n: number): string {
  const abs = Math.abs(Math.round(n));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * How far this day's wake time sits from the person's own usual one. The
 * comparison is against their median, never against a clock the app picked:
 * the model has no opinion about waking at six, only about waking at six on
 * Monday and at ten on Tuesday.
 */
function irregularity(day: CortisolDay, medianWake: number | null): number | null {
  if (day.wake === null || medianWake === null) return null;
  const drift = Math.abs(mod(day.wake - medianWake + 720, 1440) - 720);
  return clamp01(drift / 120);
}

function pressuresFor(
  day: CortisolDay,
  medianWake: number | null,
  profile: CortisolProfile
): Pressure[] {
  const out: Pressure[] = [];
  const add = (key: string, value: number | null, note: string) => {
    if (value === null) return;
    out.push({
      key,
      label: LABELS[key],
      weight: WEIGHTS[key],
      value: clamp01(value),
      note,
    });
  };

  // Sleep length, counting naps — an hour on the sofa is an hour slept, which
  // is the rule the rest of the app already holds to.
  const slept =
    day.nightMinutes === null ? null : day.nightMinutes + day.napMinutes;
  if (slept !== null) {
    const short = (TARGET_SLEEP - slept) / 180;
    // Oversleeping counts too, at half the rate: it is a weaker signal than
    // a short night but it is not a neutral one.
    const long = (slept - LONG_SLEEP) / 360;
    const value = Math.max(short, long, 0);
    add(
      "short",
      value,
      slept < TARGET_SLEEP
        ? `${minutes(TARGET_SLEEP - slept)} under a 7h 30m night`
        : slept > LONG_SLEEP
          ? `${minutes(slept - LONG_SLEEP)} over a long night`
          : `${minutes(slept)} slept`
    );
  }

  const irr = irregularity(day, medianWake);
  if (irr !== null && day.wake !== null && medianWake !== null) {
    const drift = Math.abs(mod(day.wake - medianWake + 720, 1440) - 720);
    add(
      "irregular",
      irr,
      drift < 15
        ? "woke within a quarter-hour of usual"
        : `woke ${minutes(drift)} from the usual time`
    );
  }

  if (day.bed !== null) {
    // On the night axis so 00:40 reads as later than 23:50 rather than as
    // twenty-three hours earlier.
    const bedNight = toNight(clockLabel(day.bed));
    const anchorNight = toNight(clockLabel(BED_ANCHOR));
    if (bedNight !== null && anchorNight !== null) {
      const past = bedNight - anchorNight;
      add(
        "late",
        past / 180,
        past > 0 ? `to bed ${minutes(past)} past 11:30 pm` : "to bed before 11:30 pm"
      );
    }
  }

  if (day.quality !== null) {
    add(
      "quality",
      (4 - day.quality) / 3,
      `night rated ${day.quality}/5`
    );
  }

  if (day.diet !== null) {
    add("diet", (4 - day.diet) / 3, `diet rated ${day.diet}/5`);
  }

  if (day.junk !== null) {
    add(
      "junk",
      day.junk / 3,
      day.junk === 0 ? "no junk logged" : `${day.junk} logged`
    );
  }

  if (day.exercise !== null) {
    // A U, not a slope. Nothing at all is a pressure; so is a great deal of
    // it, because a hard session raises cortisol on the day it happens. The
    // floor of the U is the ordinary half-hour to hour.
    const m = day.exercise;
    const value =
      m < 30 ? 0.5 * (1 - m / 30) : m <= 75 ? 0 : clamp01((m - 75) / 180);
    add(
      "exercise",
      value,
      m === 0 ? "nothing logged" : `${minutes(m)} of movement`
    );
  }

  const mood = day.mood ?? profile.mood;
  if (mood !== null) {
    add("mood", (4 - mood) / 3, `mood ${Math.round(mood * 10) / 10}/5`);
  }

  return out;
}

const LABELS: Record<string, string> = {
  short: "Sleep length",
  irregular: "Wake-time drift",
  late: "Bedtime",
  quality: "Sleep quality",
  diet: "Diet quality",
  junk: "Junk food",
  exercise: "Movement",
  mood: "Mood",
};

/** Minutes past midnight back to the "HH:MM" the clock helpers speak. */
function clockLabel(minute: number): string {
  const m = mod(Math.round(minute), 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The weighted mean of the pressures present, over the weights present. */
function weighted(pressures: Pressure[], weights: Record<string, number>): number | null {
  let sum = 0;
  let total = 0;
  for (const p of pressures) {
    const w = weights[p.key];
    if (w === undefined) continue;
    sum += w * p.value;
    total += w;
  }
  return total === 0 ? null : sum / total;
}

export type CortisolDayResult = {
  date: string;
  /** 0-100. How well-defined the daily rise and fall looks; null with no sleep timing. */
  rhythm: number | null;
  /** 0-100. How hard the day pushes the curve up and flattens its fall. */
  load: number | null;
  wake: number | null;
  bed: number | null;
  pressures: Pressure[];
};

export function scoreDay(
  day: CortisolDay,
  medianWake: number | null,
  profile: CortisolProfile
): CortisolDayResult {
  const pressures = pressuresFor(day, medianWake, profile);
  const load = weighted(pressures, WEIGHTS);
  const circadian = weighted(pressures, CIRCADIAN);
  return {
    date: day.date,
    rhythm: circadian === null ? null : Math.round((1 - circadian) * 100),
    load: load === null ? null : Math.round(load * 100),
    wake: day.wake,
    bed: day.bed,
    pressures,
  };
}

/* ------------------------------- the curve ------------------------------ */

/**
 * Age and sex set how tall the awakening response can be before anything
 * about the day is taken into account. The age slope is the better-attested
 * of the two — the response flattens steadily across adult life — and the
 * sex term is deliberately small, because the published difference is.
 */
export function amplitudeFactor(profile: CortisolProfile): number {
  const age = profile.age;
  const byAge =
    age === null ? 1 : Math.min(1.12, Math.max(0.8, 1 - (age - 30) * 0.004));
  const bySex = profile.sex === "female" ? 1.05 : 1;
  return byAge * bySex;
}

export type CurvePoint = { minute: number; value: number };

export type CortisolCurve = {
  /** 96 samples, every 15 minutes from midnight. Index units, not nmol/L. */
  points: CurvePoint[];
  wake: number;
  bed: number;
  peakMinute: number;
  peak: number;
  evening: number;
  nadir: number;
  /** Peak ÷ nadir. A healthy day swings wide; a flattened one barely moves. */
  swing: number;
};

/**
 * The shape of a day.
 *
 * Anchored to *waking*, not to the clock: someone who wakes at eleven has
 * their peak at twenty to twelve, and reading their curve against a fixed
 * 7am morning would call a perfectly ordinary rhythm broken. From the peak it
 * falls away through the day toward an evening floor, and starts climbing
 * again in the last couple of hours of sleep, which is what the rise you wake
 * up already inside actually is.
 *
 * Load moves two things at once, and they are the whole story the page tells:
 * it lifts the peak a little, and it lifts the **floor** a lot. That is what
 * a flattened rhythm is — not a higher morning, but an evening that never
 * comes down.
 */
export function buildCurve(
  wake: number,
  bed: number,
  load01: number,
  profile: CortisolProfile,
  /**
   * What the check-up says about the morning itself — a heavy, slow, sunless
   * start takes the top off the peak without touching the evening floor,
   * which is a different shape from a loaded day and has to be drawn as one.
   */
  morning = 1
): CortisolCurve {
  const lift = amplitudeFactor(profile) * morning;
  const car = carMinutes(profile);
  // Load lifts the peak a little and the **floor** a great deal. That is the
  // finding the whole chart rests on: short, irregular and shifted sleep
  // slow the daily decline and raise pre-bedtime cortisol, which is a
  // flattened slope rather than a taller morning.
  const peak = 100 * lift * (1 + 0.3 * clamp01(load01));
  const floor = 100 * (0.1 + 0.28 * clamp01(load01));
  const preWake = floor + (peak - floor) * PRE_WAKE_FRACTION;

  const at = (minute: number): number => {
    const s = mod(minute - wake, 1440);
    if (s <= car) return preWake + (peak - preWake) * (s / car);
    const decayed = floor + (peak - floor) * Math.exp(-(s - car) / DECAY_MINUTES);
    const untilWake = 1440 - s;
    if (untilWake <= PRE_WAKE_RISE) {
      const t = 1 - untilWake / PRE_WAKE_RISE;
      return decayed + (preWake - decayed) * t;
    }
    return decayed;
  };

  const points: CurvePoint[] = [];
  for (let minute = 0; minute < 1440; minute += 15) {
    points.push({ minute, value: Math.round(at(minute) * 10) / 10 });
  }

  const round = (v: number) => Math.round(v * 10) / 10;
  const nadir = Math.min(...points.map((p) => p.value));
  return {
    points,
    wake,
    bed,
    peakMinute: mod(wake + car, 1440),
    peak: round(peak),
    evening: round(at(EVENING_MINUTE)),
    nadir: round(nadir),
    swing: nadir > 0 ? Math.round((peak / nadir) * 10) / 10 : 0,
  };
}

/* ------------------------------ the report ------------------------------ */

/* ------------------------------- the level ------------------------------ */

/**
 * Index units to something a person can actually read.
 *
 * The curve above is built in index units where 100 is a reference healthy
 * morning peak. That is fine for shape and useless as an answer to "what is
 * my cortisol", so it is anchored here to the **salivary** scale, where a
 * healthy adult's morning peak sits around 18 nmol/L and the late evening
 * around 2.
 *
 * Saliva, not serum, on purpose: the two differ by roughly twenty-fold, and
 * a number quoted on the serum scale would look like a blood test result.
 * This is not one. It is the level the modelled shape implies, and the page
 * prints "est." beside every figure that comes out of here.
 */
export const NMOL_PER_INDEX = 0.18;

/** The band a healthy adult's *daily mean* salivary cortisol usually falls in. */
export const MEAN_REFERENCE = { low: 4, high: 9 };

export function toNmol(index: number): number {
  return Math.round(index * NMOL_PER_INDEX * 10) / 10;
}

/**
 * The average level across the modelled day — the mean of the curve, which
 * is the closest thing this model has to the single number people ask for.
 * Taken over all 96 samples, so it is the area under the day rather than a
 * midpoint between the peak and the trough.
 */
export function dailyMean(curve: CortisolCurve): number {
  const mean =
    curve.points.reduce((sum, p) => sum + p.value, 0) / curve.points.length;
  return toNmol(mean);
}

export function meanBand(nmol: number | null): string {
  if (nmol === null) return "not enough to say";
  if (nmol < MEAN_REFERENCE.low) return "below the usual band";
  if (nmol <= MEAN_REFERENCE.high) return "inside the usual band";
  if (nmol <= MEAN_REFERENCE.high * 1.4) return "above the usual band";
  return "well above the usual band";
}

export type CortisolReport = {
  days: CortisolDayResult[];
  /** Rounded means over the days that could be scored. */
  rhythm: number | null;
  load: number | null;
  /** The same two, over the half of the window before this one. */
  previousRhythm: number | null;
  previousLoad: number | null;
  curve: CortisolCurve | null;
  medianWake: number | null;
  medianBed: number | null;
  /** The pressures pushing hardest, worst first — at most three. */
  drivers: Pressure[];
  /** How many days of the window carried sleep times, and how many carried anything. */
  nightsRead: number;
  daysRead: number;
  profile: CortisolProfile;
  sources: CortisolSources;
  /** The average modelled level across the day, in saliva-equivalent nmol/L. */
  meanNmol: number | null;
  peakNmol: number | null;
  eveningNmol: number | null;
  /**
   * 0-100, the headline. The check-up and the logged days are two views of
   * the same person, so it is a blend of both, and whichever one exists when
   * only one does.
   */
  health: number | null;
  healthLabel: string;
  /** What the monthly check-up contributed, when one has been answered. */
  check: CheckInput;
};

/**
 * The monthly check-up, reduced to what the model reads. Null until one has
 * been answered — and the whole page says so rather than filling the gap in.
 */
export type CheckInput = {
  month: string;
  score: number | null;
  pressure: number | null;
  /** How far the check-up says the awakening response itself is blunted. */
  morning: number;
  confident: boolean;
} | null;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/**
 * The median of clock times, taken on the night axis so a run of bedtimes
 * either side of midnight averages to midnight rather than to noon.
 */
function medianClock(values: number[]): number | null {
  const nights = values
    .map((v) => toNight(clockLabel(v)))
    .filter((v): v is number => v !== null);
  const mid = median(nights);
  if (mid === null) return null;
  return mod(mid + 18 * 60, 1440);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The whole read, from a window of days already reduced to `CortisolDay`s.
 *
 * The curve is built from the *typical* day — median wake, median bedtime,
 * mean load — rather than from the most recent one, because a single late
 * night is not a rhythm and drawing it as though it were is how a page like
 * this starts lying.
 */
export function buildReport(
  days: CortisolDay[],
  profile: CortisolProfile,
  sources: CortisolSources,
  check: CheckInput = null
): CortisolReport {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));

  const wakes = ordered.map((d) => d.wake).filter((v): v is number => v !== null);
  const beds = ordered.map((d) => d.bed).filter((v): v is number => v !== null);
  const medianWake = medianClock(wakes);
  const medianBed = medianClock(beds);

  const scored = ordered.map((d) => scoreDay(d, medianWake, profile));
  const withLoad = scored.filter((d) => d.load !== null);

  const half = Math.floor(scored.length / 2);
  const recent = scored.slice(half);
  const earlier = scored.slice(0, half);

  const meanOf = (rows: CortisolDayResult[], key: "rhythm" | "load") => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => v !== null);
    const m = mean(vals);
    return m === null ? null : Math.round(m);
  };

  const load = meanOf(recent.length > 0 ? recent : scored, "load");
  const rhythm = meanOf(recent.length > 0 ? recent : scored, "rhythm");

  // The drivers are averaged across the window, not taken from one day: the
  // question this page answers is what keeps happening, not what happened
  // on Tuesday.
  const totals = new Map<string, { p: Pressure; sum: number; n: number }>();
  for (const day of scored) {
    for (const p of day.pressures) {
      const seen = totals.get(p.key);
      if (seen) {
        seen.sum += p.value;
        seen.n += 1;
      } else {
        totals.set(p.key, { p, sum: p.value, n: 1 });
      }
    }
  }
  const drivers = [...totals.values()]
    .map(({ p, sum, n }) => ({ ...p, value: Math.round((sum / n) * 100) / 100 }))
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .filter((p) => p.value > 0.15)
    .slice(0, 3);

  // The logged days and the check-up are two views of the same person, so
  // they are averaged rather than ranked: the days know what actually
  // happened and nothing about how it felt, and the check-up is the other
  // way round. Whichever exists alone is used alone.
  const fromDays = load === null ? null : load / 100;
  const fromCheck = check?.pressure ?? null;
  const load01 =
    fromDays !== null && fromCheck !== null
      ? (fromDays + fromCheck) / 2
      : (fromDays ?? fromCheck ?? 0);

  const curve =
    medianWake === null || medianBed === null
      ? null
      : buildCurve(medianWake, medianBed, load01, profile, check?.morning ?? 1);

  // The headline score, the same way round: the tracker side is the rhythm
  // and the absence of load, the check side is its own score.
  const trackerSide =
    rhythm === null && load === null
      ? null
      : ((rhythm ?? 100) + (100 - (load ?? 0))) / 2;
  const checkSide = check?.score ?? null;
  const health =
    trackerSide !== null && checkSide !== null
      ? Math.round(trackerSide * 0.4 + checkSide * 0.6)
      : trackerSide !== null
        ? Math.round(trackerSide)
        : checkSide !== null
          ? Math.round(checkSide)
          : null;

  return {
    days: scored,
    rhythm,
    load,
    previousRhythm: earlier.length > 0 ? meanOf(earlier, "rhythm") : null,
    previousLoad: earlier.length > 0 ? meanOf(earlier, "load") : null,
    curve,
    medianWake,
    medianBed,
    drivers,
    nightsRead: wakes.length,
    daysRead: withLoad.length,
    profile,
    sources,
    meanNmol: curve ? dailyMean(curve) : null,
    peakNmol: curve ? toNmol(curve.peak) : null,
    eveningNmol: curve ? toNmol(curve.evening) : null,
    health,
    healthLabel: healthBand(health),
    check,
  };
}

/* ------------------------------ coverage -------------------------------- */

/**
 * How much of the estimate is standing on real data, and what would fix it.
 *
 * This is the honest counterweight to a page full of confident-looking
 * numbers. A rhythm modelled from four nights and no check-up is not the
 * same claim as one modelled from thirty nights and a full form, and a
 * reader has no way to tell those apart from the chart alone — so the page
 * says which it is, and then says exactly what to add.
 *
 * Suggestions are ordered by how much they would actually improve the
 * estimate, not by how easy they are. The sleep clock times come first every
 * time because without them there is no curve at all.
 */
export type CoveragePart = { label: string; have: boolean; weight: number };

export type Suggestion = {
  id: string;
  title: string;
  why: string;
  /** How much of the missing coverage this one would fill, 0-1. */
  weight: number;
  /** Where to go and do it. */
  href: string;
};

export type Coverage = {
  /** 0-100. Not a score — a statement about how much the model can see. */
  pct: number;
  parts: CoveragePart[];
  suggestions: Suggestion[];
  label: string;
};

export function coverageOf(report: CortisolReport, windowDays: number): Coverage {
  const s = report.sources;
  // Nights with clock times are the backbone: everything else adjusts a
  // curve that only exists because of them.
  const nightShare = windowDays > 0 ? Math.min(1, report.nightsRead / windowDays) : 0;

  const parts: CoveragePart[] = [
    { label: "Nights with bed and wake times", have: nightShare >= 0.6, weight: 0.34 },
    { label: "Monthly check-up", have: report.check !== null, weight: 0.24 },
    { label: "Diet quality", have: s.dietId !== null, weight: 0.1 },
    { label: "Movement", have: s.exerciseIds.length > 0, weight: 0.1 },
    { label: "Junk food", have: s.junkId !== null, weight: 0.08 },
    { label: "Mood", have: s.moodId !== null || report.profile.mood !== null, weight: 0.08 },
    { label: "Age and sex", have: report.profile.age !== null, weight: 0.06 },
  ];

  // The nights part is graded rather than all-or-nothing — thirty logged
  // nights out of thirty is a different thing from eighteen.
  const filled = parts.reduce((sum, p) => {
    if (p.label.startsWith("Nights")) return sum + p.weight * nightShare;
    return sum + (p.have ? p.weight : 0);
  }, 0);

  const suggestions: Suggestion[] = [];
  const add = (s: Suggestion) => suggestions.push(s);

  if (report.sources.sleepId === null) {
    add({
      id: "sleepTracker",
      title: "Add a sleep tracker",
      why: "Nothing here can be drawn without one. The whole curve is anchored to the time you woke up, so a sleep tracker is not one input among several — it is the axis.",
      weight: 1,
      href: "/trackers",
    });
  } else if (nightShare < 0.6) {
    add({
      id: "sleepTimes",
      title:
        report.nightsRead === 0
          ? "Fill in bedtime and wake time, not just the hours"
          : `Log the clock times on more nights — ${report.nightsRead} of the last ${windowDays}`,
      why: "A nightly total says how long you slept and nothing about when. Two people who both slept seven hours, one from eleven and one from four, have completely different rhythms and identical totals.",
      weight: 0.34 * (1 - nightShare),
      href: "/",
    });
  }

  if (report.check === null) {
    add({
      id: "checkup",
      title: "Take the monthly check-up",
      why: "It asks the things no tracker can see: how long sleep takes to arrive, whether your morning has daylight in it, when your last coffee was, and whether you work shifts. Those carry roughly a quarter of the estimate.",
      weight: 0.24,
      href: "/cortisol",
    });
  }

  if (s.dietId === null) {
    add({
      id: "diet",
      title: "Add a diet-quality tracker",
      why: "A 1–5 scale in the Food category, rated once a day. It is one tap and it is the only way the model can tell a week of real meals from a week of whatever was nearest.",
      weight: 0.1,
      href: "/trackers",
    });
  }

  if (s.exerciseIds.length === 0) {
    add({
      id: "exercise",
      title: "Add a workout tracker",
      why: "Movement is read as a U — none at all and far too much both push the rhythm, and the ordinary half-hour in between is the floor. With nothing logged, the model cannot tell which of the three you are.",
      weight: 0.1,
      href: "/trackers",
    });
  }

  if (s.junkId === null) {
    add({
      id: "junk",
      title: "Add a junk-food count, marked as a habit you are cutting",
      why: "The habit flag is what tells junk from water — both are counts in the Food category, and only the flag says which direction is winning.",
      weight: 0.08,
      href: "/trackers",
    });
  }

  if (s.moodId === null && report.profile.mood === null) {
    add({
      id: "mood",
      title: "Add a mood scale, or set your usual mood below",
      why: "A persistently low mood tracks a flatter evening slope. A daily 1–5 scale is better than a typed average, because it moves.",
      weight: 0.08,
      href: "/trackers",
    });
  }

  if (report.profile.age === null) {
    add({
      id: "age",
      title: "Add your age",
      why: "The awakening response flattens steadily across adult life. Without an age the curve is drawn for a thirty-year-old, whoever is reading it.",
      weight: 0.06,
      href: "/cortisol",
    });
  }

  const pct = Math.round(filled * 100);
  return {
    pct,
    parts,
    suggestions: suggestions.sort((a, b) => b.weight - a.weight),
    label:
      pct >= 85
        ? "the model can see most of your life"
        : pct >= 60
          ? "enough to be worth reading, with gaps"
          : pct >= 35
            ? "thin — read the direction, not the number"
            : "too thin to lean on yet",
  };
}

/* ------------------------------- wording -------------------------------- */

/** "6:40 am" for a minute past midnight. Deterministic on both sides. */
export function clockText(minute: number | null): string {
  if (minute === null) return "—";
  const m = mod(Math.round(minute), 1440);
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** What a rhythm score is called, so every screen calls it the same thing. */
export function rhythmBand(score: number | null): string {
  if (score === null) return "not enough to say";
  if (score >= 80) return "well defined";
  if (score >= 65) return "steady";
  if (score >= 50) return "loosening";
  if (score >= 35) return "flattening";
  return "flat";
}

export function loadBand(score: number | null): string {
  if (score === null) return "not enough to say";
  if (score <= 20) return "light";
  if (score <= 40) return "moderate";
  if (score <= 60) return "raised";
  if (score <= 80) return "high";
  return "very high";
}

/**
 * The sentence at the top. Built from the numbers rather than written about
 * them, so it can never say something the chart underneath disagrees with.
 */
export function summaryLine(report: CortisolReport): string {
  if (report.nightsRead === 0) {
    return "No sleep times on record yet — the rhythm is built from when you slept, so there is nothing to draw.";
  }
  const curve = report.curve;
  if (!curve || report.rhythm === null) {
    return "Not enough of the window is logged to model a rhythm yet.";
  }
  const peak = clockText(curve.peakMinute);
  const level = report.meanNmol;
  const band = meanBand(level);
  return `Average modelled level about ${level} nmol/L across the day — ${band}. It peaks around ${peak} and falls to roughly a ${curve.swing}× lower evening, which reads as a ${rhythmBand(report.rhythm)} rhythm under ${loadBand(report.load)} load.`;
}

/** The standing caveat, in one place so every surface repeats it exactly. */
export const CORTISOL_CAVEAT =
  "This is a model, not a measurement. Cortisol is measured in saliva, blood or urine — this page estimates the shape your logged sleep, food, movement and mood usually produce. Read the trend, not the number, and take nothing here as medical advice.";
