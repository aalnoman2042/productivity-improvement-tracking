import { formatValue, typeMeta, type Tracker, type TrackerType } from "./trackers";
import { nightLabel } from "./clock";
import { wantMore as direction } from "./direction";

/**
 * What goes with what.
 *
 * Every tracker already sits on the same daily grid, so the question "do my
 * short nights land on the days I study late?" is answerable — and it is the
 * only question here that a spreadsheet doesn't answer more easily.
 *
 * Four deliberate choices, because this is the part of the app most able to
 * mislead:
 *
 * 1. **Contrasts, not coefficients.** Nobody acts on "r = 0.62". They act on
 *    "7h 40m on the nights you're in bed before midnight, 5h 50m after". So
 *    days are split into two groups and the two averages are reported. The
 *    correlation is still computed — it feeds the ranking — but it never
 *    reaches the screen.
 *
 * 2. **Deliberately hard thresholds.** Fifteen trackers make 105 pairs, and at
 *    p < 0.05 you would expect five false findings from noise alone. So a pair
 *    needs a lot of overlapping days, a strong coefficient *and* a difference
 *    big enough to care about, and only the strongest few are shown.
 *
 * 3. **Stated as association.** Nothing here establishes cause, and the copy
 *    never claims it does. "goes with" is the strongest verb used.
 *
 * 4. **Ranked by impact, not correlation.** A tight little effect can carry
 *    r = 0.9 and change nothing; what earns the top slot is a strong link
 *    *and* a gap worth acting on *and* enough days behind it — with findings
 *    that point a way you'd want (or wouldn't) outranking the merely curious.
 */

/* --------------------------- the shared grid --------------------------- */

/** One tracker's values, keyed by date. */
export type Series = {
  tracker: Tracker;
  /** date → the day's value, only for days that were actually logged. */
  byDate: Map<string, number>;
};

export type Finding = {
  kind: "pair" | "weekday" | "bedtime";
  /** The headline, written to be read on its own. */
  title: string;
  /** The numbers it came from. */
  detail: string;
  /** How strongly the two move together, 0–1. */
  strength: number;
  /** What the ranking sorts by: strength × size of the gap × days behind it. */
  impact: number;
  /** Days the finding is built from — shown so nobody over-reads a small one. */
  days: number;
  /** Whether the association points the way you'd want. */
  tone: "good" | "bad" | "neutral";
};

/* ------------------------------ statistics ----------------------------- */

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Pearson's r. Returns 0 when either side never varies — no signal, not perfect agreement. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/* ------------------------------ thresholds ----------------------------- */

/**
 * Set high on purpose. The failure mode of this feature isn't missing a
 * pattern, it's inventing one — a confident sentence about noise is worse
 * than no sentence, because it gets acted on.
 */
export const MIN_DAYS = 12;
export const MIN_R = 0.45;
/** The weaker group must differ from the stronger by at least this much. */
export const MIN_RELATIVE_GAP = 0.15;
export const MAX_FINDINGS = 5;

/* ------------------------------- helpers ------------------------------- */

const isTime = (t: Tracker) => t.type === "duration" || t.type === "sleep";

/** Yes/no trackers: the day either happened or it didn't. */
const isBinary = (t: Tracker) => t.type === "check" || t.type === "streak";

