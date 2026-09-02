import { addDays, daysBetween } from "./dates";
import { NO_REST } from "./rest";

/**
 * The trackers that used to be a habit and quietly stopped being one.
 *
 * This is the way a tracking app dies, and it dies silently. A tracker logged
 * every day for three months and then untouched for a fortnight looks exactly
 * like one logged yesterday: same row, same colour, same place in the list.
 * Nothing on any screen says it has gone. So the list slowly fills with
 * things nobody answers, filling a day in starts to feel like failing at
 * eleven things instead of doing four, and the honest response — archiving it
 * — is a thing the app has never once suggested.
 *
 * Two rules keep this from being another thing that scolds:
 *
 *  - It only ever speaks about a tracker that was **established**. A thing
 *    tried twice and dropped is not a lapsed habit, it is a thing you decided
 *    against, and being asked about it is being asked to justify a choice you
 *    already made well.
 *  - Both answers it offers are good ones. Restarting is not the right answer
 *    and archiving the wrong one — a habit you have finished with deserves to
 *    be put away, and putting it away is what stops the list becoming a
 *    graveyard. It never says "you stopped".
 */

/** Silence before a tracker is worth mentioning at all. */
export const QUIET_DAYS = 10;

/**
 * Days off do not count as silence.
 *
 * A rest day is the app's word for "this was chosen" — it bridges a run
 * everywhere else in the codebase (`lib/rest`), and it has to bridge this
 * too. Without it a deliberate fortnight away comes back to the app offering
 * to archive every habit the person had, which is the exact opposite of what
 * a planned break is for, and it would be the second feature to punish
 * somebody for using a feature honestly.
 */

/**
 * Days on the record before a tracker counts as having been a habit.
 *
 * A fortnight, not a week: two weeks of answering something is a decision,
 * and anything less is still a trial.
 */
export const ESTABLISHED_DAYS = 14;

/** One tracker's whole history, reduced to the two facts this needs. */
export type TrackerLife = {
  trackerId: string;
  /** The last day it was logged at all. */
  last: string;
  /** How many days it has ever been logged. */
  days: number;
};

export type Quiet = {
  id: string;
  name: string;
  color: string;
  type: string;
  /** Days since it was last logged. */
  silent: number;
  last: string;
  /** How many days it was kept, which is why it is worth asking about. */
  days: number;
};

/**
 * Only what this actually reads. `toTracker` hands back `type` and `category`
 * as plain strings — the database validator is what keeps them to the known
 * set — and this has no need to narrow them, so it says so rather than making
 * every caller cast.
 */
export type FadingTracker = {
  id: string;
  name: string;
  color: string;
  type: string;
  archived: boolean;
};

/** How many days in (last, today] were marked off on purpose. */
function restDaysIn(
  last: string,
  today: string,
  rest: ReadonlySet<string>
): number {
  if (rest.size === 0) return 0;
  let n = 0;
  for (let d = addDays(last, 1); d <= today; d = addDays(d, 1)) {
    if (rest.has(d)) n += 1;
  }
  return n;
}

export function fadingTrackers(
  trackers: FadingTracker[],
  lives: TrackerLife[],
  today: string,
  rest: ReadonlySet<string> = NO_REST
): Quiet[] {
  const byId = new Map(lives.map((l) => [l.trackerId, l]));
  const out: Quiet[] = [];

  for (const t of trackers) {
    if (t.archived) continue;
    const life = byId.get(t.id);
    // Never logged is not faded — it never started, and a tracker made this
    // morning must not be asked about this afternoon.
    if (!life) continue;
    if (life.days < ESTABLISHED_DAYS) continue;

    const elapsed = daysBetween(life.last, today);
    // Deliberate days off are not silence — see the note on QUIET_DAYS. The
    // gap is still reported in full; only the decision to speak discounts
    // them, so the card never claims a shorter absence than really happened.
    const silent = elapsed - restDaysIn(life.last, today, rest);
    if (silent < QUIET_DAYS) continue;

    out.push({
      id: t.id,
      name: t.name,
      color: t.color,
      type: t.type,
      silent: elapsed,
      last: life.last,
      days: life.days,
    });
  }

  // Longest silence first: the one furthest gone is the one where the answer
  // is clearest, whichever answer it turns out to be.
  return out.sort((a, b) => b.silent - a.silent);
}

/** The heading, which has to carry a number without carrying a verdict. */
export function quietLine(quiet: Quiet[]): string {
  if (quiet.length === 0) return "";
  if (quiet.length === 1) {
    const one = quiet[0];
    return `${one.name} has been quiet for ${one.silent} days.`;
  }
  return `${quiet.length} trackers have been quiet for a while.`;
}
