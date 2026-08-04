import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker } from "@/lib/trackerDoc";
import type { Tracker } from "@/lib/trackers";
import { toNight } from "@/lib/clock";
import { addDays, isValidDateStr } from "@/lib/dates";
import {
  MIN_DAYS,
  enoughData,
  findCorrelations,
  type Series,
} from "@/lib/correlate";

/**
 * What goes with what, over the last stretch of days.
 *
 * Computed on the server because the alternative is shipping ninety days of
 * every tracker to the browser to do arithmetic on. The window is wide on
 * purpose: a fortnight is not enough days to say anything about a weekday
 * pattern, and the whole feature is worth nothing if it speaks too early.
 */

const DEFAULT_WINDOW = 90;
const MAX_WINDOW = 365;

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const today = params.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const days = Math.min(
    MAX_WINDOW,
    Math.max(MIN_DAYS, Number(params.get("days")) || DEFAULT_WINDOW)
  );
  const start = addDays(today, -(days - 1));

  const d = await db();
  const [trackerDocs, rows] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: start, $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, meta: 1 } }
      )
      .toArray(),
  ]);

  // `toTracker` types `type` and `category` as plain strings — the database
  // validator is what actually keeps them to the known set — so this narrows
  // them the same way every other reader of it does.
  const trackers = trackerDocs
    .map(toTracker)
    .filter((t) => !t.archived) as Tracker[];
  const byId = new Map(trackers.map((t) => [t.id, t]));

  const series = new Map<string, Series>(
    trackers.map((t) => [t.id, { tracker: t, byDate: new Map<string, number>() }])
  );
  // Bedtime lives in meta, not in the value, so it's collected alongside.
  const bedByDate = new Map<string, number>();

  for (const r of rows) {
    const id = String(r.trackerId);
    const t = byId.get(id);
    if (!t) continue; // archived, or deleted out from under an old entry
    const date = String(r.date);
    series.get(id)?.byDate.set(date, Number(r.value));

    if (t.type === "sleep") {
      const bed = toNight((r.meta as { start?: unknown } | null)?.start);
      if (bed !== null) bedByDate.set(date, bed);
    }
  }

  const all = [...series.values()];

  if (!enoughData(all)) {
    return NextResponse.json({
      findings: [],
      ready: false,
      days,
      minDays: MIN_DAYS,
      // What's missing, so the empty state can say something useful rather
      // than just being empty.
      qualifying: all.filter((s) => s.byDate.size >= MIN_DAYS).length,
    });
  }

  return NextResponse.json({
    findings: findCorrelations({ series: all, bedByDate }),
    ready: true,
    days,
    minDays: MIN_DAYS,
    qualifying: all.filter((s) => s.byDate.size >= MIN_DAYS).length,
  });
}
