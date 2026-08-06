import type { Goal, Tracker, TrackerType } from "./trackers";
import type { Stats } from "./stats";

/**
 * The day score: one number, 0–100, for "how did the day actually go?".
 *
 * Rule-based and instant — no AI involved. Four ingredients, weighted by how
 * much they say about the day, and a component that doesn't apply (no sleep
 * tracker, no goals set) hands its weight to the others instead of dragging
 * the score down:
 *
 *   goals   50 — day-goals hit, the clearest signal you set yourself
 *   logging 20 — showing up: trackers filled in
 *   sleep   15 — inside the healthy band (7–9h), with partial credit outside
 *   clean   15 — streaks unbroken and bad habits at zero
 */

export type DayFacts = {
  /** Day-period goals met, of how many exist. */
  goalsMet: number;
  goalsTotal: number;
  /** Trackers logged that day, of how many are active. */
  logged: number;
  trackers: number;
  /** Minutes slept, when a sleep tracker was logged that day. */
  sleep: number | null;
  /** Streaks kept + bad habits avoided, of how many such trackers exist. */
  clean: number;
  cleanTotal: number;
};

const SLEEP_LO = 7 * 60;
const SLEEP_HI = 9 * 60;

/** Credit for a night: 1 inside 7–9h, sliding to 0 as it leaves the band. */
export function sleepCredit(minutes: number): number {
  if (minutes >= SLEEP_LO && minutes <= SLEEP_HI) return 1;
  if (minutes < SLEEP_LO) return Math.max(0, minutes / SLEEP_LO);
  // Past 9h: each extra hour costs a quarter of the credit.
  return Math.max(0, 1 - (minutes - SLEEP_HI) / 240);
}

/** The day as 0–100, or null when nothing was logged at all. */
export function dayScore(f: DayFacts): number | null {
  if (f.logged === 0) return null;

  const parts: { weight: number; value: number }[] = [];
  if (f.goalsTotal > 0) {
    parts.push({ weight: 50, value: f.goalsMet / f.goalsTotal });
  }
  if (f.trackers > 0) {
    parts.push({ weight: 20, value: f.logged / f.trackers });
  }
  if (f.sleep !== null) {
    parts.push({ weight: 15, value: sleepCredit(f.sleep) });
  }
  if (f.cleanTotal > 0) {
    parts.push({ weight: 15, value: f.clean / f.cleanTotal });
  }
  if (parts.length === 0) return null;

  const total = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.reduce((s, p) => s + p.value * (p.weight / total), 0);
  return Math.round(score * 100);
}

function meetsGoal(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
}

/**
 * The facts for one day, read off per-tracker day values.
 *
 * `values` holds what was logged that day keyed by tracker id (absent =
 * not logged); `loggedIds` are the trackers with an entry that day — a slip
 * or an explicit 0 still counts as having shown up to log.
 */
export function dayFactsFrom(
  trackers: Tracker[],
  values: Record<string, number>,
  loggedIds: Set<string>
): DayFacts {
  const active = trackers.filter((t) => !t.archived);
  let goalsMet = 0;
  let goalsTotal = 0;
  let sleep: number | null = null;
  let clean = 0;
  let cleanTotal = 0;

  for (const t of active) {
    const type = t.type as TrackerType;
    const value = values[t.id];

    if (t.goal && t.goal.period === "day") {
      goalsTotal++;
      if (meetsGoal(value ?? 0, t.goal)) goalsMet++;
    }

    if (type === "sleep" && value !== undefined && value > 0) {
      // More than one sleep tracker would be odd; the last one wins.
      sleep = value;
    }

    if (type === "streak") {
      cleanTotal++;
      // Unlogged doesn't break a streak; an explicit slip (0) does.
      if (value === undefined || value > 0) clean++;
    } else if (t.habit === "bad" && !t.goal) {
      // Goal-carrying bad habits are already judged by their goal above.
      cleanTotal++;
      if (!value) clean++;
    }
  }

  return {
    goalsMet,
    goalsTotal,
    logged: active.filter((t) => loggedIds.has(t.id)).length,
    trackers: active.length,
    sleep,
    clean,
    cleanTotal,
  };
}

/**
 * Day scores for every day bucket in a Stats payload (the Status page's
 * ranges are all day-granularity). Keys are dates; missing days scored null.
 */
export function scoresFromStats(stats: Stats): { date: string; score: number | null }[] {
  if (stats.granularity !== "day") return [];
  return stats.buckets.map((b) => {
    const logged = new Set(Object.keys(b.counts));
    return {
      date: b.key,
      score: dayScore(dayFactsFrom(stats.trackers, b.values, logged)),
    };
  });
}
