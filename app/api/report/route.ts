import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import {
  buildReportCard,
  type ReportChallenge,
  type ReportEntry,
} from "@/lib/report";

/**
 * The report card: the whole account graded over all time, in one read.
 *
 * `?today=YYYY-MM-DD` comes from the client because "today" is a fact about
 * the person's clock, not the server's. All the judgement lives in
 * `lib/report.ts`; this route only fetches the rows and hands them over.
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
    // Every entry ever, but only the three fields the grading reads.
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
    // Days taken off on purpose. They add nothing to any count — they only
    // stop a run reading a planned Sunday as the week it fell apart.
    d
      .collection("restDays")
      .find({ userId, date: { $lte: today } }, { projection: { date: 1, _id: 0 } })
      .toArray(),
  ]);

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

  return NextResponse.json(
    buildReportCard(
      trackerDocs.map(toTracker),
      entries,
      challenges,
      today,
      restDocs.map((r) => String(r.date))
    )
  );
}
