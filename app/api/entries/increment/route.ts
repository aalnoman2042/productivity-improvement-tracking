import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { formatMinutes, isBeyondToday, isValidDateStr } from "@/lib/dates";
import { DAY_MINUTES } from "@/lib/draft";

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
  // A day that hasn't happened yet cannot have been lived. The daily page
  // offers tomorrow for *planning* — tasks only — and this is what makes
  // that safe: the refusal lives on the server, where no client can skip it.
  if (isBeyondToday(date)) {
    return NextResponse.json(
      { error: "That day hasn't happened yet — you can only plan it" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
    return NextResponse.json(
      { error: "minutes must be between 1 and 1440" },
      { status: 400 }
    );
  }

  const d = await db();

  // The stopwatch's minutes land in the same 24-hour budget as everything
  // else — check what the day would total before adding them.
  const tracker = await d
    .collection("trackers")
    .findOne({ _id: new ObjectId(trackerId), userId }, { projection: { _id: 1 } });
  if (!tracker) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const timeDocs = await d
    .collection("trackers")
    .find(
      { userId, type: { $in: ["duration", "sleep"] } },
      { projection: { _id: 1 } }
    )
    .toArray();
  const rows = await d
    .collection("entries")
    .find(
      { userId, date, trackerId: { $in: timeDocs.map((t) => t._id) } },
      { projection: { value: 1 } }
    )
    .toArray();
  const total =
    rows.reduce((s, r) => s + Number(r.value), 0) + Math.round(minutes);
  if (total > DAY_MINUTES) {
    return NextResponse.json(
      {
        error: `A day only has 24 hours — that would put ${date} at ${formatMinutes(total)} of logged time`,
      },
      { status: 400 }
    );
  }

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
