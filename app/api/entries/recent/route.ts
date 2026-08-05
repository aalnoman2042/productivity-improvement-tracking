import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { addDays, isValidDateStr } from "@/lib/dates";

/**
 * The week leading up to a day, for pre-filling that day's log.
 *
 * `?before=YYYY-MM-DD` returns the entries from the seven days strictly
 * before it — enough to say "you usually sleep 11:30 to 7:00" and "study was
 * 2h yesterday" without shipping notes, quality scores or prayer lists.
 * The client turns these rows into suggestions; the server just hands over
 * the slice.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const before = new URL(req.url).searchParams.get("before");
  if (!isValidDateStr(before)) {
    return NextResponse.json({ error: "before=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const rows = await d
    .collection("entries")
    .find(
      { userId, date: { $gte: addDays(before, -7), $lte: addDays(before, -1) } },
      {
        projection: {
          trackerId: 1,
          date: 1,
          value: 1,
          "meta.start": 1,
          "meta.end": 1,
          _id: 0,
        },
      }
    )
    .toArray();

  return NextResponse.json(
    rows.map((r) => ({
      trackerId: String(r.trackerId),
      date: String(r.date),
      value: Number(r.value),
      meta: r.meta ?? null,
    }))
  );
}
