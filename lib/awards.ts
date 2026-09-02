import { formatValue, type TrackerType } from "./trackers";
import type { ReportCard, ReportEntry, ReportTracker } from "./report";

/**
 * The other half of the report card.
 *
 * This app grades constantly and celebrates never: every screen is an
 * assessment, and somebody who has kept a record for two hundred days is
 * shown a percentage for their trouble. So this is the one page with no
 * judgement anywhere on it — nothing here can go down, nothing is failed,
 * and there is no "you are behind". It reads the rows the report card
 * already reads and says only what went right.
 *
 * Three parts, in the order they matter:
 *  - a RANK, a name for how far you have come, earned by meeting every one
 *    of its requirements rather than by averaging them;
 *  - AWARDS, discrete and permanent — one earned is never taken away by a
 *    bad month, because it did happen;
 *  - RECORDS, the best each tracker has ever been.
 *
 * Nothing here is invented and nothing is rounded up: every figure is a
 * count of days that are actually on the record.
 */

export type Standing = {
  daysLogged: number;
  bestRun: number;
  /** The report card's overall score, 0..1. */
  goalRate: number;
  challengesDone: number;
};

export type RankStep = {
  name: string;
  blurb: string;
  need: Standing;
};

/**
 * The ladder.
 *
 * Every requirement of a rank has to be met — you do not average your way to
 * Unbreakable — and that is the whole design. A single number would make the
 * title a restatement of "has opened the app a lot"; four that must all hold
 * means the name describes something true about the record. They also pull
 * in different directions on purpose: days logged is patience, the best run
 * is consistency, the goal rate is honesty about what you promised, and a
 * finished challenge is something you chose to do that was hard.
 */
export const RANKS: RankStep[] = [
  {
    name: "Newcomer",
    blurb: "The record has started. That is the part most people never do.",
    need: { daysLogged: 0, bestRun: 0, goalRate: 0, challengesDone: 0 },
  },
  {
    name: "Consistent",
    blurb: "Two weeks in, and a whole week of them without a gap.",
    need: { daysLogged: 14, bestRun: 7, goalRate: 0, challengesDone: 0 },
  },
  {
    name: "Dedicated",
    blurb:
      "Six weeks on the record, a fortnight unbroken, and you keep half of what you promise.",
    need: { daysLogged: 45, bestRun: 14, goalRate: 0.5, challengesDone: 0 },
  },
  {
    name: "Relentless",
    blurb: "A hundred days, a month of them in a row, and a challenge seen through.",
    need: { daysLogged: 100, bestRun: 30, goalRate: 0.6, challengesDone: 1 },
  },
  {
    name: "Unbreakable",
    blurb:
      "Two hundred days. Two months without a single break. Most days, you do what you said you would.",
    need: { daysLogged: 200, bestRun: 60, goalRate: 0.7, challengesDone: 2 },
  },
  {
    name: "Alpha",
    blurb:
      "A year on the record, a hundred days unbroken, four promises in five kept. There is no rung above this one.",
    need: { daysLogged: 365, bestRun: 100, goalRate: 0.8, challengesDone: 3 },
  },
];

export type Rank = {
  name: string;
  blurb: string;
  /** Where this sits on the ladder, and how long the ladder is. */
  step: number;
  of: number;
  /** The next rung and what is still missing for it. Null at the top. */
  next: { name: string; needs: string[] } | null;
};

export type Award = {
  id: string;
  icon: string;
  name: string;
  detail: string;
  earned: boolean;
  /** How far along, 0..1 — so a locked award still shows the distance. */
  progress: number;
};

export type BestDay = {
  trackerId: string;
  name: string;
  color: string;
  value: string;
  date: string;
};

export type Awards = {
  hasData: boolean;
  rank: Rank;
  standing: Standing;
  awards: Award[];
  /** The best single day each tracker has ever had. */
  bests: BestDay[];
  /** The day the most trackers were filled in, and how many. */
  fullestDay: { date: string; count: number; of: number } | null;
  /** The calendar month with the most days on the record. */
  bestMonth: { month: string; days: number } | null;
  /** All-time minutes on time trackers, straight from the report card. */
  timeMinutes: number;
};

