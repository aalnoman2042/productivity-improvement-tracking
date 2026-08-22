import { addMonths, daysBetween, formatMinutes, monthRange } from "./dates";
import { FLAT_PCT, readTrend, type Trend } from "./direction";
import { formatValue, type Habit, type TrackerType } from "./trackers";

/**
 * This week against last week, and this month against last month.
 *
 * The report card grades a lifetime and the coach reads a fortnight; between
 * them sits the question people actually ask themselves — *am I having a
 * better week, a better month, than the last one?* Nothing in the app
 * answered it. Both cadences run through exactly the same arithmetic; only
 * the window differs.
 *
 * The whole difficulty is making the comparison fair, and it is fair here in
 * three ways:
 *
 *  1. **Like-for-like windows.** On the 22nd, this month is 22 days old and
 *     last month was 31 — so the 22nd is compared to the 22nd, and Wednesday
 *     to last Wednesday. A running period never looks like a collapse just
 *     because it hasn't finished.
 *  2. **The right average per kind.** Time and counts are averaged over every
 *     day in the window, because a gap *is* the result. Sleep, weight and
 *     mood are averaged over the days they were recorded, because an
 *     unlogged night is not a night of no sleep. Yes/no habits read as a
 *     rate: the share of days it happened.
 *  3. **One rule about which way is up** (`lib/direction`), so a rising junk
 *     food average is never reported as an improvement.
 */

/** How a tracker's stretch is summarised, decided by its kind. */
export type PeriodMetric =
  /** Total over every day in the window — a gap counts as zero. */
  | "dailyAvg"
  /** Averaged over the days it was actually recorded. */
  | "perLogged"
  /** Share of days it happened, 0–1. */
  | "rate";

export function metricFor(type: TrackerType): PeriodMetric {
  if (type === "sleep" || type === "measure" || type === "scale") return "perLogged";
  if (type === "check" || type === "streak") return "rate";
  return "dailyAvg"; // duration, count, prayer
}

/** One tracker's raw totals for one window, as the route reads them. */
export type PeriodTotals = {
  /** Sum of the values recorded in the window. */
  total: number;
  /** Days with an entry. */
  logged: number;
  /** Days that count as "done" — yes/no kinds only. */
  done: number;
};

export type TrackerPeriod = {
  id: string;
  name: string;
  color: string;
  unit: string;
  type: TrackerType;
  habit: Habit;
  now: PeriodTotals;
  before: PeriodTotals;
};

export type PeriodChange = {
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

/** The two cadences worth comparing: the week you're in, the month you're in. */
export type ComparePeriod = "week" | "month";

export type CompareWindow = {
  now: { start: string; end: string };
  before: { start: string; end: string };
  days: number;
  /** True while the period is still running — the comparison is to date. */
  partial: boolean;
};

/** Monday of the week a date falls in. Weeks start Monday everywhere here. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * The two stretches being compared: this period so far, and the same number
 * of days at the start of the one before it.
 *
 * A short month is why the previous window is clamped rather than mirrored —
 * comparing 31 days of March to "31 days" of February would quietly borrow
 * two days of March into the baseline. Weeks are all seven days long, so the
 * clamp is a no-op there, but the same rule runs for both: Wednesday is
 * compared to last Wednesday, not to a whole finished week.
 */
export function compareWindows(
  anchor: string,
  today: string,
  period: ComparePeriod = "month"
): CompareWindow {
  const current =
    period === "week"
      ? { start: weekStart(anchor), end: addDaysWithin(weekStart(anchor), 6) }
      : monthRange(anchor);
  const running = today >= current.start && today < current.end;
  const end = running ? today : current.end;
  const days = daysBetween(current.start, end) + 1;

  const prev =
    period === "week"
      ? {
          start: addDaysWithin(current.start, -7),
          end: addDaysWithin(current.start, -1),
        }
      : monthRange(addMonths(anchor.slice(0, 7), -1));
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
  metric: PeriodMetric,
  totals: PeriodTotals,
  days: number
): number | null {
  if (metric === "dailyAvg") return days > 0 ? totals.total / days : null;
  if (metric === "rate") return days > 0 ? totals.done / days : null;
  return totals.logged > 0 ? totals.total / totals.logged : null;
}

function say(
  metric: PeriodMetric,
  value: number | null,
  type: TrackerType,
  unit: string
): string {
  if (value === null) return "nothing logged";
  if (metric === "rate") return `${Math.round(value * 100)}%`;
  if (type === "duration" || type === "sleep") return formatMinutes(Math.round(value));
  return formatValue(Math.round(value * 10) / 10, type, unit);
}

function basisFor(metric: PeriodMetric, type: TrackerType): string {
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
function changeLabel(
  now: number | null,
  before: number | null,
  period: ComparePeriod
): {
  change: string;
  pct: number | null;
} {
  const both = `nothing either ${period}`;
  if (now === null && before === null) return { change: both, pct: null };
  if (before === null || before === 0) {
    return { change: now && now > 0 ? `new this ${period}` : both, pct: null };
  }
  if (now === null || now === 0) return { change: `stopped this ${period}`, pct: null };
  const pct = ((now - before) / before) * 100;
  const rounded = Math.round(Math.abs(pct));
  if (rounded < FLAT_PCT) return { change: "about level", pct };
  return { change: `${pct > 0 ? "up" : "down"} ${rounded}%`, pct };
}

/**
 * Every tracker's stretch against the one before it, biggest movement first —
 * with the ones that can't be compared (new, or empty both times) last,
 * because "nothing either week" is not news.
 */
export function comparePeriods(
  trackers: TrackerPeriod[],
  days: number,
  prevDays: number,
  period: ComparePeriod = "month"
): PeriodChange[] {
  return trackers
    .map((t) => {
      const metric = metricFor(t.type);
      const now = metricValue(metric, t.now, days);
      const before = metricValue(metric, t.before, prevDays);
      const { change, pct } = changeLabel(now, before, period);
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
export type PeriodHeadline = {
  daysLogged: { now: number; before: number };
  minutes: { now: number; before: number };
  goals: { now: number | null; before: number | null };
};
