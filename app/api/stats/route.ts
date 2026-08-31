import { NextResponse } from "next/server";
import { type Document, type WithId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker } from "@/lib/trackerDoc";
import { typeMeta, type Goal, type TrackerType } from "@/lib/trackers";
import { toNight } from "@/lib/clock";
import { streakInfo } from "@/lib/streak";
import { loggingRun } from "@/lib/rest";
import type { ClockSummary, StreakInfo } from "@/lib/stats";
import {
  PERIOD_BUCKET,
  addDays,
  bucketLabel,
  bucketOf,
  bucketsForRange,
  isValidDateStr,
  periodRange,
  previousRange,
  type Period,
} from "@/lib/dates";

const VALID_PERIODS: Period[] = ["week", "15d", "month", "6mo", "year"];

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

/**
 * A night on the night axis, or null unless *both* ends were logged — a bar
 * needs two ends, and an average of half-filled nights would say nothing.
 */
function nightOf(meta: unknown): { bed: number; wake: number } | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as { start?: unknown; end?: unknown };
  const bed = toNight(m.start);
  const wake = toNight(m.end);
  if (bed === null || wake === null) return null;
  // Woke "before" bed on the axis means the night crossed 18:00 the other way
  // — a daytime sleep. Push the wake round so the pair still reads as a span.
  return { bed, wake: wake >= bed ? wake : wake + 24 * 60 };
}

type ClockRoll = {
  nights: number;
  bedSum: number;
  wakeSum: number;
  earliestBed: number;
  latestBed: number;
  latestBedDate: string | null;
};

/** Bedtimes and wake times per sleep tracker, over one slice of time. */
function rollupClocks(
  entries: WithId<Document>[],
  sleepIds: Set<string>
): Map<string, ClockRoll> {
  const out = new Map<string, ClockRoll>();
  for (const e of entries) {
    const id = String(e.trackerId);
    if (!sleepIds.has(id)) continue;
    const night = nightOf(e.meta);
    if (!night) continue;
    const r =
      out.get(id) ??
      {
        nights: 0,
        bedSum: 0,
        wakeSum: 0,
        earliestBed: Infinity,
        latestBed: -Infinity,
        latestBedDate: null,
      };
    r.nights += 1;
    r.bedSum += night.bed;
    r.wakeSum += night.wake;
    if (night.bed < r.earliestBed) r.earliestBed = night.bed;
    if (night.bed > r.latestBed) {
      r.latestBed = night.bed;
      r.latestBedDate = String(e.date);
    }
    out.set(id, r);
  }
  return out;
}