function fmt(t: Tracker, value: number): string {
  return formatValue(value, t.type as TrackerType, t.unit);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Which way is up for this tracker — the shared rule, in lib/direction. */
function wantMore(t: Tracker): boolean | null {
  return direction(t.type as TrackerType, t.habit, t.goal);
}

/**
 * The composite the ranking sorts by. Correlation alone over-ranks tight,
 * tiny effects; the gap alone over-ranks noisy ones; and days are the
 * reader's only defense against coincidence. A finding with no direction to
 * act on is docked rather than dropped — interesting, but not urgent.
 */
function impactOf(
  strength: number,
  gapRatio: number,
  days: number,
  tone: Finding["tone"]
): number {
  const confidence = Math.min(1, days / 30);
  const base = strength * Math.min(1, gapRatio) * confidence;
  return Math.round((tone === "neutral" ? base * 0.85 : base) * 100) / 100;
}

/** Days both trackers were logged, as two aligned arrays. */
function overlap(a: Series, b: Series): { xs: number[]; ys: number[]; dates: string[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const dates: string[] = [];
  for (const [date, x] of a.byDate) {
    const y = b.byDate.get(date);
    if (y === undefined) continue;
    xs.push(x);
    ys.push(y);
    dates.push(date);
  }
  return { xs, ys, dates };
}

/* ------------------------------ the pairs ------------------------------ */

/** "On your clean X days" / "On days you did X" / "On days with more than 2h". */
function highLabel(driver: Tracker, cut: number): string {
  if (driver.type === "streak") return `On your clean ${driver.name} days`;
  if (driver.type === "check") return `On days you did ${driver.name}`;
  return `On days with more than ${fmt(driver, cut)}${
    isTime(driver) ? "" : ` ${driver.name.toLowerCase()}`
  }`;
}

function lowLabel(driver: Tracker): string {
  if (driver.type === "streak") return "slip days";
  if (driver.type === "check") return "days you didn't";
  return "the rest";
}

/**
 * "averaged 7h 40m — against 5h 50m on the rest". A yes/no outcome gets a
 * rate instead, because the average of Done and not-Done is a share of days,
 * not an amount — `formatValue` would print a nonsense "Done" for 0.7.
 */
function outcomeContrast(t: Tracker, hi: number, lo: number, rest: string): string {
  if (t.type === "streak")
    return `stayed clean on ${pct(hi)} of them — against ${pct(lo)} on ${rest}`;
  if (t.type === "check")
    return `got done on ${pct(hi)} of them — against ${pct(lo)} on ${rest}`;
  return `averaged ${fmt(t, hi)} — against ${fmt(t, lo)} on ${rest}`;
}

/**
 * Split the days by the driver and compare what the outcome did in each half.
 * A numeric driver splits at its own median, because that adapts to whatever
 * range this person actually lives in; a yes/no driver splits on did-vs-didn't
 * — the median of 0s and 1s would leave one side empty.
 */
function pairFinding(driver: Series, outcome: Series): Finding | null {
  const { xs, ys } = overlap(driver, outcome);
  if (xs.length < MIN_DAYS) return null;

  const r = pearson(xs, ys);
  if (Math.abs(r) < MIN_R) return null;

  const cut = isBinary(driver.tracker) ? 0 : median(xs);
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < xs.length; i++) (xs[i] > cut ? high : low).push(ys[i]);
  // A split is useless if almost everything lands on one side.
  if (high.length < 4 || low.length < 4) return null;

  const hi = mean(high);
  const lo = mean(low);
  const gap = Math.abs(hi - lo);
  const base = Math.max(Math.abs(hi), Math.abs(lo));
  if (base === 0 || gap / base < MIN_RELATIVE_GAP) return null;

  const more = hi > lo;
  const better = wantMore(outcome.tracker);
  const tone: Finding["tone"] =
    better === null ? "neutral" : more === better ? "good" : "bad";

  const binaryOut = isBinary(outcome.tracker);
  const moreWord = binaryOut
    ? more ? "more often" : "less often"
    : more ? "higher" : "lower";
  const verb = outcome.tracker.type === "streak"
    ? "stays clean"
    : binaryOut ? "happens" : "is";
  const driverDays =
    driver.tracker.type === "streak"
      ? `clean ${driver.tracker.name} days`
      : driver.tracker.type === "check"
        ? `days you do ${driver.tracker.name}`
        : `bigger ${driver.tracker.name} days`;

  return {
    kind: "pair",
    title: `${outcome.tracker.name} ${verb} ${moreWord} on your ${driverDays}`,
    detail:
      `${highLabel(driver.tracker, cut)}, ${outcome.tracker.name} ` +
      `${outcomeContrast(outcome.tracker, hi, lo, lowLabel(driver.tracker))}. ` +
      `${xs.length} days have both.`,
    strength: Math.abs(r),
    impact: impactOf(Math.abs(r), gap / base, xs.length, tone),
    days: xs.length,
    tone,
  };
}

/* ----------------------------- the weekdays ---------------------------- */

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

const weekdayOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/**
 * The day of the week a habit falls over on. Answers "why does this keep
 * happening?" with something you can actually plan around, which a monthly
 * average never does.
 */
function weekdayFinding(s: Series): Finding | null {
  if (s.byDate.size < MIN_DAYS + 6) return null;

  const groups: number[][] = Array.from({ length: 7 }, () => []);
  for (const [date, v] of s.byDate) groups[weekdayOf(date)].push(v);
  // Every weekday needs enough days to mean anything.
  if (groups.some((g) => g.length < 2)) return null;

  const means = groups.map(mean);
  const overall = mean([...s.byDate.values()]);
  if (overall === 0) return null;

  const better = wantMore(s.tracker);
  if (better === null) return null;

  // The worst day, in the direction that counts as worse for this tracker.
  const worst = better
    ? means.indexOf(Math.min(...means))
    : means.indexOf(Math.max(...means));
  const worstMean = means[worst];
  const others = mean(groups.filter((_, i) => i !== worst).flat());
  if (others === 0) return null;

  const gap = Math.abs(others - worstMean) / Math.abs(others);
  if (gap < 0.35) return null;

  // A "missed" day only means something for the types where a low value is
  // unambiguously a miss. Less work on a Friday isn't a failure — it's the
  // weekend — and the app has no idea which days yours are, so most trackers
  // get this reported flatly and left for you to judge. A bad habit is the
  // exception in the other direction: the day it spikes is bad on any
  // calendar, weekend or not.
  const isMiss = ["check", "prayer", "streak"].includes(s.tracker.type);
  const badHabit = s.tracker.habit === "bad" && s.tracker.type !== "streak";
  const tone: Finding["tone"] = isMiss || badHabit ? "bad" : "neutral";

  return {
    kind: "weekday",
    title: isMiss
      ? `${DAY_NAMES[worst]}s are where ${s.tracker.name} slips`
      : badHabit
        ? `${DAY_NAMES[worst]}s are when ${s.tracker.name} creeps up`
        : `${DAY_NAMES[worst]}s are your ${better ? "lowest" : "highest"} day for ${s.tracker.name}`,
    detail:
      `${DAY_NAMES[worst]}s average ${fmt(s.tracker, worstMean)}, against ` +
      `${fmt(s.tracker, others)} on every other day — ` +
      `${Math.round(gap * 100)}% ${better ? "lower" : "higher"}, across ` +
      `${groups[worst].length} ${DAY_NAMES[worst]}s.`,
    strength: Math.min(1, gap),
    impact: impactOf(Math.min(1, gap), gap, s.byDate.size, tone),
    days: s.byDate.size,
    tone,
  };
}

/* ----------------------------- the bedtime ----------------------------- */

/**
 * Bedtime against everything else.
 *
 * This one needs the clock rather than the totals, and it's the finding most
 * likely to be worth having: "what does a late night cost me tomorrow?" is a
 * question the rest of the app can't reach.
 */
function bedtimeFinding(
  bedByDate: Map<string, number>,
  outcome: Series
): Finding | null {
  const dates = [...bedByDate.keys()].filter((d) => outcome.byDate.has(d));
  if (dates.length < MIN_DAYS) return null;

  const beds = dates.map((d) => bedByDate.get(d) as number);
  const vals = dates.map((d) => outcome.byDate.get(d) as number);

  const r = pearson(beds, vals);
  if (Math.abs(r) < MIN_R) return null;

  const cut = median(beds);
  const late: number[] = [];
  const early: number[] = [];
  for (let i = 0; i < dates.length; i++) (beds[i] > cut ? late : early).push(vals[i]);
  if (late.length < 4 || early.length < 4) return null;

  const lateMean = mean(late);
  const earlyMean = mean(early);
  const gap = Math.abs(lateMean - earlyMean);
  const base = Math.max(Math.abs(lateMean), Math.abs(earlyMean));
  if (base === 0 || gap / base < MIN_RELATIVE_GAP) return null;

  const better = wantMore(outcome.tracker);
  const lateIsWorse = lateMean < earlyMean;
  const tone: Finding["tone"] =
    better === null ? "neutral" : lateIsWorse === better ? "bad" : "good";

  // "less Mood" is not English. Ratings and measurements go up and down;
  // hours and counts are more and less; a yes/no tracker gains or loses days.
  const binaryOut = isBinary(outcome.tracker);
  const rated = ["scale", "measure"].includes(outcome.tracker.type);
  const direction = binaryOut
    ? lateIsWorse ? "fewer" : "more"
    : rated
      ? lateIsWorse ? "lower" : "higher"
      : lateIsWorse ? "less" : "more";

  const t = outcome.tracker;
  const detail = binaryOut
    ? `In bed before ${nightLabel(cut)}, ${t.name} ` +
      `${t.type === "streak" ? "stayed clean" : "got done"} on ${pct(earlyMean)} ` +
      `of days. After it, ${pct(lateMean)}. ${dates.length} nights have both.`
    : `In bed before ${nightLabel(cut)}, ${t.name} averaged ` +
      `${fmt(t, earlyMean)}. After it, ${fmt(t, lateMean)}. ` +
      `${dates.length} nights have both.`;

  return {
    kind: "bedtime",
    title: `Late nights go with ${direction} ${t.name}${binaryOut ? " days" : ""}`,
    detail,
    strength: Math.abs(r),
    impact: impactOf(Math.abs(r), gap / base, dates.length, tone),
    days: dates.length,
    tone,
  };
}

/* ------------------------------ the whole ------------------------------ */

export type CorrelationInput = {
  series: Series[];
  /** date → bedtime on the night axis, for sleep trackers. */
  bedByDate: Map<string, number>;
};

/**
 * Everything worth saying, most impactful first.
 *
 * A pair is only considered in one direction — the tracker you have more
 * control over drives. Sleep and bedtime drive everything; otherwise the
 * one whose values accumulate does.
 */
export function findCorrelations({ series, bedByDate }: CorrelationInput): Finding[] {
  const usable = series.filter((s) => s.byDate.size >= MIN_DAYS);

  const found: Finding[] = [];

  for (let i = 0; i < usable.length; i++) {
    for (let j = 0; j < usable.length; j++) {
      if (i === j) continue;
      const a = usable[i];
      const b = usable[j];
      // Only one direction per pair, so the same relationship isn't reported
      // twice with the roles swapped. Sleep drives; otherwise, lower index.
      const aDrives = a.tracker.type === "sleep" || (b.tracker.type !== "sleep" && i < j);
      if (!aDrives) continue;
      const f = pairFinding(a, b);
      if (f) found.push(f);
    }
  }

  if (bedByDate.size >= MIN_DAYS) {
    for (const s of usable) {
      if (s.tracker.type === "sleep") continue; // hours vs bedtime is circular
      const f = bedtimeFinding(bedByDate, s);
      if (f) found.push(f);
    }
  }

  for (const s of series) {
    if (s.tracker.type === "measure") continue; // weight has no bad weekday
    const f = weekdayFinding(s);
    if (f) found.push(f);
  }

  // Most impactful first, and never more than a handful — a wall of findings
  // is how a reader learns to stop trusting them.
  return found
    .sort((x, y) => y.impact - x.impact)
    .slice(0, MAX_FINDINGS);
}

/** Whether there's any point asking yet. */
export function enoughData(series: Series[]): boolean {
  return series.filter((s) => s.byDate.size >= MIN_DAYS).length >= 2;
}

export { typeMeta };
