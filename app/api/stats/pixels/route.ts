import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { addDays, isValidDateStr } from "@/lib/dates";
import { pixelYear } from "@/lib/pixels";

/**
 * A year of days, as values — what the pixel grid on /history paints.
 *
 * `?tracker=<id>` draws that tracker's own values; without one, the square
 * counts **how many trackers were logged that day**, which is the honest
 * all-round answer to "did I show up?" and the only one that doesn't compare
 * hours of sleep with glasses of water.
 *
 * `?to=` ends the window (the reader's today); it reaches back a year.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const to = params.get("to");
  if (!isValidDateStr(to)) {
    return NextResponse.json({ error: "to=YYYY-MM-DD required" }, { status: 400 });
  }
  const trackerId = params.get("tracker");
  if (trackerId && !ObjectId.isValid(trackerId)) {
    return NextResponse.json({ error: "Unknown tracker" }, { status: 400 });
  }

  // 52 weeks back, from the Monday of the week a year ago — the grid does
  // the aligning; this just has to reach far enough.
  const from = addDays(to, -370);

  const d = await db();
  const [rows, restRows, tracker] = await Promise.all([
    d
      .collection("entries")
      .find(
        {
          userId,
          date: { $gte: from, $lte: to },
          ...(trackerId ? { trackerId: new ObjectId(trackerId) } : {}),
        },
        { projection: { date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    d
      .collection("restDays")
      .find(
        { userId, date: { $gte: from, $lte: to } },
        { projection: { date: 1, _id: 0 } }
      )
      .toArray(),
    trackerId
      ? d
          .collection("trackers")
          .findOne(
            { _id: new ObjectId(trackerId), userId },
            { projection: { name: 1, type: 1, unit: 1, color: 1 } }
          )
      : Promise.resolve(null),
  ]);

  if (trackerId && !tracker) {
    return NextResponse.json({ error: "Unknown tracker" }, { status: 404 });
  }

  const values: Record<string, number> = {};
  for (const r of rows) {
    const date = String(r.date);
    // One tracker: its value. No tracker: one for each tracker logged that
    // day — a count of showing up, not a sum of unrelated units.
    values[date] = (values[date] ?? 0) + (trackerId ? Number(r.value) : 1);
  }

  const rest = new Set(restRows.map((r) => String(r.date)));

  return NextResponse.json({
    tracker: tracker
      ? {
          id: String(tracker._id),
          name: String(tracker.name),
          type: String(tracker.type),
          unit: String(tracker.unit),
          color: String(tracker.color),
        }
      : null,
    year: pixelYear(from, to, values, rest),
  });
}
