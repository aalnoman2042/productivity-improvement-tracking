import { addDays } from "./dates";
import { NO_REST } from "./rest";
import type { TrackerType } from "./trackers";

/**
 * A challenge is a promise with a deadline: "this tracker, every day, for N
 * days". It owns no entries of its own — it watches a tracker, and the days
 * logged on the daily page are what it's judged by. That's what keeps taking
 * a challenge cheap (nothing new to log) and giving one up harmless (the
 * tracker and its history stay).
 */
export type Challenge = {
  id: string;
  name: string;
  trackerId: string;
  /** First day that counts, YYYY-MM-DD. */
  startDate: string;
  /** How many days the challenge runs, start day included. */
  days: number;
  /** The daily bar for numeric trackers; null means "just log it". */
  target: number | null;
  /** "min" = do at least the target; "max" = stay at or under it. */
  direction: "min" | "max";
};

/** What `GET /api/challenges` returns: the challenge, the tracker it
 * watches, and every value logged inside its window. */
export type ChallengeRow = Challenge & {
  tracker: {
    name: string;
    type: TrackerType;
    unit: string;
    color: string;
    archived: boolean;
  } | null;
  /** Logged values within [startDate, end], keyed by date. */
  values: Record<string, number>;
  /** Days inside the window that were deliberately taken off. Sent with the
   * row so the page can judge a window without a second request. */
  rest?: string[];
};

/** The durations offered as one-tap chips; any length can still be typed. */
export const CHALLENGE_LENGTHS = [7, 14, 21, 30, 60, 90];

export const MAX_CHALLENGE_DAYS = 365;

/** Last day of the challenge, inclusive. */
export function challengeEnd(c: { startDate: string; days: number }): string {
  return addDays(c.startDate, c.days - 1);
}

/**
 * Did this day hold up its end of the challenge?
 *
 * `value` is what was logged that day — undefined when nothing was. "At
 * least" days must be logged and over the line; a day never filled in is a
 * day the challenge didn't happen. "At most" is an avoid-challenge, so it
 * reads the other way: a day with nothing logged is a day you stayed under.
 */
export function dayMet(
  c: Pick<Challenge, "target" | "direction">,
  value: number | undefined
): boolean {
  if (c.direction === "max") return (value ?? 0) <= (c.target ?? 0);
  if (value === undefined) return false;
  if (c.target !== null) return value >= c.target;
  // No bar to clear — any real log counts. A slip on a clean-streak tracker
  // is stored as 0, so it fails here the way it should.
  return value > 0;
}

export type ChallengeStatus = "upcoming" | "active" | "completed" | "ended";

export type ChallengeProgress = {
  status: ChallengeStatus;
  /** Last day of the window, inclusive. */
  end: string;
  /** Which day of the challenge today is (1-based); 0 before it starts,
   * clamped to `days` after it ends. */
  dayNumber: number;
  /** Days met so far. */
  met: number;
  /** Days that failed for good. Today isn't counted against you while it
   * can still be logged — only once the day is over. */
  missed: number;
  /** Days inside the window that were marked as a planned rest: not met,
   * not missed. A rest bridges a challenge; it never completes a day of it. */
  rested: number;
  /** Today is inside the window and already met. */
  todayMet: boolean;
  /** Nothing missed so far. */
  perfect: boolean;
  /** met / days, as 0–100 for a progress bar. */
  pct: number;
};

export function challengeProgress(
  c: Pick<Challenge, "startDate" | "days" | "target" | "direction"> & {
    values: Record<string, number>;
  },
  today: string,
  /**
   * Days taken off on purpose. A rest day inside the window is neither met
   * nor missed — the run survives it, and nothing is credited for it, so
   * `pct` still counts only the days the thing actually happened.
   */
  rest: ReadonlySet<string> = NO_REST
): ChallengeProgress {
  const end = challengeEnd(c);

  if (today < c.startDate) {
    return {
      status: "upcoming",
      end,
      dayNumber: 0,
      met: 0,
      missed: 0,
      rested: 0,
      todayMet: false,
      perfect: true,
      pct: 0,
    };
  }

  const over = today > end;
  let met = 0;
  let missed = 0;
  let rested = 0;
  let dayNumber = 0;
  let todayMet = false;

  for (let d = c.startDate, i = 1; d <= end && d <= today; d = addDays(d, 1), i++) {
    if (d === today) {
      dayNumber = i;
      todayMet = dayMet(c, c.values[d]);
      if (todayMet) met++;
      // An unmet today isn't a miss yet — the day isn't over.
      continue;
    }
    if (dayMet(c, c.values[d])) met++;
    // A day taken off on purpose is not a day the challenge fell over.
    else if (rest.has(d)) rested++;
    else missed++;
  }
  if (over) dayNumber = c.days;

  const status: ChallengeStatus =
    met >= c.days ? "completed" : over ? "ended" : "active";

  return {
    status,
    end,
    dayNumber,
    met,
    missed,
    rested,
    todayMet,
    perfect: missed === 0,
    pct: Math.round((met / c.days) * 100),
  };
}
