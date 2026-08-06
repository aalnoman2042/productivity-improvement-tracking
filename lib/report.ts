import { addDays, bucketOf, bucketsForRange, daysBetween } from "./dates";
import { challengeProgress } from "./challenges";
import { categoryMeta, type Goal } from "./trackers";

/**
 * The report card: the whole account, graded.
 *
 * Everything here is pure — the API route feeds it plain rows and today's
 * date, and the same functions run under tests. Each tracker is graded on
 * the fairest thing it can be graded on: goal hit rate when it has a goal,
 * clean-day rate for streaks, and plain showing-up rate for the rest. A
 * tracker is only judged over its *own* lifetime (first entry → today), so
 * adding something new never dents the old subjects' marks.
 */

export type ReportTracker = {
  id: string;
  name: string;
  type: string;
  category: string;
  color: string;
  goal: Goal;
  habit?: "good" | "bad";
  archived: boolean;
};

export type ReportEntry = { trackerId: string; date: string; value: number };

export type ReportChallenge = {
  trackerId: string;
  startDate: string;
  days: number;
  target: number | null;
  direction: "min" | "max";
};

/** What a tracker was graded on. */
export type GradeBasis = "goals" | "clean" | "logging";

export const BASIS_LABEL: Record<GradeBasis, string> = {
  goals: "goals hit",
  clean: "days clean",
  logging: "days logged",
};

export type GradedTracker = {
  id: string;
  name: string;
  color: string;
  score: number; // 0..1
  basis: GradeBasis;
  /** Days actually logged, and the days it was answerable for. */
  days: number;
  lifetime: number;
};

export type Subject = {
  category: string;
  score: number;
  trackers: GradedTracker[];
};

export type ReportCard = {
  hasData: boolean;
  /** The first day anything was ever logged. */
  firstDate: string | null;
  /** Days from that first day through today, inclusive. */
  spanDays: number;
  daysLogged: number;
  totalEntries: number;
  bestStreak: number;
  currentStreak: number;
  /** All-time minutes on "time spent" trackers. */
  timeMinutes: number;
  subjects: Subject[];
  /** Mean score across every graded tracker; null when nothing is gradeable. */
  overall: number | null;
  /** Active trackers with too little history to be judged fairly. */
  ungraded: { id: string; name: string }[];
  challenges: {
    total: number;
    completed: number;
    running: number;
    fell: number;
  } | null;
};

/** A subject needs at least a week of life before a grade means anything. */
export const MIN_GRADE_DAYS = 7;

export function gradeLetter(score: number): string {
  if (score >= 0.9) return "A+";
  if (score >= 0.8) return "A";
  if (score >= 0.7) return "B";
  if (score >= 0.55) return "C";
  if (score >= 0.4) return "D";
  return "F";
}

/**
 * Motivation with your own numbers in it.
 *
 * A pool of short lines built from the report — the grade, the streak, the
 * weakest subject — for the Status page to pick one from at random, the same
 * way the generic quote pool works. Personal beats generic: "your best run
 * is 12 days" lands harder than any borrowed aphorism. Empty when there's
 * no data, so the caller can fall back to the shared quote pool.
 */
export function reportLines(r: ReportCard): string[] {
  if (!r.hasData) return [];
  const out: string[] = [];
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  if (r.overall !== null) {
    const letter = gradeLetter(r.overall);
    if (letter === "A+" || letter === "A") {
      out.push(
        `You're carrying an ${letter} overall. That's not luck — that's ${r.daysLogged} logged days doing their job.`,
        `Top of the class: ${letter} overall. Tonight's entry keeps it that way.`
      );
    } else if (letter === "B") {
      out.push(
        `A solid B overall — the habits are real. One weak subject is all that stands between this and an A.`
      );
    } else {
      out.push(
        `The grade says ${letter}. The ${days(r.daysLogged)} you showed up say you haven't quit — that's the part that decides how this ends.`
      );
    }
  }

  if (r.currentStreak >= 3) {
    out.push(
      `You're ${days(r.currentStreak)} into a logging run${
        r.currentStreak >= r.bestStreak
          ? " — your best ever. Don't hand it back tonight."
          : ` — the record is ${r.bestStreak}. Go take it.`
      }`
    );
  } else if (r.bestStreak >= 7) {
    out.push(
      `Your best run is ${days(r.bestStreak)}. You've done it before, which is the whole proof you can do it again — day one is tonight.`
    );
  }

  const weakest = r.subjects[0];
  if (weakest && weakest.score < 0.7) {
    out.push(
      `One target this week: ${categoryMeta(weakest.category).label}. It's the weakest subject, which makes it the fastest way to move the whole card.`
    );
  }

  if (r.challenges && r.challenges.completed > 0) {
    out.push(
      `${r.challenges.completed} challenge${r.challenges.completed === 1 ? "" : "s"} completed, every day of ${
        r.challenges.completed === 1 ? "it" : "them"
      } on record. You finish what you take.`
    );
  }

  if (r.timeMinutes >= 60 * 50) {
    out.push(
      `${Math.floor(r.timeMinutes / 60)} hours of tracked, deliberate time. Most people guess — you know.`
    );
  }

  return out;
}

function meetsGoal(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
}

/**
 * One tracker's mark, over its own lifetime. Null when there's nothing to
 * grade — never logged, or younger than a week.
 */
