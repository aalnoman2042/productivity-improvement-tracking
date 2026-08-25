import { addDays } from "./dates";
import { cleanNote } from "./notes";

/**
 * A day you meant to take off.
 *
 * Everything in this app judges the record, and the record cannot tell the
 * difference between "I gave up on Tuesday" and "Tuesday was my rest day" —
 * so it reads both as a break. That is the one place where being strictly
 * honest about the data makes the app *less* truthful about the life: a
 * planned rest is not a lapse, and an app that scolds you for one teaches
 * you to log a lie instead of taking the day.
 *
 * So a rest day is a **flag, not an entry**. Nothing is invented: the day
 * stays empty, it is still not a logged day, the score still doesn't exist
 * for it, and no number moves. What changes is only what a *run* is allowed
 * to step over — see `loggingRun` and `bestRun` below, which are the one
 * definition of a run in this codebase.
 *
 * Rule it must never break: a rest day cannot *earn* anything. It bridges a
 * streak, it never lengthens one.
 */

/** Why the day was off — optional, and for the reader alone. */
export const MAX_REST_REASON = 120;

export function cleanRestReason(raw: unknown): string | null {
  return cleanNote(raw, MAX_REST_REASON);
}

/** Nothing rested — the value every caller that doesn't care passes. */
export const NO_REST: ReadonlySet<string> = new Set<string>();

/**
 * The run of logged days alive right now.
 *
 * Today not being logged doesn't break it — the day isn't over. A rest day
 * is stepped over: it neither counts towards the run nor ends it.
 */
export function loggingRun(
  logged: ReadonlySet<string>,
  today: string,
  rest: ReadonlySet<string> = NO_REST
): number {
  let n = 0;
  let cursor = logged.has(today) || rest.has(today) ? today : addDays(today, -1);
  for (;;) {
    if (logged.has(cursor)) n++;
    else if (!rest.has(cursor)) break;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/**
 * The longest run there has ever been.
 *
 * `dates` is every day with something logged, in any order. A rest day
 * between two logged days joins them; a rest day at either end of history is
 * not a run of its own, because nothing was done in it.
 */
export function bestRun(
  dates: Iterable<string>,
  rest: ReadonlySet<string> = NO_REST
): number {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length === 0) return 0;

  let best = 0;
  let run = 0;
  let prev: string | null = null;

  for (const day of sorted) {
    run = prev !== null && bridged(prev, day, rest) ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}

/**
 * Is everything between these two logged days accounted for — either because
 * they are consecutive, or because every day in the gap was a planned rest?
 */
function bridged(from: string, to: string, rest: ReadonlySet<string>): boolean {
  let cursor = addDays(from, 1);
  // A gap of a year of rest days is still a bridge, but it is also somebody
  // marking every day off; the loop is bounded by the gap itself, which is
  // bounded by how long the account has existed.
  while (cursor < to) {
    if (!rest.has(cursor)) return false;
    cursor = addDays(cursor, 1);
  }
  return cursor === to;
}
