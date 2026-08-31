import { addDays } from "./dates";
import type { Goal } from "./trackers";

/**
 * What you promised, and when you promised it.
 *
 * A goal used to be one mutable number, which quietly made the app dishonest
 * about the past. Set "2 hours a day", hit it every day for a week, then
 * raise the bar to 5 — and last week retroactively became a week you failed,
 * because the only goal on record was the new one. The record of a promise
 * kept was overwritten by the making of a harder promise, which is close to
 * the worst thing a tracker can do to somebody: it punishes ambition.
 *
 * So a goal is a **series**, not a value. Each entry says "from this day, the
 * goal was this", and every day is judged against whatever was in force on
 * *that* day. Raise the bar on the 8th and the 1st–7th stay judged at 2
 * hours, for ever. The two stretches are kept apart on the tracker's page —
 * "2h/day, 1–7 Sep, met 7 of 7" then "5h/day, 8 Sep–, met 2 of 4" — which is
 * the thing the owner actually wanted to see: not one blended percentage, but
 * a list of commitments and how each one went.
 *
 * `tracker.goal` stays exactly what it always was — the goal in force *now* —
 * so nothing that only cares about today had to learn any of this.
 */

/** One promise, and the day it started being one. */
export type GoalPeriod = {
  /** First day this goal applied, YYYY-MM-DD. */
  from: string;
  /** The goal itself; null is a real value meaning "no goal for this stretch". */
  goal: Goal;
};

/** Newest last. An empty history means "the current goal, for all of time". */
export type GoalHistory = GoalPeriod[];

/** Two goals are the same promise. */
export function sameGoal(a: Goal, b: Goal): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.target === b.target && a.period === b.period && a.direction === b.direction
  );
}

/**
 * The goal in force on one day.
 *
 * Before the first recorded entry, the *oldest* entry's goal applies: the
 * history is only ever written when a goal changes, and the entry written at
 * that moment carries the goal that came before. So the earliest promise
 * reaches back to the beginning of the record, which is what it did in fact.
 */
export function goalOn(
  history: GoalHistory | null | undefined,
  date: string,
  current: Goal
): Goal {
  if (!history || history.length === 0) return current;
  let found: Goal = history[0].goal;
  for (const p of history) {
    if (p.from > date) break;
    found = p.goal;
  }
  return found;
}

/**
 * The history after a goal change, or null when nothing changed.
 *
 * Returning null rather than an unchanged copy is deliberate: the caller is a
 * PATCH that fires on every edit — a rename, a colour, a reminder — and only
 * an actual change of promise should leave a mark. Editing the name twice
 * must not write two identical periods.
 *
 * Two changes on the same day collapse into one. Changing your mind at 9am
 * and again at 11am is one promise made today, not two; leaving both would
 * put a zero-length period in the record and a row nobody can read on the
 * page.
 */
export function recordGoal(
  history: GoalHistory | null | undefined,
  previous: Goal,
  next: Goal,
  today: string
): GoalHistory | null {
  if (sameGoal(previous, next)) return null;
  const past = history && history.length > 0 ? [...history] : [{ from: FIRST, goal: previous }];

  const last = past[past.length - 1];
  if (last.from === today) {
    // Already changed today — rewrite that entry rather than stack another.
    past[past.length - 1] = { from: today, goal: next };
  } else {
    past.push({ from: today, goal: next });
  }
  // A day you changed your mind back to where you started leaves two
  // identical neighbours; drop the newer one so the page doesn't show a
  // promise that never differed from the one above it.
  return past.filter(
    (p, i) => i === 0 || !sameGoal(p.goal, past[i - 1].goal)
  );
}

/**
 * The day the record starts when nothing better is known.
 *
 * A tracker has a `createdAt`, but the goal it was created with is not
 * necessarily the goal it had yesterday, and rows predate this feature
 * entirely. So the first entry simply reaches back: `goalOn` treats anything
 * before the oldest entry as governed by it, and this sentinel makes that
 * explicit in the stored document rather than implied by its absence.
 */
export const FIRST = "0001-01-01";

export type GoalSpan = {
  goal: Goal;
  /** First day of the span. `FIRST` means "from the beginning of the record". */
  from: string;
  /** Last day, or null while the span is the one still running. */
  to: string | null;
};

/**
 * The history as closed spans, oldest first — what a page can draw.
 *
 * The current goal is appended when the history doesn't already end on it,
 * which is the state every tracker is in before its goal has ever changed.
 */
export function goalSpans(
  history: GoalHistory | null | undefined,
  current: Goal
): GoalSpan[] {
  const entries: GoalPeriod[] =
    history && history.length > 0 ? [...history] : [{ from: FIRST, goal: current }];
  // Defend against a document written by an older or a buggier version:
  // the spans below are meaningless unless the entries ascend.
  entries.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  return entries.map((p, i) => ({
    goal: p.goal,
    from: p.from,
    to: i < entries.length - 1 ? addDays(entries[i + 1].from, -1) : null,
  }));
}

/** Validate a stored history; anything malformed is treated as no history. */
export function parseGoalHistory(raw: unknown): GoalHistory | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: GoalHistory = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    if (typeof p.from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.from)) {
      return null;
    }
    const g = p.goal;
    if (g === null || g === undefined) {
      out.push({ from: p.from, goal: null });
      continue;
    }
    if (typeof g !== "object") return null;
    const goal = g as Record<string, unknown>;
    const target = Number(goal.target);
    if (!Number.isFinite(target) || target <= 0) return null;
    out.push({
      from: p.from,
      goal: {
        target,
        period: goal.period === "week" ? "week" : "day",
        direction: goal.direction === "max" ? "max" : "min",
      },
    });
  }
  out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return out;
}
