import { addDays, prettyDate } from "./dates";

/**
 * The days that got away.
 *
 * Missing three days is how tracking dies — not because the days matter, but
 * because the *hole* does: a record with a gap in it stops feeling like
 * yours, and the cure the app offered was to navigate to each missing date
 * one at a time and fill in a whole screen. Almost nobody does that twice.
 *
 * So this is the arithmetic behind one screen that lists the blank days and
 * lets each be answered in taps — or marked off (`lib/rest`), which is often
 * the true answer and costs one tap instead of a lie.
 *
 * Two rules it must keep:
 * - **Today is never in the list.** The day is still being lived; calling it
 *   missed would be the app being wrong before lunch.
 * - **A rest day is not a hole.** It was answered, with "I took it off".
 */

/** How far back the screen looks by default. */
export const CATCHUP_DAYS = 14;

/** The furthest back it will ever look — beyond this it is archaeology. */
export const MAX_CATCHUP_DAYS = 60;

export function catchupBack(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return CATCHUP_DAYS;
  return Math.min(MAX_CATCHUP_DAYS, n);
}

/**
 * The window, oldest first, ending yesterday. Oldest first because that is
 * the order they happened in, and a list that starts with the day furthest
 * away is a list you finish.
 */
export function catchupWindow(today: string, back = CATCHUP_DAYS): string[] {
  const days: string[] = [];
  for (let i = back; i >= 1; i--) days.push(addDays(today, -i));
  return days;
}

export type CatchupDay = {
  date: string;
  /** Trackers with something on record that day. */
  logged: number;
  /** Marked as a day off on purpose — answered, not missing. */
  rest: boolean;
};

/** The blank days in a window: nothing logged, and never marked off. */
export function missedDays(days: CatchupDay[]): CatchupDay[] {
  return days.filter((d) => d.logged === 0 && !d.rest);
}

/**
 * What the screen says at the top.
 *
 * Never scolds and never counts a rest day against anybody — the tone rule
 * the whole app follows (see `lib/tasks`'s `taskSummary`): state the number,
 * offer the next move, pass no judgement on the person.
 */
export function catchupLine(days: CatchupDay[], back = CATCHUP_DAYS): string {
  const missed = missedDays(days);
  if (missed.length === 0) {
    return `Nothing missing in the last ${back} days. The record is whole.`;
  }
  if (missed.length === 1) {
    return `One blank day in the last ${back}: ${prettyDate(missed[0].date)}. A few taps and it's back.`;
  }
  return `${missed.length} blank days in the last ${back}. Fill in what you remember, mark off what was a day away, and leave the rest — a gap you can explain is not a gap.`;
}
