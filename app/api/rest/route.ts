import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr, isBeyondToday } from "@/lib/dates";
import { cleanRestReason } from "@/lib/rest";

/**
 * Days taken off on purpose.
 *
 * A rest day is a flag and nothing else: no entry is written, no number
 * moves, the day is still not a logged day. All it does is tell the runs in
 * `lib/rest` to step over it, so a Sunday you meant to take doesn't read as
 * the week you gave up.
 *
 * GET `?from=&to=` — the flags in a window, for the calendar and the
 * catch-up screen. POST `{date, rest, reason?}` — set or clear one.
 *
 * The write is a POST even to *clear* one, because `lib/sync`'s offline
 * queue speaks one verb, and marking a rest day is exactly the sort of thing
 * done on a phone with no signal.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!isValidDateStr(from) || !isValidDateStr(to)) {
    return NextResponse.json(
      { error: "from=YYYY-MM-DD&to=YYYY-MM-DD required" },
      { status: 400 }
    );
  }

  const d = await db();
  const rows = await d
    .collection("restDays")
    .find(
      { userId, date: { $gte: from, $lte: to } },
      { projection: { date: 1, reason: 1, _id: 0 } }
    )
    .sort({ date: 1 })
    .toArray();

  return NextResponse.json({
    days: rows.map((r) => ({
      date: String(r.date),
      reason: (r.reason as string | null) ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const date = body?.date;
  if (!isValidDateStr(date)) {
    return NextResponse.json({ error: "date=YYYY-MM-DD required" }, { status: 400 });
  }
  // Same guard the log itself has: a day nobody has lived cannot be rested
  // either. Tomorrow is for planning tasks, not for calling off.
  if (isBeyondToday(date)) {
    return NextResponse.json(
      { error: "That day hasn't happened yet" },
      { status: 400 }
    );
  }

  const d = await dbReady();

  if (body?.rest === false) {
    await d.collection("restDays").deleteOne({ userId, date });
    return NextResponse.json({ ok: true, date, rest: false });
  }

  const reason = cleanRestReason(body?.reason);
  await d.collection("restDays").updateOne(
    { userId, date },
    {
      $set: { reason },
      $setOnInsert: { userId, date, createdAt: new Date() },
    },
    { upsert: true }
  );
  return NextResponse.json({ ok: true, date, rest: true, reason });
}
