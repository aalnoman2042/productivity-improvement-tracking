import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { MAX_TASKS_PER_DAY, carryRange } from "@/lib/tasks";

/**
 * Bring what was left undone onto the day you are looking at.
 *
 * A task written for Tuesday and not done is not automatically Wednesday's
 * problem — deciding that is the point of this being a button rather than a
 * rule that runs at midnight. An app that quietly rolls work forward builds
 * a list nobody chose, and the honest version of "I didn't do it" is that it
 * stayed on Tuesday.
 *
 * Only days that are **over** can have leftovers: today is still being
 * lived, so its unfinished tasks are simply not done yet. POST, like every
 * other write here, so it survives the offline queue.
 *
 * Body: `{ date, today }` — the day to move them to, and the caller's own
 * idea of today, since which days are over is a fact about their clock.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const date = body?.date;
  const today = body?.today;
  if (!isValidDateStr(date) || !isValidDateStr(today)) {
    return NextResponse.json(
      { error: "date and today (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  // Moving leftovers *backwards* onto a day that has already been lived
  // would be rewriting it. The offer only exists forwards.
  if (date < today) {
    return NextResponse.json(
      { error: "That day is over — leftovers can only move forward" },
      { status: 400 }
    );
  }

  const { from, before } = carryRange(today);
  const d = await db();

  const [waiting, already] = await Promise.all([
    d
      .collection("tasks")
      .find(
        { userId, done: false, date: { $gte: from, $lt: before } },
        { projection: { _id: 1 } }
      )
      .sort({ date: 1, order: 1 })
      .toArray(),
    d.collection("tasks").countDocuments({ userId, date }),
  ]);

  if (waiting.length === 0) {
    return NextResponse.json({ ok: true, moved: 0, left: 0 });
  }

  // The day's cap still holds: a fortnight of leftovers must not turn one
  // day into a backlog with a date on it. The oldest go first — they are the
  // ones that have been waiting longest.
  const room = Math.max(0, MAX_TASKS_PER_DAY - already);
  const moving = waiting.slice(0, room);

  if (moving.length > 0) {
    await d.collection("tasks").updateMany(
      { _id: { $in: moving.map((t) => t._id) }, userId },
      // Moved, not copied: a task exists once, on the day it is still owed.
      // Order puts them after whatever is already on the day.
      [{ $set: { date, order: { $add: ["$order", MAX_TASKS_PER_DAY] } } }]
    );
  }

  return NextResponse.json({
    ok: true,
    moved: moving.length,
    left: waiting.length - moving.length,
  });
}
