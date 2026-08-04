import { NextResponse } from "next/server";
import { type Document, type WithId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker } from "@/lib/trackerDoc";
import { typeMeta, type Goal, type TrackerType } from "@/lib/trackers";
import type { StreakInfo } from "@/lib/stats";
import {
  PERIOD_BUCKET,
  addDays,
  bucketLabel,
  bucketOf,
  bucketsForRange,
  daysBetween,
  isValidDateStr,
  periodRange,
  type Period,
} from "@/lib/dates";

const VALID_PERIODS: Period[] = ["week", "15d", "month", "6mo", "year"];

/**
 * Clean-streak trackers count days since the last slip, not consecutive
 * check-ins — a day you simply didn't open the app shouldn't reset a
 * three-month run.
 */
function streakInfo(
  first: string | null,
  slipDates: string[],
  today: string
): StreakInfo {
  if (!first) {
    return { current: 0, best: 0, slips: 0, lastSlip: null, since: null };
  }

  const slips = [...new Set(slipDates)].filter((d) => d <= today).sort();
  // The day before the first entry: every run is measured from a boundary,
  // and this is the boundary the first run starts from.
  const boundaries = [addDays(first, -1), ...slips];

  let best = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    best = Math.max(best, daysBetween(boundaries[i], boundaries[i + 1]) - 1);
  }

  const last = boundaries[boundaries.length - 1];
  const current = Math.max(0, daysBetween(last, today));

  return {
    current,
    best: Math.max(best, current),
    slips: slips.length,
    lastSlip: slips.length > 0 ? slips[slips.length - 1] : null,
    since: first,
  };
}

function meetsGoal(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
}

type Rollup = {
  sum: number;
  days: number;
  best: number;
  bestDate: string | null;
  dayValues: Map<string, number>;
};

const emptyRollup = (): Rollup => ({
  sum: 0,
  days: 0,
  best: 0,
  bestDate: null,
  dayValues: new Map(),
});

/** Per-tracker totals for one slice of time. */
function rollupEntries(entries: WithId<Document>[]): Map<string, Rollup> {
  const out = new Map<string, Rollup>();
  for (const e of entries) {
    const id = String(e.trackerId);
    const value = Number(e.value);
    const date = String(e.date);
    const r = out.get(id) ?? emptyRollup();
    r.sum += value;
    r.days += 1;
    if (value > r.best) {
      r.best = value;
      r.bestDate = date;
    }
    r.dayValues.set(date, value);
    out.set(id, r);
  }
  return out;
}

