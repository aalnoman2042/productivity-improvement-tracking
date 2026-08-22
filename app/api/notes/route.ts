import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { MAX_DAY_NOTE, cleanNote } from "@/lib/notes";

/**
 * The day's own note — one per day, free text.
 *
 * Separate from the per-tracker notes on `entries` because it belongs to the
 * day rather than to any one row of it: "slept badly, argued with N, wrote
 * anyway" is not a fact about the sleep tracker. Stored in its own tiny
 * collection so it can exist on a day nothing else was logged, and so it
 * cannot change what any number on the day means.
 */

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const row = await d
    .collection("dayNotes")
    .findOne({ userId, date }, { projection: { text: 1, _id: 0 } });

  return NextResponse.json({ date, text: (row?.text as string) ?? "" });
}

/**
 * Write the day's note. Body: { date, text }.
 *
 * POST rather than PUT because this goes through the offline queue with
 * every other write, and that queue speaks one verb. An empty note deletes
 * the row: "cleared it" and "never wrote one" are the same day.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const date = body?.date;
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  if (body?.text !== undefined && typeof body.text !== "string") {
    return NextResponse.json({ error: "text must be a string" }, { status: 400 });
  }

  const text = cleanNote(body?.text, MAX_DAY_NOTE);
  const d = await dbReady();

  if (text === null) {
    await d.collection("dayNotes").deleteOne({ userId, date });
    return NextResponse.json({ ok: true, text: "" });
  }

  const now = new Date();
  await d.collection("dayNotes").updateOne(
    { userId, date },
    { $set: { text, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, text });
}
