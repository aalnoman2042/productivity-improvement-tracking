import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { catchupBack, catchupWindow, type CatchupDay } from "@/lib/catchup";

/**
 * Which of the recent days are blank.
 *
 * Two counts per day and nothing else — how many trackers hold something,
 * and whether the day was deliberately taken off. The values themselves stay
 * where they are: this endpoint answers "what is missing", and the screen
 * that asks it opens the days one at a time to fill them.
 *
 * `?today=` because today belongs to the reader's clock, and the window
 * *ends yesterday*: a day still being lived is not a day that was missed.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const today = params.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const back = catchupBack(params.get("back"));

  const window = catchupWindow(today, back);
  const from = window[0];
  const to = window[window.length - 1];

  const d = await db();
  const [rows, restRows, activeTrackers] = await Promise.all([
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: from, $lte: to } },
        { projection: { date: 1, trackerId: 1, _id: 0 } }
      )
      .toArray(),
    d
      .collection("restDays")
      .find(
        { userId, date: { $gte: from, $lte: to } },
        { projection: { date: 1, _id: 0 } }
      )
      .toArray(),
    // A day cannot be "missed" by an account with nothing to log; the screen
    // uses this to send someone to the trackers page instead.
    d.collection("trackers").countDocuments({ userId, archived: false }),
  ]);

  const perDay = new Map<string, number>();
  for (const r of rows) {
    const date = String(r.date);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }
  const rested = new Set(restRows.map((r) => String(r.date)));

  const days: CatchupDay[] = window.map((date) => ({
    date,
    logged: perDay.get(date) ?? 0,
    rest: rested.has(date),
  }));

  return NextResponse.json({ today, back, days, trackers: activeTrackers });
}
