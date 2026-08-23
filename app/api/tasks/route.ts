import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { MAX_TASKS_PER_DAY, cleanTask, inOrder, nextOrder, type Task } from "@/lib/tasks";

/**
 * The day's to-do list — "have to do it today".
 *
 * POST rather than PUT or PATCH, here and in `[id]`, for the reason the day
 * note gives: every write on the daily log goes through the offline queue in
 * `lib/sync`, and **that queue speaks one verb**. A checkbox that only works
 * with a signal would be a checkbox that fails at exactly the moment someone
 * is out doing the thing it is about.
 */

/** A stored row as the client sees it. Mongo hands these back untyped. */
const toTask = (doc: Record<string, unknown>): Task => ({
  id: String(doc._id),
  text: String(doc.text),
  done: Boolean(doc.done),
  order: Number(doc.order ?? 0),
});

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const docs = await d
    .collection("tasks")
    .find({ userId, date }, { projection: { text: 1, done: 1, order: 1 } })
    .toArray();

  return NextResponse.json({ date, tasks: inOrder(docs.map(toTask)) });
}

/** Add one. Body: { date, text }. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const date = body?.date;
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  const text = cleanTask(body?.text);
  if (!text) {
    return NextResponse.json({ error: "Write the task first" }, { status: 400 });
  }

  // Creating a row is the write that can meet a validator older than the
  // code — the `tasks` collection may not exist yet — so this one waits.
  const d = await dbReady();

  const existing = await d
    .collection("tasks")
    .find({ userId, date }, { projection: { order: 1 } })
    .toArray();
  if (existing.length >= MAX_TASKS_PER_DAY) {
    return NextResponse.json(
      {
        error: `That's ${MAX_TASKS_PER_DAY} things for one day — finish some, or move the rest to another day`,
      },
      { status: 400 }
    );
  }

  const doc = {
    userId,
    date,
    text,
    done: false,
    order: nextOrder(existing.map((e) => toTask(e as never))),
    doneAt: null,
    createdAt: new Date(),
  };
  const res = await d.collection("tasks").insertOne(doc);

  return NextResponse.json(
    { id: String(res.insertedId), text, done: false, order: doc.order },
    { status: 201 }
  );
}
