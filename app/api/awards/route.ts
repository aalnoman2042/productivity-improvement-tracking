import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { buildAwards } from "@/lib/awards";
import {
  buildReportCard,
  type ReportChallenge,
  type ReportEntry,
} from "@/lib/report";

/**
 * Everything that has gone right, in one read.
 *
 * The same four collections the report card reads, because the awards are
 * the same facts with the judgement taken out — and reading them twice on
 * two pages is cheaper than making the report card carry a payload that
 * only one screen ever opens.
 *
 * `?today=YYYY-MM-DD` for the same reason it is on `/api/report`: today is a
 * fact about the reader's clock, not the server's.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new URL(req.url).searchParams.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }

  const d = await db();
  const [trackerDocs, entryDocs, challengeDocs, restDocs] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
    d
      .collection("restDays")
      .find({ userId, date: { $lte: today } }, { projection: { date: 1, _id: 0 } })
      .toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker);
  const entries: ReportEntry[] = entryDocs.map((e) => ({
    trackerId: String(e.trackerId),
    date: String(e.date),
    value: Number(e.value),
  }));
  const challenges: ReportChallenge[] = challengeDocs.map((c) => ({
    trackerId: String(c.trackerId),
    startDate: String(c.startDate),
    days: Number(c.days),
    target: c.target == null ? null : Number(c.target),
    direction: c.direction === "max" ? "max" : "min",
  }));

  const report = buildReportCard(
    trackers,
    entries,
    challenges,
    today,
    restDocs.map((r) => String(r.date))
  );

  return NextResponse.json(buildAwards({ trackers, entries, report }));
}
