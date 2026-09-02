import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { fadingTrackers, type TrackerLife } from "@/lib/fading";

/**
 * Which trackers have gone quiet.
 *
 * A route of its own rather than two more fields on `/api/trackers`, which is
 * read by nearly every screen in the app: this needs a group-by over every
 * entry ever, and making the log page pay for it on each open to answer a
 * question only the Trackers page asks would be the wrong trade.
 *
 * The aggregation leans on the unique `(userId, trackerId, date)` index — one
 * entry per tracker per day is enforced there, so counting rows *is* counting
 * days and no `$addToSet` is needed to make it a distinct count.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new URL(req.url).searchParams.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const [trackerDocs, lifeRows, restRows] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .aggregate([
        { $match: { userId, date: { $lte: today } } },
        {
          $group: {
            _id: "$trackerId",
            last: { $max: "$date" },
            days: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    // Days taken off on purpose. A planned fortnight away must not come back
    // to an app offering to archive everything — see lib/fading.
    d
      .collection("restDays")
      .find({ userId, date: { $lte: today } }, { projection: { date: 1, _id: 0 } })
      .toArray(),
  ]);

  const lives: TrackerLife[] = lifeRows.map((r) => ({
    trackerId: String(r._id),
    last: String(r.last),
    days: Number(r.days),
  }));

  const rest = new Set(restRows.map((r) => String(r.date)));

  return NextResponse.json({
    quiet: fadingTrackers(trackerDocs.map(toTracker), lives, today, rest),
  });
}
