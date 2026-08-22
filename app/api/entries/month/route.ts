import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { addDays, isValidMonthStr, monthRange } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import type { Goal } from "@/lib/trackers";
import type { MonthDay, MonthSummary } from "@/lib/history";

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

  const month = new URL(req.url).searchParams.get("month");
  if (!isValidMonthStr(month)) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }

  const { start, end } = monthRange(month);
  const d = await db();

  const [trackerDocs, rows, noteRows] = await Promise.all([
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
  ]);
  const dayNotes = new Map(
    noteRows.map((n) => [String(n.date), String(n.text ?? "")])
  );

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
    });

    run = logged > 0 ? run + 1 : 0;
    if (run > bestRun) bestRun = run;
  }

  const summary: MonthSummary = {
    month,
    start,
    end,
    trackers: active.length,
    days,
    daysLogged: days.filter((d) => d.logged > 0).length,
    bestRun,
  };
  return NextResponse.json(summary);
}
