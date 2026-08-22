import type { Goal, Habit, TrackerType } from "./trackers";

/**
 * Which way is up.
 *
 * Every part of the app that judges a change has to answer the same question
 * — is more of this better? — and it must answer it identically, or the
 * Patterns card, the coach and the month comparison will disagree about the
 * same number in front of the same person. So the rule lives here, once.
 *
 * The habit flag is the user's clearest statement of direction and outranks
 * the type's default: junk food rising alongside study time is a cost, not a
 * win. The exception is a clean-streak tracker, whose *value* counts clean
 * days — more of that is better even though the habit it guards is a bad one.
 */

export function wantMore(
  type: TrackerType,
  habit: Habit = "good",
  goal?: Goal
): boolean | null {
  if (type === "streak") return true;
  if (habit === "bad") return false;
  if (goal) return goal.direction === "min";
  if (type === "measure") return null; // weight could go either way
  return true;
}

/**
 * Below this, a change is noise dressed up as news. The number the AI coach
 * has always used; everything that reports a change now uses the same one, so
 * "about level" in one place can't be "up" in another.
 */
export const FLAT_PCT = 10;

export type Trend = "better" | "worse" | "about the same" | "up" | "down" | null;

/**
 * How a percentage change reads for this tracker. Sleep and measurements
 * report their direction plainly — eight hours could be catching up or
 * oversleeping, and 2kg could be either — because calling those good or bad
 * needs a goal, which the caller has and this doesn't.
 */
export function readTrend(
  type: TrackerType,
  habit: Habit,
  pct: number | null
): Trend {
  if (pct === null) return null;
  if (Math.abs(pct) < FLAT_PCT) return "about the same";
  const up = pct > 0;
  if (type === "sleep" || type === "measure") return up ? "up" : "down";
  return habit === "bad" ? (up ? "worse" : "better") : up ? "better" : "worse";
}
