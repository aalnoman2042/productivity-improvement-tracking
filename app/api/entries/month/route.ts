import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import {
  addDays,
  addMonths,
  isValidDateStr,
  isValidMonthStr,
  monthRange,
} from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import type { Goal } from "@/lib/trackers";
import type { MonthDay, MonthSummary, YearAgo } from "@/lib/history";

/**
 * One month of history, a day at a time — what the calendar on `/history`
 * paints from.
 *
 * Two numbers per day, because they answer different questions and one can't
 * stand in for the other: `logged` says whether you filled the day in at all,
 * `goalsMet` says whether it went well. A blank day and a bad day look the
 * same if you only keep the second.
 */

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
  // Optional, and only used to decide how much of last year to compare
  // against — the calendar itself does not need to know what today is.
  const today = params.get("today");

  const { start, end } = monthRange(month);
  const d = await db();

  // Twelve months back, over the SAME span. A month still being lived is
  // matched to the same many days of last year's, never to the whole of it:
  // two days of September against thirty is not a comparison. See
  // `yearAgoLine` in lib/history and the same rule in lib/periodCompare.
  const agoMonth = addMonths(month, -12);
  const agoRange = monthRange(agoMonth);
  const running = isValidDateStr(today) && today >= start && today <= end;
  const agoEnd = running
    ? // Clamp to that month's own length — 31 August has no 31 February.
      [`${agoMonth}-${today.slice(8, 10)}`, agoRange.end].sort()[0]
    : agoRange.end;

  const [trackerDocs, rows, noteRows, taskRows, restRows, agoRows] = await Promise.all([
    d.collection("trackers").find({ userId }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: start, $lte: end } },
        { projection: { trackerId: 1, date: 1, value: 1, note: 1, _id: 0 } }
      )
      .toArray(),
    // The day's own note lives in its own collection, so it survives a day
    // with nothing logged — which is often exactly the day worth explaining.
    d
      .collection("dayNotes")
      .find(
        { userId, date: { $gte: start, $lte: end } },
        { projection: { date: 1, text: 1, _id: 0 } }
      )
      .toArray(),
    // The to-do list is not part of what the numbers are drawn from, but it
    // is part of what a day held — so the calendar can mark it.
    d
      .collection("tasks")
      .find(
        { userId, date: { $gte: start, $lte: end } },
        { projection: { date: 1, done: 1, _id: 0 } }
      )
      .toArray(),
    // Days deliberately taken off. Nothing about them is a number; the
    // square says so and the month's run steps over them.
    d
      .collection("restDays")
      .find(
        { userId, date: { $gte: start, $lte: end } },
        { projection: { date: 1, _id: 0 } }
      )
      .toArray(),
    // The same month a year ago, for the one line under the calendar. An
    // indexed range read of three fields — the cheapest thing on this route.
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: agoRange.start, $lte: agoEnd } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
  ]);
  const rested = new Set(restRows.map((r) => String(r.date)));
  const dayNotes = new Map(
    noteRows.map((n) => [String(n.date), String(n.text ?? "")])
  );
  const taskCounts = new Map<string, { total: number; done: number }>();
  for (const row of taskRows) {
    const key = String(row.date);
    const slot = taskCounts.get(key) ?? { total: 0, done: 0 };
    slot.total += 1;
    if (row.done) slot.done += 1;
    taskCounts.set(key, slot);
  }

  const trackers = trackerDocs.map(toTracker);
  const active = trackers.filter((t) => !t.archived);
  const byId = new Map(active.map((t) => [t.id, t]));
  // Only daily goals; a weekly one can't be judged from a single square.
  const dailyGoals = active.filter((t) => t.goal?.period === "day");

  type DaySlot = {
    logged: Set<string>;
    minutes: number;
    values: Map<string, number>;
    notes: { tracker: string; note: string }[];
  };
  const perDay = new Map<string, DaySlot>();
  for (const r of rows) {
    const id = String(r.trackerId);
    const tracker = byId.get(id);
    // Entries for an archived tracker stay in the database but shouldn't
    // count against a day's completeness — you can't fill in what isn't shown.
    if (!tracker) continue;
    const date = String(r.date);
    const value = Number(r.value);
    const slot: DaySlot =
      perDay.get(date) ??
      { logged: new Set(), minutes: 0, values: new Map(), notes: [] };
    slot.logged.add(id);
    slot.values.set(id, value);
    if (tracker.type === "duration") slot.minutes += value;
    // Notes ride along so the calendar can mark the days that have one and
    // list them below — written words shouldn't be write-only.
    if (typeof r.note === "string" && r.note) {
      slot.notes.push({ tracker: tracker.name, note: r.note });
    }
    perDay.set(date, slot);
  }

  const days: MonthDay[] = [];
  let bestRun = 0;
  let run = 0;

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const slot = perDay.get(date);
    const logged = slot?.logged.size ?? 0;

    // A goal counts as missed on a day you logged *something* — a day with
    // nothing at all is a gap, not a failure, and is drawn as one.
    const goalsMet =
      logged > 0
        ? dailyGoals.filter((t) =>
            meets(slot?.values.get(t.id) ?? 0, t.goal as NonNullable<Goal>)
          ).length
        : 0;

    days.push({
      date,
      logged,
      goalsMet,
      goalsTotal: logged > 0 ? dailyGoals.length : 0,
      minutes: slot?.minutes ?? 0,
      notes: slot?.notes ?? [],
      dayNote: dayNotes.get(date) ?? null,
      tasks: taskCounts.get(date) ?? { total: 0, done: 0 },
      rest: rested.has(date),
    });

    // A planned rest neither extends the run nor ends it — same rule as
    // `lib/rest`, which is what every other run in the app is measured by.
    if (logged > 0) run += 1;
    else if (!rested.has(date)) run = 0;
    if (run > bestRun) bestRun = run;
  }

  // Nothing there at all means the account did not exist yet — and "0 days a
  // year ago" every month for a year is noise, not a comparison.
  let lastYear: YearAgo | null = null;
  if (agoRows.length > 0) {
    const agoDays = new Set<string>();
    let agoMinutes = 0;
    for (const r of agoRows) {
      const tracker = byId.get(String(r.trackerId));
      // Archived trackers are left out here for the same reason they are left
      // out of the month above: you cannot fill in what is not on screen.
      if (!tracker) continue;
      agoDays.add(String(r.date));
      if (tracker.type === "duration") agoMinutes += Number(r.value);
    }
    if (agoDays.size > 0) {
      lastYear = {
        month: agoMonth,
        daysLogged: agoDays.size,
        minutes: agoMinutes,
        through: agoEnd,
        partial: agoEnd < agoRange.end,
      };
    }
  }

  const summary: MonthSummary = {
    month,
    start,
    end,
    trackers: active.length,
    days,
    daysLogged: days.filter((d) => d.logged > 0).length,
    bestRun,
    lastYear,
  };
  return NextResponse.json(summary);
}
