import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { targetProgress, type TargetProgress } from "@/lib/targets";

/**
 * Every number being walked towards, and whether it will arrive.
 *
 * The arithmetic is all in `lib/targets`; this route only decides which rows
 * feed it — and that decision is the whole subtlety. A `total` target adds
 * up the values *since it was set*, so the query is windowed; a `level`
 * target is the reading itself, so the earliest reading in the window is
 * what "how far have you come" is measured from.
 *
 * `?today=` because a deadline is counted in the reader's days, not UTC's.
 */

export type TargetRow = {
  trackerId: string;
  name: string;
  unit: string;
  color: string;
  type: string;
  progress: TargetProgress;
};

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new URL(req.url).searchParams.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const trackerDocs = await d
    .collection("trackers")
    .find({ userId, archived: false, target: { $ne: null } })
    .sort({ order: 1 })
    .toArray();

  const trackers = trackerDocs.map(toTracker).filter((t) => t.target);
  if (trackers.length === 0) return NextResponse.json({ today, targets: [] });

  // One query for every target's window rather than one each.
  const ids = trackerDocs.map((t) => t._id);
  const earliest = trackers
    .map((t) => t.target?.from ?? "0000-01-01")
    .reduce((a, b) => (a < b ? a : b));

  const rows = await d
    .collection("entries")
    .find(
      { userId, trackerId: { $in: ids }, date: { $gte: earliest, $lte: today } },
      { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
    )
    .toArray();

  const targets: TargetRow[] = trackers.map((t) => {
    const points = rows
      .filter((r) => String(r.trackerId) === t.id)
      .map((r) => ({ date: String(r.date), value: Number(r.value) }));
    return {
      trackerId: t.id,
      name: t.name,
      unit: t.unit,
      color: t.color,
      type: t.type,
      progress: targetProgress(t.target!, points, today),
    };
  });

  return NextResponse.json({ today, targets });
}