function gradeTracker(
  t: ReportTracker,
  dayValues: Map<string, number>,
  today: string
): GradedTracker | null {
  if (dayValues.size === 0) return null;
  let first = today;
  for (const d of dayValues.keys()) if (d < first) first = d;
  const lifetime = daysBetween(first, today) + 1;
  if (lifetime < MIN_GRADE_DAYS) return null;

  const graded = (score: number, basis: GradeBasis): GradedTracker => ({
    id: t.id,
    name: t.name,
    color: t.color,
    score,
    basis,
    days: dayValues.size,
    lifetime,
  });

  if (t.goal) {
    if (t.goal.period === "day") {
      let met = 0;
      // Unlogged days read as 0 — which fails an "at least" goal and passes
      // an "at most" one, the same rule the Status page grades a week by.
      for (let d = first; d <= today; d = addDays(d, 1)) {
        if (meetsGoal(dayValues.get(d) ?? 0, t.goal)) met++;
      }
      return graded(met / lifetime, "goals");
    }
    const weekly = new Map<string, number>();
    for (const [date, value] of dayValues) {
      const wk = bucketOf(date, "week");
      weekly.set(wk, (weekly.get(wk) ?? 0) + value);
    }
    const weeks = bucketsForRange(first, today, "week");
    let met = 0;
    for (const wk of weeks) if (meetsGoal(weekly.get(wk) ?? 0, t.goal)) met++;
    return graded(weeks.length > 0 ? met / weeks.length : 0, "goals");
  }

  if (t.type === "streak") {
    let slips = 0;
    for (const v of dayValues.values()) if (v <= 0) slips++;
    return graded((lifetime - slips) / lifetime, "clean");
  }

  // A bad habit without a goal is marked the way a streak is: on the days it
  // *didn't* happen. Grading it on showing up would reward doing it more.
  if (t.habit === "bad") {
    let did = 0;
    for (const v of dayValues.values()) if (v > 0) did++;
    return graded((lifetime - did) / lifetime, "clean");
  }

  // No goal, nothing to stay clean from — the mark is for showing up.
  return graded(dayValues.size / lifetime, "logging");
}

export function buildReportCard(
  trackers: ReportTracker[],
  entries: ReportEntry[],
  challenges: ReportChallenge[],
  today: string
): ReportCard {
  const empty: ReportCard = {
    hasData: false,
    firstDate: null,
    spanDays: 0,
    daysLogged: 0,
    totalEntries: 0,
    bestStreak: 0,
    currentStreak: 0,
    timeMinutes: 0,
    subjects: [],
    overall: null,
    ungraded: [],
    challenges: null,
  };
  if (entries.length === 0) return empty;

  /* ------------------------- roll the history up ------------------------ */

  const byTracker = new Map<string, Map<string, number>>();
  const dates = new Set<string>();
  for (const e of entries) {
    let m = byTracker.get(e.trackerId);
    if (!m) byTracker.set(e.trackerId, (m = new Map()));
    m.set(e.date, e.value);
    dates.add(e.date);
  }

  const sorted = [...dates].sort();
  const firstDate = sorted[0];
  const spanDays = daysBetween(firstDate, today) + 1;

  // Longest run of consecutive logged days, ever.
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    prev = d;
  }

  // And the run that's alive right now. Today not being logged yet doesn't
  // break it — the day isn't over.
  let currentStreak = 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  while (dates.has(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  const durationIds = new Set(
    trackers.filter((t) => t.type === "duration").map((t) => t.id)
  );
  let timeMinutes = 0;
  for (const e of entries) {
    if (durationIds.has(e.trackerId)) timeMinutes += e.value;
  }

  /* ------------------------------- grades ------------------------------- */

  // Archived trackers still count in the totals above — they happened — but
  // they aren't graded: putting something away shouldn't keep marking you.
  const graded: (GradedTracker & { category: string })[] = [];
  const ungraded: { id: string; name: string }[] = [];
  for (const t of trackers) {
    if (t.archived) continue;
    const g = gradeTracker(t, byTracker.get(t.id) ?? new Map(), today);
    if (g) graded.push({ ...g, category: t.category });
    else ungraded.push({ id: t.id, name: t.name });
  }

  const byCategory = new Map<string, (GradedTracker & { category: string })[]>();
  for (const g of graded) {
    const key = g.category.toLowerCase();
    const list = byCategory.get(key) ?? [];
    list.push(g);
    byCategory.set(key, list);
  }
  const subjects: Subject[] = [...byCategory.values()]
    .map((list) => ({
      category: list[0].category,
      score: list.reduce((s, g) => s + g.score, 0) / list.length,
      trackers: list
        .map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          score: g.score,
          basis: g.basis,
          days: g.days,
          lifetime: g.lifetime,
        }))
        .sort((a, b) => b.score - a.score),
    }))
    // Weakest subject first — a report card is for knowing what to work on.
    .sort((a, b) => a.score - b.score);

  const overall =
    graded.length > 0
      ? graded.reduce((s, g) => s + g.score, 0) / graded.length
      : null;

  /* ----------------------------- challenges ----------------------------- */

  let challengeStats: ReportCard["challenges"] = null;
  if (challenges.length > 0) {
    let completed = 0;
    let running = 0;
    let fell = 0;
    for (const c of challenges) {
      const values: Record<string, number> = {};
      const m = byTracker.get(c.trackerId);
      if (m) for (const [d, v] of m) values[d] = v;
      const p = challengeProgress({ ...c, values }, today);
      if (p.status === "completed") completed++;
      else if (p.status === "ended") fell++;
      else running++;
    }
    challengeStats = { total: challenges.length, completed, running, fell };
  }

  return {
    hasData: true,
    firstDate,
    spanDays,
    daysLogged: dates.size,
    totalEntries: entries.length,
    bestStreak,
    currentStreak,
    timeMinutes,
    subjects,
    overall,
    ungraded,
    challenges: challengeStats,
  };
}
