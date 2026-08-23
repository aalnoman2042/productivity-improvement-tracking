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
