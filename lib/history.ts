import { formatMinutes } from "./dates";

/** The shape `/api/entries/month` returns, shared by the route and the page. */

export type MonthDay = {
  date: string;
  /** Active trackers with an entry that day. */
  logged: number;
  /** Daily goals met, and how many there were to meet. */
  goalsMet: number;
  goalsTotal: number;
  /** Minutes across every duration tracker — the day's headline number. */
  minutes: number;
  /** What was written that day, tracker by tracker. */
  notes: { tracker: string; note: string }[];
  /** The note about the day itself, if one was written. */
  dayNote: string | null;
  /**
   * What was on the day's list, and how much of it got done.
   *
   * Shown on the calendar and counted nowhere else: a task never reaches the
   * score, the goals or the streak. The square marks it for the same reason
   * it marks a note — it is something you put on that day, and a calendar
   * that hides it makes you open days to find out.
   */
  tasks: { total: number; done: number };
  /**
   * A day taken off on purpose.
   *
   * It counts towards nothing — not days logged, not a goal, not the score.
   * It is drawn so an empty square can say *why* it is empty, and so the
   * month's run can step over it the way `lib/rest` does everywhere else.
   */
  rest: boolean;
};

/**
 * The same calendar month, twelve months back.
 *
 * Absent when there is nothing there to compare against — an account in its
 * first year would otherwise be told "0 days" every month, which is noise
 * rather than a comparison.
 */
export type YearAgo = {
  /** "2025-09". */
  month: string;
  daysLogged: number;
  minutes: number;
  /** The last day counted. */
  through: string;
  /** True when only part of it was counted, to match a month still running. */
  partial: boolean;
};

export type MonthSummary = {
  month: string;
  start: string;
  end: string;
  /** Active trackers, i.e. what a fully-filled day would look like. */
  trackers: number;
  days: MonthDay[];
  daysLogged: number;
  /** The longest run of consecutive logged days inside this month. */
  bestRun: number;
  /**
   * Optional: a cached copy written before this existed simply has no year
   * to compare against, and the line is not drawn. See `yearAgoLine`.
   */
  lastYear?: YearAgo | null;
};

/**
 * How a day is drawn.
 *
 * Two channels, because they answer different questions and neither can stand
 * in for the other: the ring says you filled the day in, the fill says how it
 * went against your goals. Collapse them into one and a day you never opened
 * the app becomes indistinguishable from a day you failed at everything —
 * which is the exact distinction you need to find where you stopped.
 */
export type DayLook = {
  /** Did you log anything at all? Drawn as a ring. */
  logged: boolean;
  /** Share of the day's daily goals met, 0–1. Drawn as fill depth. */
  score: number | null;
  /** Whether there were any daily goals to judge it by. */
  judged: boolean;
};

export function dayLook(day: MonthDay | undefined): DayLook {
  if (!day || day.logged === 0) return { logged: false, score: null, judged: false };
  if (day.goalsTotal === 0) return { logged: true, score: null, judged: false };
  return {
    logged: true,
    score: day.goalsMet / day.goalsTotal,
    judged: true,
  };
}

/**
 * Fill opacity for a score. Stepped rather than continuous so neighbouring
 * days are told apart at a glance instead of shading into each other.
 */
export function fillOpacity(score: number | null): number {
  if (score === null) return 0.14; // logged, but nothing to judge it by
  if (score <= 0) return 0;
  if (score < 0.34) return 0.3;
  if (score < 0.67) return 0.55;
  if (score < 1) return 0.78;
  return 1;
}

/** What the square means, said in words for the tooltip and screen readers. */
export function dayLabel(day: MonthDay | undefined, trackers: number): string {
  if (!day || day.logged === 0) return "Nothing logged";
  const filled = `${day.logged} of ${trackers} filled in`;
  if (day.goalsTotal === 0) return filled;
  return `${filled} · ${day.goalsMet}/${day.goalsTotal} goals met`;
}

/**
 * "September so far last year: 12 days and 41h. This year: 18 and 63h."
 *
 * Deliberately one sentence and no card. The payoff for a year of logging is
 * emotional, not analytical — it belongs beside the month you are already
 * looking at, not in a panel of its own that every other month has to scroll
 * past. Adjacent months already have `PeriodCompare`; this is the one
 * comparison that needs a year to become possible and a line to be said.
 *
 * The fairness rule is the same one every other comparison here obeys: a
 * month still being lived is matched against **the same many days** of last
 * year's, never against the whole of it (`partial`). Two days of September
 * weighed against thirty would not be a comparison, it would be a scolding.
 */
export function yearAgoLine(
  now: { daysLogged: number; minutes: number },
  ago: YearAgo | null | undefined,
  monthName: string
): string | null {
  if (!ago) return null;
  const then = `${ago.daysLogged} day${ago.daysLogged === 1 ? "" : "s"}`;
  const here = `${now.daysLogged} day${now.daysLogged === 1 ? "" : "s"}`;
  const opening = ago.partial
    ? `${monthName} so far last year`
    : `${monthName} last year`;
  return (
    `${opening}: ${then} and ${formatMinutes(ago.minutes)}. ` +
    `This year: ${here} and ${formatMinutes(now.minutes)}.`
  );
}
