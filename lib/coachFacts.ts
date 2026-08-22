import { challengeProgress } from "./challenges";
import { FLAT_PCT, readTrend } from "./direction";
import { nightLabel, toNight } from "./clock";
import { addDays, prettyDate } from "./dates";
import { BASIS_LABEL, gradeLetter, type ReportCard } from "./report";
import { dayFactsFrom, dayScore } from "./score";
import { streakInfo } from "./streak";
import type { CoachSnapshot } from "./coach";
import {
  categoryMeta,
  formatValue,
  typeMeta,
  type Goal,
  type Tracker,
  type TrackerType,
} from "./trackers";

/**
 * Everything the coach is allowed to know, worked out before it is asked.
 *
 * The model is only as honest as the numbers it holds. Hand it a flat total
 * and it has to guess at direction, so it guesses — "your sleep is slipping"
 * off a number that never moved. So every claim it might want to make is
 * pre-computed here and handed over as a fact: this week against last week,
 * the goal hit rate, the average bedtime, the streak, the grade. The model's
 * job is to read and rank them, never to do arithmetic.
 *
 * Pure on purpose — the route feeds it plain rows, the tests feed it fixtures.
 */

/** How far back the coach reads. Two weeks = a week, plus one to compare it to. */
export const COACH_WINDOW_DAYS = 14;

/** A change smaller than this is noise, not a trend. */


/** Day-score points between "steady" and a real move, week on week. */
const MOMENTUM_STEP = 4;

/** Midnight, on the night axis (minutes since 18:00). */
const MIDNIGHT = toNight("00:00") as number;

export type CoachEntry = {
  trackerId: string;
  date: string;
  value: number;
  /** Sleep clock times and the streak slip flag, when the day carried them. */
  meta?: { start?: unknown; end?: unknown; status?: unknown } | null;
};

export type CoachChallengeRow = {
  name: string;
  trackerId: string;
  startDate: string;
  days: number;
  target: number | null;
  direction: "min" | "max";
};

export type CoachDay = {
  /** "Friday 1 Aug" — the weekday is half the story on a weekend dip. */
  day: string;
  date: string;
  score: number | null;
  goalsMet: string;
  trackersLogged: string;
  sleep: string | null;
};

export type CoachTrackerFacts = {
  name: string;
  kind: string;
  category: string;
  /** "bad" means less is better — the model gets this wrong without it. */
  habit: "good" | "bad";
  goal: string | null;
  grade: string | null;
  gradedOn: string | null;
  daysLogged: string;
  goalHit: string | null;
  last7Days: string;
  previous7Days: string;
  change: string;
  /** Which way that change reads for this habit, decided here, not there. */
  readsAs: "better" | "worse" | "about the same" | "up" | "down" | null;
  streak: {
    currentCleanDays: number;
    bestEver: number;
    slipsAllTime: number;
    lastSlip: string | null;
  } | null;
  sleepClock: {
    nights: number;
    avgBedtime: string;
    avgWakeUp: string;
    nightsPastMidnight: number;
    latestBedtime: string;
  } | null;
};

export type CoachFacts = {
  today: string;
  window: { days: number; from: string; to: string };
  rightNow: {
    dayScore: number | null;
    dayScoreDate: string | null;
    avgScoreLast7: number | null;
    avgScorePrevious7: number | null;
    momentum: string | null;
    daysLogged: string;
    loggingStreak: number;
    overallGrade: string | null;
  };
  allTime: {
    firstLogged: string | null;
    daysLogged: string;
    bestLoggingStreak: number;
    currentLoggingStreak: number;
    totalEntries: number;
    timeLogged: string;
    overallGrade: string | null;
    subjects: { category: string; grade: string; pct: number }[];
  };
  last14Days: CoachDay[];
  trackers: CoachTrackerFacts[];
  challenges: {
    name: string;
    length: string;
    status: string;
    daysDone: number;
    missed: number;
  }[];
};

