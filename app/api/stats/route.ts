import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker } from "../trackers/route";
import { typeMeta, type Goal, type TrackerType } from "@/lib/trackers";
import {
  PERIOD_BUCKET,
  addDays,
  bucketLabel,
  bucketOf,
  bucketsForRange,
  isValidDateStr,
  periodRange,
  type Period,
} from "@/lib/dates";

const VALID_PERIODS: Period[] = ["week", "15d", "month", "6mo", "year"];

function meetsGoal(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
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
  const granularity = PERIOD_BUCKET[period];
  const d = await db();

  const [trackerDocs, entryDocs, loggedDates] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find({ userId, date: { $gte: start, $lte: end } })
      .toArray(),
    d
      .collection("entries")
      .distinct("date", {
        userId,
        date: { $gte: addDays(today, -400), $lte: today },
      }),
  ]);

  const trackers = trackerDocs.map(toTracker);
  const typeOf = new Map<string, TrackerType>(
    trackers.map((t) => [t.id, t.type as TrackerType])
  );

  // --- Buckets for the trend charts -------------------------------------
  const bucketKeys = bucketsForRange(start, end, granularity);
  const buckets = bucketKeys.map((key) => ({
    key,
    label: bucketLabel(key, granularity),
    /** Sum of values in this bucket, per tracker. */
    values: {} as Record<string, number>,
    /** How many days in this bucket had an entry (so averages are honest). */
    counts: {} as Record<string, number>,
    /** Sleep quality, summed and counted so the client can average it. */
    quality: {} as Record<string, { sum: number; n: number }>,
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  // --- Per-tracker rollups ----------------------------------------------
  const totals = new Map<
    string,
    { sum: number; days: number; best: number; dayValues: Map<string, number> }
  >();

  for (const e of entryDocs) {
    const tid = String(e.trackerId);
    const value = Number(e.value);
    const date = String(e.date);

    const bucket = byKey.get(bucketOf(date, granularity));
    if (bucket) {
      bucket.values[tid] = (bucket.values[tid] ?? 0) + value;
      bucket.counts[tid] = (bucket.counts[tid] ?? 0) + 1;
      const q = e.meta?.quality;
      if (typeof q === "number") {
        const slot = bucket.quality[tid] ?? { sum: 0, n: 0 };
        bucket.quality[tid] = { sum: slot.sum + q, n: slot.n + 1 };
      }
    }

    const t = totals.get(tid) ?? {
      sum: 0,
      days: 0,
      best: 0,
      dayValues: new Map<string, number>(),
    };
    t.sum += value;
    t.days += 1;
    t.best = Math.max(t.best, value);
    t.dayValues.set(date, value);
    totals.set(tid, t);
  }

  // --- Goals -------------------------------------------------------------
  const summary: Record<
    string,
    {
      sum: number;
      days: number;
      best: number;
      avgPerDay: number;
      avgPerLoggedDay: number;
      goal: { met: number; total: number } | null;
    }
  > = {};

  for (const tracker of trackers) {
    const t = totals.get(tracker.id) ?? {
      sum: 0,
      days: 0,
      best: 0,
      dayValues: new Map<string, number>(),
    };
    const aggregate = typeMeta(tracker.type as TrackerType).aggregate;

    let goalStat: { met: number; total: number } | null = null;
    if (tracker.goal) {
      const goal = tracker.goal;
      if (goal.period === "day") {
        // Judge every day in the range: a missed "at least" day counts as a miss.
        let met = 0;
        for (let i = 0; i < days; i++) {
          const date = addDays(start, i);
          if (meetsGoal(t.dayValues.get(date) ?? 0, goal)) met++;
        }
        goalStat = { met, total: days };
      } else {
        const weekly = new Map<string, number>();
        for (const [date, value] of t.dayValues) {
          const wk = bucketOf(date, "week");
          weekly.set(wk, (weekly.get(wk) ?? 0) + value);
        }
        const weeks = bucketsForRange(start, end, "week");
        let met = 0;
        for (const wk of weeks) if (meetsGoal(weekly.get(wk) ?? 0, goal)) met++;
        goalStat = { met, total: weeks.length };
      }
    }

    summary[tracker.id] = {
      sum: t.sum,
      days: t.days,
      best: t.best,
      avgPerDay: aggregate === "sum" ? t.sum / days : 0,
      avgPerLoggedDay: t.days > 0 ? t.sum / t.days : 0,
      goal: goalStat,
    };
  }

  // --- Streak: consecutive logged days ending today (or yesterday) --------
  const logged = new Set(loggedDates as string[]);
  let streak = 0;
  let cursor = logged.has(today) ? today : addDays(today, -1);
  while (logged.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  return NextResponse.json({
    period,
    start,
    end,
    days,
    granularity,
    trackers,
    buckets,
    summary,
    streak,
    daysLogged: new Set(entryDocs.map((e) => String(e.date))).size,
    hasEntries: entryDocs.length > 0,
    typeOf: Object.fromEntries(typeOf),
  });
}
