import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr, isValidMonthStr, toDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import {
  compareMonths,
  compareWindows,
  type MonthChange,
  type MonthHeadline,
  type MonthTotals,
} from "@/lib/monthCompare";
import type { Goal, TrackerType } from "@/lib/trackers";

/**
 * This month against the last one, tracker by tracker.
 *
 * Two windows of entries, one pass each, and the judging is left to
 * `lib/monthCompare` — including the part that matters most, which is that
 * the two windows are the same length. `?today=` is the client's date, as
 * everywhere else that a date is scoped to the reader rather than the server.
 */

export type MonthCompare = {
  month: string;
  previous: string;
  days: number;
  partial: boolean;
  headline: MonthHeadline;
  trackers: MonthChange[];
};

function meets(value: number, goal: NonNullable<Goal>): boolean {
  return goal.direction === "min" ? value >= goal.target : value <= goal.target;
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const month = params.get("month");
  if (!isValidMonthStr(month)) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }
  const askedToday = params.get("today");
  const today = isValidDateStr(askedToday) ? askedToday : toDateStr(new Date());

  const window = compareWindows(month, today);
  const prevDays =
    Math.round(
      (Date.parse(`${window.before.end}T00:00:00Z`) -
        Date.parse(`${window.before.start}T00:00:00Z`)) /
        86_400_000
    ) + 1;

  const d = await db();
  const [trackerDocs, nowRows, beforeRows] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: window.now.start, $lte: window.now.end } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: window.before.start, $lte: window.before.end } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
  ]);

  const active = trackerDocs.map(toTracker).filter((t) => !t.archived);
  const byId = new Map(active.map((t) => [t.id, t]));

  /** Per-tracker totals, plus the day-level numbers for the headline. */
  function gather(rows: Record<string, unknown>[]) {
    const totals = new Map<string, MonthTotals>();
    const days = new Set<string>();
    let minutes = 0;
    let goalsMet = 0;
    let goalsTotal = 0;
    const dailyGoals = active.filter((t) => t.goal?.period === "day");
    const perDay = new Map<string, Map<string, number>>();

    for (const r of rows) {
      const id = String(r.trackerId);
      const tracker = byId.get(id);
      // Entries for an archived tracker stay in the database but shouldn't
      // count — you can't compare a month against what is no longer shown.
      if (!tracker) continue;
      const value = Number(r.value);
      const date = String(r.date);

      const slot = totals.get(id) ?? { total: 0, logged: 0, done: 0 };
      slot.total += value;
      slot.logged += 1;
      if (value > 0) slot.done += 1;
      totals.set(id, slot);

      days.add(date);
      if (tracker.type === "duration") minutes += value;

      const day = perDay.get(date) ?? new Map<string, number>();
      day.set(id, value);
      perDay.set(date, day);
    }

    // A goal counts as missed on a day something was logged; a blank day is
    // a gap, not a failure — the same rule the calendar draws by.
    for (const [, values] of perDay) {
      for (const t of dailyGoals) {
        goalsTotal += 1;
        if (meets(values.get(t.id) ?? 0, t.goal as NonNullable<Goal>)) goalsMet += 1;
      }
    }

    return {
      totals,
      daysLogged: days.size,
      minutes,
      goals: goalsTotal > 0 ? goalsMet / goalsTotal : null,
    };
  }

  const now = gather(nowRows);
  const before = gather(beforeRows);
  const empty: MonthTotals = { total: 0, logged: 0, done: 0 };

  const body: MonthCompare = {
    month,
    previous: window.before.start.slice(0, 7),
    days: window.days,
    partial: window.partial,
    headline: {
      daysLogged: { now: now.daysLogged, before: before.daysLogged },
      minutes: { now: now.minutes, before: before.minutes },
      goals: { now: now.goals, before: before.goals },
    },
    trackers: compareMonths(
      active.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        unit: t.unit,
        type: t.type as TrackerType,
        habit: t.habit,
        now: now.totals.get(t.id) ?? empty,
        before: before.totals.get(t.id) ?? empty,
      })),
      window.days,
      prevDays
    ),
  };

  return NextResponse.json(body);
}