const meets = (have: Standing, need: Standing): boolean =>
  have.daysLogged >= need.daysLogged &&
  have.bestRun >= need.bestRun &&
  have.goalRate >= need.goalRate &&
  have.challengesDone >= need.challengesDone;

/** What is still missing for a rank, said as things to do rather than as gaps. */
function missing(have: Standing, need: Standing): string[] {
  const out: string[] = [];
  if (have.daysLogged < need.daysLogged) {
    const n = need.daysLogged - have.daysLogged;
    out.push(`${n} more day${n === 1 ? "" : "s"} on the record`);
  }
  if (have.bestRun < need.bestRun) {
    out.push(`a run of ${need.bestRun} days`);
  }
  if (have.goalRate < need.goalRate) {
    out.push(`${Math.round(need.goalRate * 100)}% of your goals kept`);
  }
  if (have.challengesDone < need.challengesDone) {
    const n = need.challengesDone - have.challengesDone;
    out.push(`${n} more challenge${n === 1 ? "" : "s"} finished`);
  }
  return out;
}

export function rankFor(standing: Standing): Rank {
  // Downwards, so the answer is the highest rung whose every requirement
  // holds — never a lower one that happens to be passed on the way.
  let step = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (meets(standing, RANKS[i].need)) {
      step = i;
      break;
    }
  }
  const here = RANKS[step];
  const up = RANKS[step + 1];
  return {
    name: here.name,
    blurb: here.blurb,
    step,
    of: RANKS.length,
    next: up ? { name: up.name, needs: missing(standing, up.need) } : null,
  };
}

/** A count against a threshold, as a fraction that never exceeds one. */
const toward = (have: number, need: number): number =>
  need <= 0 ? 1 : Math.min(1, have / need);

/**
 * The kinds where "your best day" is a number worth remembering. A check or
 * a streak has no best day — every day it happened is the same day.
 */
const MEASURED: TrackerType[] = ["duration", "count", "sleep", "measure", "prayer"];

