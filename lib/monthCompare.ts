import { addMonths, daysBetween, formatMinutes, monthRange } from "./dates";
import { FLAT_PCT, readTrend, type Trend } from "./direction";
import { formatValue, type Habit, type TrackerType } from "./trackers";

/**
 * This month against last month.
 *
 * The report card grades a lifetime and the coach reads a fortnight; between
 * them sits the question people actually ask themselves — *am I having a
 * better month than the last one?* Nothing in the app answered it.
 *
 * The whole difficulty is making the comparison fair, and it is fair here in
 * three ways:
 *
 *  1. **Like-for-like windows.** On the 22nd, this month is 22 days old and
 *     last month was 31 — so the 22nd is compared to the 22nd. A running
 *     month never looks like a collapse just because it hasn't finished.
 *  2. **The right average per kind.** Time and counts are averaged over every
 *     day in the window, because a gap *is* the result. Sleep, weight and
 *     mood are averaged over the days they were recorded, because an
 *     unlogged night is not a night of no sleep. Yes/no habits read as a
 *     rate: the share of days it happened.
 *  3. **One rule about which way is up** (`lib/direction`), so a rising junk
 *     food average is never reported as an improvement.
 */

/** How a tracker's month is summarised, decided by its kind. */
export type MonthMetric =
  /** Total over every day in the window — a gap counts as zero. */
  | "dailyAvg"
  /** Averaged over the days it was actually recorded. */
  | "perLogged"
  /** Share of days it happened, 0–1. */
  | "rate";

export function metricFor(type: TrackerType): MonthMetric {
  if (type === "sleep" || type === "measure" || type === "scale") return "perLogged";
  if (type === "check" || type === "streak") return "rate";
  return "dailyAvg"; // duration, count, prayer
}

/** One tracker's raw totals for one window, as the route reads them. */
export type MonthTotals = {
  /** Sum of the values recorded in the window. */
  total: number;
  /** Days with an entry. */
  logged: number;
  /** Days that count as "done" — yes/no kinds only. */
  done: number;
};

export type TrackerMonth = {
  id: string;
  name: string;
  color: string;
  unit: string;
  type: TrackerType;
  habit: Habit;
  now: MonthTotals;
  before: MonthTotals;
};

export type MonthChange = {
  id: string;
  name: string;
  color: string;
  /** What is being compared, said plainly: "a day", "a night", "of days". */
  basis: string;
  now: string;
  before: string;
  /** Percentage change, or null when there is no honest baseline. */
  pct: number | null;
  change: string;
  readsAs: Trend;
};

/**
 * The two stretches being compared: this month so far, and the same number of
 * days at the start of the month before.
 *
 * A short month is why the previous window is clamped rather than mirrored —
 * comparing 31 days of March to "31 days" of February would quietly borrow
 * two days of March into the baseline.
 */
export function compareWindows(
  month: string,
  today: string
): {
  now: { start: string; end: string };
  before: { start: string; end: string };
  days: number;
  /** True while the month is still running — the comparison is to date. */
  partial: boolean;
} {
  const current = monthRange(month);
  const running = today >= current.start && today < current.end;
  const end = running ? today : current.end;
  const days = daysBetween(current.start, end) + 1;

  const prev = monthRange(addMonths(month, -1));
  const prevDays = daysBetween(prev.start, prev.end) + 1;
  const beforeEnd = addDaysWithin(prev.start, Math.min(days, prevDays) - 1);

  return {
    now: { start: current.start, end },
    before: { start: prev.start, end: beforeEnd },
    days,
    partial: running,
  };
}

/** Day arithmetic on a date string, kept local so this file stays pure. */
function addDaysWithin(start: string, add: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

/** The one number that stands for a tracker's month. */
function metricValue(
  metric: MonthMetric,
  totals: MonthTotals,
  days: number
): number | null {
  if (metric === "dailyAvg") return days > 0 ? totals.total / days : null;
  if (metric === "rate") return days > 0 ? totals.done / days : null;
  return totals.logged > 0 ? totals.total / totals.logged : null;
}

function say(
  metric: MonthMetric,
  value: number | null,
  type: TrackerType,
  unit: string
): string {
  if (value === null) return "nothing logged";
  if (metric === "rate") return `${Math.round(value * 100)}%`;
  if (type === "duration" || type === "sleep") return formatMinutes(Math.round(value));
  return formatValue(Math.round(value * 10) / 10, type, unit);
}

function basisFor(metric: MonthMetric, type: TrackerType): string {
  if (metric === "rate") return "of days";
  if (type === "sleep") return "a night";
  if (metric === "perLogged") return "when logged";
  return "a day";
}

/**
 * Said in words, and honest about the cases arithmetic can't describe:
 * a percentage off a zero baseline is not a big improvement, it is a
 * different situation, and it says so.
 */
function changeLabel(now: number | null, before: number | null): {
  change: string;
  pct: number | null;
} {
  if (now === null && before === null) return { change: "nothing either month", pct: null };
  if (before === null || before === 0) {
    return { change: now && now > 0 ? "new this month" : "nothing either month", pct: null };
  }
  if (now === null || now === 0) return { change: "stopped this month", pct: null };
  const pct = ((now - before) / before) * 100;
  const rounded = Math.round(Math.abs(pct));
  if (rounded < FLAT_PCT) return { change: "about level", pct };
  return { change: `${pct > 0 ? "up" : "down"} ${rounded}%`, pct };
}

/**
 * Every tracker's month against its last, biggest movement first — with the
 * ones that can't be compared (new, or empty both months) last, because
 * "nothing either month" is not news.
 */
export function compareMonths(
  trackers: TrackerMonth[],
  days: number,
  prevDays: number
): MonthChange[] {
  return trackers
    .map((t) => {
      const metric = metricFor(t.type);
      const now = metricValue(metric, t.now, days);
      const before = metricValue(metric, t.before, prevDays);
      const { change, pct } = changeLabel(now, before);
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        basis: basisFor(metric, t.type),
        now: say(metric, now, t.type, t.unit),
        before: say(metric, before, t.type, t.unit),
        pct,
        change,
        readsAs:
          // A streak tracker's month-on-month rate says little — the run
          // itself is the story, and the report card already tells it.
          t.type === "streak" ? null : readTrend(t.type, t.habit, pct),
      };
    })
    .sort((a, b) => weigh(b.pct) - weigh(a.pct));
}

/** How loudly a change speaks. No comparison at all speaks last, not first. */
function weigh(pct: number | null): number {
  return pct === null ? -1 : Math.abs(pct);
}

/** The headline pair of numbers, and whether the month is ahead or behind. */
export type MonthHeadline = {
  daysLogged: { now: number; before: number };
  minutes: { now: number; before: number };
  goals: { now: number | null; before: number | null };
};
