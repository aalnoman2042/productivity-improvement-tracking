import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";

/**
 * Add minutes to a day's total — used when the stopwatch stops, so several
 * sessions in one day accumulate instead of overwriting each other.
 * Body: { trackerId, date, minutes }
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { trackerId, date } = body ?? {};
  const minutes = Number(body?.minutes);

  if (typeof trackerId !== "string" || !ObjectId.isValid(trackerId)) {
    return NextResponse.json({ error: "Bad trackerId" }, { status: 400 });
  }
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "Bad date" }, { status: 400 });
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    return NextResponse.json(
      { error: "minutes must be between 1 and 1440" },
      { status: 400 }
    );
  }

  const d = await db();
  const now = new Date();
  const res = await d.collection("entries").findOneAndUpdate(
    { userId, trackerId: new ObjectId(trackerId), date },
    {
      $inc: { value: Math.round(minutes) },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now, meta: null, note: null },
    },
    { upsert: true, returnDocument: "after" }
  );

  return NextResponse.json({ ok: true, value: Number(res?.value ?? 0) });
}