export function buildAwards({
  trackers,
  entries,
  report,
}: {
  trackers: ReportTracker[];
  entries: ReportEntry[];
  report: ReportCard;
}): Awards {
  const standing: Standing = {
    daysLogged: report.daysLogged,
    bestRun: report.bestStreak,
    goalRate: report.overall ?? 0,
    challengesDone: report.challenges?.completed ?? 0,
  };

  const active = trackers.filter((t) => !t.archived);
  const activeIds = new Set(active.map((t) => t.id));

  // One pass for all three of: each tracker's best day, how many trackers
  // each day carried, and how many days each month holds.
  const best = new Map<string, { value: number; date: string }>();
  const perDay = new Map<string, number>();
  const perMonth = new Map<string, Set<string>>();

  for (const e of entries) {
    // Coverage — how full a day was, and which months hold days at all —
    // counts only trackers that still EXIST to be filled in. Archiving does
    // not delete a tracker's entries, so counting them here measured a
    // historical row against today's tracker list and could render "6/4".
    if (activeIds.has(e.trackerId)) {
      // A logged day, not a non-zero one. A streak slip is `value 0` WITH
      // meta (invariant 2) and a day it was recorded on is a day that was
      // answered — filtering on `value > 0` would have called it blank and
      // disagreed with the report card's own days-logged on the same screen.
      perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1);
      const month = e.date.slice(0, 7);
      const days = perMonth.get(month);
      if (days) days.add(e.date);
      else perMonth.set(month, new Set([e.date]));
    }

    // A personal best, on the other hand, does need a real number.
    if (!(e.value > 0)) continue;
    const seen = best.get(e.trackerId);
    // Strictly greater, so a record keeps the date it was FIRST set on
    // rather than sliding forward every time it is equalled.
    if (!seen || e.value > seen.value) {
      best.set(e.trackerId, { value: e.value, date: e.date });
    }
  }

  const bests: BestDay[] = [];
  for (const t of trackers) {
    if (t.archived) continue;
    if (!MEASURED.includes(t.type as TrackerType)) continue;
    // A bad habit has no best day. Its maximum is its WORST day — the biggest
    // binge, the latest night — and printing that under "your best day at
    // each of these", on the one page in the app with no judgement on it,
    // would be the app congratulating somebody for the thing they are trying
    // to stop. Invariant 4: bad habits invert everything.
    if (t.habit === "bad") continue;
    const b = best.get(t.id);
    if (!b) continue;
    bests.push({
      trackerId: t.id,
      name: t.name,
      color: t.color,
      // The unit is dropped on purpose: the wall is read as a list of names
      // and numbers, and "12 glasses" beside "3h 40m" reads better than the
      // tracker's own unit repeated in both places.
      value: formatValue(b.value, t.type as TrackerType, ""),
      date: b.date,
    });
  }

  let fullestDay: Awards["fullestDay"] = null;
  for (const [date, count] of perDay) {
    if (!fullestDay || count > fullestDay.count) {
      fullestDay = { date, count, of: active.length };
    }
  }

  let bestMonth: Awards["bestMonth"] = null;
  for (const [month, days] of perMonth) {
    if (!bestMonth || days.size > bestMonth.days) {
      bestMonth = { month, days: days.size };
    }
  }

  const hours = Math.round(report.timeMinutes / 60);
  const done = standing.challengesDone;
  const overall = report.overall ?? 0;
  const fullest = fullestDay?.count ?? 0;

  const awards: Award[] = [
    {
      id: "first-week",
      icon: "🌱",
      name: "First week",
      detail: "Seven days on the record",
      earned: standing.daysLogged >= 7,
      progress: toward(standing.daysLogged, 7),
    },
    {
      id: "century",
      icon: "💯",
      name: "Century",
      detail: "A hundred days logged",
      earned: standing.daysLogged >= 100,
      progress: toward(standing.daysLogged, 100),
    },
    {
      id: "a-year",
      icon: "🗓️",
      name: "A year of it",
      detail: "365 days on the record",
      earned: standing.daysLogged >= 365,
      progress: toward(standing.daysLogged, 365),
    },
    {
      id: "iron-fortnight",
      icon: "🔗",
      name: "Iron fortnight",
      detail: "Fourteen days without a gap",
      earned: standing.bestRun >= 14,
      progress: toward(standing.bestRun, 14),
    },
    {
      id: "iron-month",
      icon: "⛓️",
      name: "Iron month",
      detail: "Thirty days without a gap",
      earned: standing.bestRun >= 30,
      progress: toward(standing.bestRun, 30),
    },
    {
      id: "unbroken-hundred",
      icon: "🏔️",
      name: "Unbroken hundred",
      detail: "A hundred days in a row",
      earned: standing.bestRun >= 100,
      progress: toward(standing.bestRun, 100),
    },
    {
      id: "challenger",
      icon: "🏆",
      name: "Challenger",
      detail: "A challenge seen all the way through",
      earned: done >= 1,
      progress: toward(done, 1),
    },
    {
      id: "triple-crown",
      icon: "🥇",
      name: "Triple crown",
      detail: "Three challenges finished",
      earned: done >= 3,
      progress: toward(done, 3),
    },
    {
      id: "top-marks",
      icon: "🎓",
      name: "Top marks",
      detail: "An A on the all-time report card",
      earned: overall >= 0.9,
      progress: toward(overall, 0.9),
    },
    {
      id: "thousand-hours",
      icon: "⏳",
      name: "A thousand hours",
      detail: "1,000 hours of tracked time",
      earned: hours >= 1000,
      progress: toward(hours, 1000),
    },
    {
      id: "full-house",
      icon: "🌕",
      name: "Full house",
      detail: "A day with every tracker filled in",
      // An account with no trackers has not earned this by vacuum.
      earned: active.length > 0 && fullest >= active.length,
      progress: active.length > 0 ? toward(fullest, active.length) : 0,
    },
  ];

  return {
    hasData: report.hasData,
    rank: rankFor(standing),
    standing,
    awards,
    bests: bests.sort((a, b) => a.name.localeCompare(b.name)),
    fullestDay,
    bestMonth,
    timeMinutes: report.timeMinutes,
  };
}