function clockSummary(r: ClockRoll | undefined, prev: ClockRoll | undefined): ClockSummary | null {
  if (!r || r.nights === 0) return null;
  return {
    nights: r.nights,
    bed: r.bedSum / r.nights,
    wake: r.wakeSum / r.nights,
    earliestBed: r.earliestBed,
    latestBed: r.latestBed,
    latestBedDate: r.latestBedDate,
    prevBed: prev && prev.nights > 0 ? prev.bedSum / prev.nights : null,
  };
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
  // Only weeks that lie WHOLLY inside the unit can be judged. A calendar
  // month almost never starts on a Monday, so its first and last weeks are
  // clipped — and a "5 per week" goal cannot be met in the two days of a
  // week that fall inside the month, which used to score it 0/1 and call a
  // perfect month a failure. Under the old rolling windows the length was
  // fixed and this could not happen.
  const weeks = bucketsForRange(start, end, "week").filter(
    (wk) => wk >= start && addDays(wk, 6) <= end
  );
  // Unless there are none at all — a short unit still deserves an answer,
  // and its one clipped week is the best available.
  const judged = weeks.length > 0 ? weeks : bucketsForRange(start, end, "week");
  let met = 0;
  for (const wk of judged) if (meetsGoal(weekly.get(wk) ?? 0, goal)) met++;
  return { met, total: judged.length };
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const period = params.get("period") as Period | null;
  const today = params.get("today");
  // Which August: any day inside the wanted unit, defaulting to the one the
  // reader is living in. Normalised below, so a client can't ask for half a
  // month by sending a stray date.
  const anchor = params.get("anchor");
  if (!period || !VALID_PERIODS.includes(period) || !isValidDateStr(today)) {
    return NextResponse.json(
      { error: "period and today=YYYY-MM-DD required" },
      { status: 400 }
    );
  }
  if (anchor !== null && !isValidDateStr(anchor)) {
    return NextResponse.json({ error: "anchor must be YYYY-MM-DD" }, { status: 400 });
  }

  const range = periodRange(period, anchor ?? today, today);
  const { start, end, days, unitEnd, partial } = range;
  // The unit just before this one, for "up or down?".
  const { start: prevStart, end: prevEnd } = previousRange(period, range);
  const granularity = PERIOD_BUCKET[period];
  const d = await db();

  const trackersQ = d
    .collection("trackers")
    .find({ userId })
    .sort({ order: 1 })
    .toArray();

  // Clean streaks run for as long as they run — a week's worth of entries
  // says nothing about a four-month streak — so they get their own all-time
  // roll-up. It needs the tracker list to know which ids to read, so it
  // chains off that (tiny) query and overlaps with the big entries read
  // below, instead of costing a round trip after everything else.
  const streaksQ = trackersQ.then((docs) => {
    const streakIds = docs.filter((t) => t.type === "streak").map((t) => t._id);
    if (streakIds.length === 0) return [];
    return d
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
  });

  const [trackerDocs, allEntries, loggedDates, streakRows, restDocs, firstDoc] =
    await Promise.all([
      trackersQ,
      d
        .collection("entries")
        .find(
          { userId, date: { $gte: prevStart, $lte: end } },
          // Up to two years of rows on the year view — ship only the fields
          // the roll-ups read: not notes or timestamps, and of `meta` just the
          // sleep times and quality, not prayer parts or streak status.
          {
            projection: {
              trackerId: 1,
              date: 1,
              value: 1,
              "meta.start": 1,
              "meta.end": 1,
              "meta.quality": 1,
              _id: 0,
            },
          }
        )
        .toArray(),
      d.collection("entries").distinct("date", {
        userId,
        date: { $gte: addDays(today, -400), $lte: today },
      }),
      streaksQ,
      // Days taken off on purpose. Sparse enough to read whole — a few dozen
      // rows over years — and needed twice: to count the ones inside this
      // period, and to keep the streak from breaking on one.
      d
        .collection("restDays")
        .find({ userId, date: { $lte: today } }, { projection: { date: 1, _id: 0 } })
        .toArray(),
      // The first day ever logged, which is as far back as the period picker
      // can offer to go.
      d
        .collection("entries")
        .find({ userId }, { projection: { date: 1, _id: 0 }, sort: { date: 1 }, limit: 1 })
        .toArray(),
    ]);

  const restDates = new Set(restDocs.map((r) => String(r.date)));
  const restDays = [...restDates].filter((x) => x >= start && x <= end).length;
  const firstLogged = firstDoc.length > 0 ? String(firstDoc[0].date) : null;

  const trackers = trackerDocs.map(toTracker);

  const streaks = new Map<string, StreakInfo>();
  for (const row of streakRows) {
    streaks.set(
      String(row._id),
      streakInfo(row.first ?? null, row.slips ?? [], today)
    );
  }

  const current = allEntries.filter((e) => String(e.date) >= start);
  const previous = allEntries.filter(
    (e) => String(e.date) >= prevStart && String(e.date) <= prevEnd
  );

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
    clock: {} as Record<string, { nights: number; bed: number; wake: number }>,
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  const sleepIds = new Set(
    trackers.filter((t) => t.type === "sleep").map((t) => t.id)
  );

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
    // Bedtimes accumulate as sums here and are divided through below, so a
    // week bucket shows the average night rather than the last one in it.
    if (sleepIds.has(id)) {
      const night = nightOf(e.meta);
      if (night) {
        const slot = bucket.clock[id] ?? { nights: 0, bed: 0, wake: 0 };
        bucket.clock[id] = {
          nights: slot.nights + 1,
          bed: slot.bed + night.bed,
          wake: slot.wake + night.wake,
        };
      }
    }
  }

  for (const bucket of buckets) {
    for (const [id, slot] of Object.entries(bucket.clock)) {
      bucket.clock[id] = {
        nights: slot.nights,
        bed: slot.bed / slot.nights,
        wake: slot.wake / slot.nights,
      };
    }
  }

  const nowClocks = rollupClocks(current, sleepIds);
  const beforeClocks = rollupClocks(previous, sleepIds);

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
      clock: clockSummary(
        nowClocks.get(tracker.id),
        beforeClocks.get(tracker.id)
      ),
    };
  }

  // --- Streak ------------------------------------------------------------
  // Through rest days, not over them: a day you meant to take off is not the
  // day you gave up, and this has to say the same number the report card
  // says — both go through `loggingRun`.
  const logged = new Set(loggedDates as string[]);
  const streak = loggingRun(logged, today, restDates);

  const daysLogged = new Set(current.map((e) => String(e.date))).size;
  const prevDaysLogged = new Set(previous.map((e) => String(e.date))).size;

  return NextResponse.json({
    period,
    start,
    end,
    unitEnd,
    partial,
    // Whether this unit is the one being lived. Everything computed against
    // `today` — the logging streak, "N days clean", "last slip was" — is only
    // a true sentence inside it; browse back to July and those facts are
    // still about September. The readers check this rather than each one
    // reinventing the test.
    live: today >= start && today <= unitEnd,
    firstLogged,
    prevStart,
    prevEnd,
    days,
    granularity,
    trackers,
    buckets,
    summary,
    streak,
    restDays,
    daysLogged,
    prevDaysLogged,
    hasEntries: current.length > 0,
  });
}