function goalProgress(
  goal: Goal,
  r: Rollup,
  start: string,
  end: string,
  days: number
): { met: number; total: number } | null {
  if (!goal) return null;

  if (goal.period === "day") {
    let met = 0;
    for (let i = 0; i < days; i++) {
      if (meetsGoal(r.dayValues.get(addDays(start, i)) ?? 0, goal)) met++;
    }
    return { met, total: days };
  }

  const weekly = new Map<string, number>();
  for (const [date, value] of r.dayValues) {
    const wk = bucketOf(date, "week");
    weekly.set(wk, (weekly.get(wk) ?? 0) + value);
  }
  const weeks = bucketsForRange(start, end, "week");
  let met = 0;
  for (const wk of weeks) if (meetsGoal(weekly.get(wk) ?? 0, goal)) met++;
  return { met, total: weeks.length };
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const period = params.get("period") as Period | null;
  const today = params.get("today");
  if (!period || !VALID_PERIODS.includes(period) || !isValidDateStr(today)) {
    return NextResponse.json(
      { error: "period and today=YYYY-MM-DD required" },
      { status: 400 }
    );
  }

  const { start, end, days } = periodRange(period, today);
  // The equally long stretch just before this one, for "up or down?".
  const prevStart = addDays(start, -days);
  const prevEnd = addDays(start, -1);
  const granularity = PERIOD_BUCKET[period];
  const d = await db();

  const [trackerDocs, allEntries, loggedDates] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find({ userId, date: { $gte: prevStart, $lte: end } })
      .toArray(),
    d.collection("entries").distinct("date", {
      userId,
      date: { $gte: addDays(today, -400), $lte: today },
    }),
  ]);

  const trackers = trackerDocs.map(toTracker);

  // Clean streaks run for as long as they run — a week's worth of entries
  // says nothing about a four-month streak — so they get their own all-time
  // roll-up. One small grouped read, and only when such a tracker exists.
  const streakIds = trackerDocs
    .filter((t) => t.type === "streak")
    .map((t) => t._id);
  const streaks = new Map<string, StreakInfo>();
  if (streakIds.length > 0) {
    const rows = await d
      .collection("entries")
      .aggregate<{ _id: unknown; first: string; slips: string[] }>([
        { $match: { userId, trackerId: { $in: streakIds } } },
        {
          $group: {
            _id: "$trackerId",
            first: { $min: "$date" },
            slips: {
              $push: {
                $cond: [{ $lte: ["$value", 0] }, "$date", "$$REMOVE"],
              },
            },
          },
        },
      ])
      .toArray();
    for (const row of rows) {
      streaks.set(
        String(row._id),
        streakInfo(row.first ?? null, row.slips ?? [], today)
      );
    }
  }

  const current = allEntries.filter((e) => String(e.date) >= start);
  const previous = allEntries.filter((e) => String(e.date) < start);

  const now = rollupEntries(current);
  const before = rollupEntries(previous);

  // --- Buckets for the charts -------------------------------------------
  const bucketKeys = bucketsForRange(start, end, granularity);
  const buckets = bucketKeys.map((key) => ({
    key,
    label: bucketLabel(key, granularity),
    values: {} as Record<string, number>,
    counts: {} as Record<string, number>,
    quality: {} as Record<string, { sum: number; n: number }>,
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const e of current) {
    const bucket = byKey.get(bucketOf(String(e.date), granularity));
    if (!bucket) continue;
    const id = String(e.trackerId);
    const value = Number(e.value);
    bucket.values[id] = (bucket.values[id] ?? 0) + value;
    bucket.counts[id] = (bucket.counts[id] ?? 0) + 1;
    const q = e.meta?.quality;
    if (typeof q === "number") {
      const slot = bucket.quality[id] ?? { sum: 0, n: 0 };
      bucket.quality[id] = { sum: slot.sum + q, n: slot.n + 1 };
    }
  }

  // --- Per-tracker summary ----------------------------------------------
  const summary: Record<string, unknown> = {};

  for (const tracker of trackers) {
    const r = now.get(tracker.id) ?? emptyRollup();
    const p = before.get(tracker.id) ?? emptyRollup();
    const aggregate = typeMeta(tracker.type as TrackerType).aggregate;

    // Compare like with like: totals for things that add up, daily averages
    // for things like weight or mood where a total is meaningless.
    const nowValue = aggregate === "sum" ? r.sum : r.days > 0 ? r.sum / r.days : 0;
    const prevValue = aggregate === "sum" ? p.sum : p.days > 0 ? p.sum / p.days : 0;
    const changePct =
      prevValue > 0 ? ((nowValue - prevValue) / prevValue) * 100 : null;

    summary[tracker.id] = {
      sum: r.sum,
      days: r.days,
      best: r.best,
      bestDate: r.bestDate,
      avgPerDay: aggregate === "sum" ? r.sum / days : 0,
      avgPerLoggedDay: r.days > 0 ? r.sum / r.days : 0,
      goal: goalProgress(tracker.goal, r, start, end, days),
      previous: { sum: p.sum, days: p.days, value: prevValue },
      changePct,
      streak: streaks.get(tracker.id) ?? null,
    };
  }

  // --- Streak ------------------------------------------------------------
  const logged = new Set(loggedDates as string[]);
  let streak = 0;
  let cursor = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const daysLogged = new Set(current.map((e) => String(e.date))).size;
  const prevDaysLogged = new Set(previous.map((e) => String(e.date))).size;

  return NextResponse.json({
    period,
    start,
    end,
    prevStart,
    prevEnd,
    days,
    granularity,
    trackers,
    buckets,
    summary,
    streak,
    daysLogged,
    prevDaysLogged,
    hasEntries: current.length > 0,
  });
}