function meetsGoal(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
}

const hoursLabel = (minutes: number) => formatValue(minutes, "duration", "min");

/** The period's value in the tracker's own terms — a total or a daily average. */
function periodValue(values: number[], aggregate: "sum" | "avg"): number {
  const sum = values.reduce((s, v) => s + v, 0);
  if (aggregate === "sum") return sum;
  return values.length > 0 ? sum / values.length : 0;
}

/**
 * Week on week, said in words the model can quote verbatim. Percentages off a
 * zero baseline are meaningless, so those get "nothing logged" instead of the
 * infinity a naive division would produce.
 */
function changeLabel(now: number, prev: number, prevDays: number): {
  change: string;
  pct: number | null;
} {
  if (prevDays === 0) return { change: "nothing logged the week before", pct: null };
  if (prev === 0) {
    return {
      change: now > 0 ? "up from nothing last week" : "still nothing, both weeks",
      pct: null,
    };
  }
  const pct = ((now - prev) / prev) * 100;
  const rounded = Math.round(Math.abs(pct));
  if (rounded < FLAT_PCT) return { change: `about level (${rounded}%)`, pct };
  return { change: `${pct > 0 ? "up" : "down"} ${rounded}%`, pct };
}

/**
 * What a move means for *this* habit. Up is a win on study and a loss on junk
 * food, and a model left to infer that gets it backwards often enough to
 * matter. Sleep and measurements stay unjudged — more sleep is only better
 * until it isn't, and a weight can move either way on purpose.
 */


/** Bedtimes and wake times over the window, averaged on the night axis. */
function sleepClock(rows: CoachEntry[]): CoachTrackerFacts["sleepClock"] {
  let bedSum = 0;
  let wakeSum = 0;
  let nights = 0;
  let pastMidnight = 0;
  let latest = -1;
  let latestDate: string | null = null;

  for (const r of rows) {
    const bed = toNight(r.meta?.start);
    const wake = toNight(r.meta?.end);
    // A night needs both ends: an average of half-filled nights says nothing.
    if (bed === null || wake === null) continue;
    nights++;
    bedSum += bed;
    wakeSum += wake >= bed ? wake : wake + 24 * 60;
    if (bed >= MIDNIGHT) pastMidnight++;
    if (bed > latest) {
      latest = bed;
      latestDate = r.date;
    }
  }
  if (nights === 0) return null;

  return {
    nights,
    avgBedtime: nightLabel(bedSum / nights),
    avgWakeUp: nightLabel(wakeSum / nights),
    nightsPastMidnight: pastMidnight,
    latestBedtime: `${nightLabel(latest)}${latestDate ? ` on ${prettyDate(latestDate)}` : ""}`,
  };
}

/** Which way the last seven days moved against the seven before them. */
function momentumOf(
  avg7: number | null,
  prev7: number | null
): CoachSnapshot["momentum"] {
  if (avg7 === null || prev7 === null) return null;
  const delta = avg7 - prev7;
  if (delta >= MOMENTUM_STEP) return "rising";
  if (delta <= -MOMENTUM_STEP) return "slipping";
  return "steady";
}

const mean = (ns: number[]): number | null =>
  ns.length > 0 ? Math.round(ns.reduce((s, n) => s + n, 0) / ns.length) : null;

/**
 * The whole brief: the JSON the model reads, and the snapshot the card shows.
 *
 * The snapshot is deliberately *not* the model's work — the numbers on the
 * card are computed here and rendered as given, so the headline figures stay
 * true even on a day the AI writes something clumsy.
 */
export function buildCoachFacts(
  trackers: Tracker[],
  entries: CoachEntry[],
  challenges: CoachChallengeRow[],
  report: ReportCard,
  today: string
): { facts: CoachFacts; snapshot: CoachSnapshot } {
  const since = addDays(today, -(COACH_WINDOW_DAYS - 1));
  const splitAt = addDays(today, -6); // the last 7 days start here
  const active = trackers.filter((t) => !t.archived);

  /* ---------------------- the window, day by day ----------------------- */

  const byDay = new Map<string, Record<string, number>>();
  for (const e of entries) {
    if (e.date < since || e.date > today) continue;
    const m = byDay.get(e.date) ?? {};
    m[e.trackerId] = e.value;
    byDay.set(e.date, m);
  }

  const last14Days: CoachDay[] = [];
  const days: CoachSnapshot["days"] = [];
  for (let date = since; date <= today; date = addDays(date, 1)) {
    const values = byDay.get(date) ?? {};
    const facts = dayFactsFrom(trackers, values, new Set(Object.keys(values)));
    const score = dayScore(facts);
    days.push({ date, score });
    last14Days.push({
      day: prettyDate(date),
      date,
      score,
      goalsMet: `${facts.goalsMet}/${facts.goalsTotal}`,
      trackersLogged: `${facts.logged}/${facts.trackers}`,
      sleep: facts.sleep === null ? null : hoursLabel(facts.sleep),
    });
  }

  const scoreOf = (from: string, to: string) =>
    mean(
      days
        .filter((d) => d.date >= from && d.date <= to && d.score !== null)
        .map((d) => d.score as number)
    );
  const avg7 = scoreOf(splitAt, today);
  const prevAvg7 = scoreOf(since, addDays(splitAt, -1));
  const momentum = momentumOf(avg7, prevAvg7);

  // The freshest day that has a score — today until today is logged, then
  // yesterday, so the card never shows a blank where a number belongs.
  const scored = days.filter((d) => d.score !== null);
  const latest = scored.length > 0 ? scored[scored.length - 1] : null;
  const daysLoggedInWindow = days.filter((d) => d.score !== null).length;

  /* --------------------------- per tracker ----------------------------- */

  const grades = new Map<string, { grade: string; on: string }>();
  for (const s of report.subjects) {
    for (const g of s.trackers) {
      grades.set(g.id, { grade: gradeLetter(g.score), on: BASIS_LABEL[g.basis] });
    }
  }

  let sleepLine: string | null = null;

  const trackerFacts: CoachTrackerFacts[] = active.map((t) => {
    const type = t.type as TrackerType;
    const aggregate = typeMeta(type).aggregate;
    const rows = entries.filter(
      (e) => e.trackerId === t.id && e.date >= since && e.date <= today
    );
    const recent = rows.filter((e) => e.date >= splitAt);
    const prior = rows.filter((e) => e.date < splitAt);

    const now = periodValue(recent.map((e) => e.value), aggregate);
    const prev = periodValue(prior.map((e) => e.value), aggregate);
    const { change, pct } = changeLabel(now, prev, prior.length);
    const shown = (v: number) => formatValue(v, type, t.unit);
    const per = aggregate === "sum" ? " total" : " a day";

    // Goal hit rate over the window, counted the way the rest of the app
    // counts it: an unlogged day is a zero, which fails "at least" and
    // passes "at most".
    let goalHit: string | null = null;
    if (t.goal && t.goal.period === "day") {
      let met = 0;
      for (const d of days) {
        if (meetsGoal(byDay.get(d.date)?.[t.id] ?? 0, t.goal)) met++;
      }
      goalHit = `${met}/${days.length} days`;
    }

    // A clean streak doesn't have a "23% down" — it has a run and a slip
    // date. Left as a percentage, the model dutifully reports the percentage.
    const cleanCount = (rows: CoachEntry[]) =>
      `${rows.filter((e) => e.value > 0).length} clean, ${
        rows.filter((e) => e.value <= 0).length
      } slipped`;

    let streak: CoachTrackerFacts["streak"] = null;
    if (type === "streak") {
      const all = entries.filter((e) => e.trackerId === t.id);
      const first = all.reduce<string | null>(
        (f, e) => (f === null || e.date < f ? e.date : f),
        null
      );
      const info = streakInfo(
        first,
        all.filter((e) => e.value <= 0).map((e) => e.date),
        today
      );
      streak = {
        currentCleanDays: info.current,
        bestEver: info.best,
        slipsAllTime: info.slips,
        lastSlip: info.lastSlip,
      };
    }

    const clock = type === "sleep" ? sleepClock(rows) : null;
    if (type === "sleep" && sleepLine === null && recent.length > 0) {
      const avg = periodValue(recent.map((e) => e.value), "avg");
      sleepLine = `${hoursLabel(avg)} a night${clock ? ` · bed ${clock.avgBedtime}` : ""}`;
    }

    const graded = grades.get(t.id);
    return {
      name: t.name,
      kind: typeMeta(type).label,
      category: categoryMeta(t.category).label,
      habit: t.habit ?? "good",
      goal: t.goal
        ? `${t.goal.direction === "min" ? "at least" : "at most"} ${formatValue(
            t.goal.target,
            type,
            t.unit
          )} per ${t.goal.period}`
        : null,
      grade: graded?.grade ?? null,
      gradedOn: graded?.on ?? null,
      daysLogged: `${rows.length}/${days.length}`,
      goalHit,
      last7Days:
        type === "streak"
          ? cleanCount(recent)
          : recent.length > 0
            ? shown(now) + per
            : "nothing logged",
      previous7Days:
        type === "streak"
          ? cleanCount(prior)
          : prior.length > 0
            ? shown(prev) + per
            : "nothing logged",
      change: type === "streak" ? "judge this one by the streak below" : change,
      readsAs: type === "streak" ? null : readTrend(type, t.habit ?? "good", pct),
      streak,
      sleepClock: clock,
    };
  });

  /* --------------------------- challenges ------------------------------ */

  const challengeFacts = challenges.map((c) => {
    const values: Record<string, number> = {};
    for (const e of entries) {
      if (e.trackerId === c.trackerId) values[e.date] = e.value;
    }
    const p = challengeProgress(
      {
        startDate: c.startDate,
        days: c.days,
        target: c.target,
        direction: c.direction,
        values,
      },
      today
    );
    return {
      name: c.name,
      length: `${c.days} days`,
      status: p.status,
      daysDone: p.met,
      missed: p.missed,
    };
  });

  const overallGrade = report.overall !== null ? gradeLetter(report.overall) : null;

  const facts: CoachFacts = {
    today,
    window: { days: days.length, from: since, to: today },
    rightNow: {
      dayScore: latest?.score ?? null,
      dayScoreDate: latest?.date ?? null,
      avgScoreLast7: avg7,
      avgScorePrevious7: prevAvg7,
      momentum,
      daysLogged: `${daysLoggedInWindow}/${days.length}`,
      loggingStreak: report.currentStreak,
      overallGrade,
    },
    allTime: {
      firstLogged: report.firstDate,
      daysLogged: `${report.daysLogged}/${report.spanDays}`,
      bestLoggingStreak: report.bestStreak,
      currentLoggingStreak: report.currentStreak,
      totalEntries: report.totalEntries,
      timeLogged: hoursLabel(report.timeMinutes),
      overallGrade,
      subjects: report.subjects.map((s) => ({
        category: categoryMeta(s.category).label,
        grade: gradeLetter(s.score),
        pct: Math.round(s.score * 100),
      })),
    },
    last14Days,
    trackers: trackerFacts,
    challenges: challengeFacts,
  };

  const snapshot: CoachSnapshot = {
    score: latest?.score ?? null,
    scoreDate: latest?.date ?? null,
    avg7,
    prevAvg7,
    momentum,
    days,
    daysLogged: daysLoggedInWindow,
    windowDays: days.length,
    streak: report.currentStreak,
    grade: overallGrade,
    sleep: sleepLine,
  };

  return { facts, snapshot };
}
