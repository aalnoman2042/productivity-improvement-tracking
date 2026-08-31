import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { isValidDateStr, periodRange, type Period } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { parseTimeValue, timeSpend } from "@/lib/timeValue";

/**
 * What the time on record was worth.
 *
 * Two windows in one read, because the card is about scale and one window
 * cannot show scale on its own: the period the reader is looking at, and
 * **everything they have ever logged**. A month of screen time is a number;
 * the same habit priced across a whole record is the thing that lands.
 *
 * `?period=` and `?today=` — the reader's clock, as everywhere else. Returns
 * `{ value: null }` and nothing more when no price has been set, which is
 * what keeps the feature invisible until someone asks for it.
 */

const VALID: Period[] = ["week", "15d", "month", "6mo", "year"];

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const today = params.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const period = (params.get("period") ?? "month") as Period;
  if (!VALID.includes(period)) {
    return NextResponse.json({ error: "Unknown period" }, { status: 400 });
  }
  // Which month's spend — any day inside it. Defaults to the one being lived.
  const anchor = params.get("anchor");
  if (anchor !== null && !isValidDateStr(anchor)) {
    return NextResponse.json({ error: "anchor must be YYYY-MM-DD" }, { status: 400 });
  }

  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { timeValue: 1 } });
  const value = parseTimeValue(user?.timeValue);
  if (!value) return NextResponse.json({ value: null });

  const { start, end, days } = periodRange(period, anchor ?? today, today);

  const [trackerDocs, rows] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    // Everything ever logged on a time tracker. The window is filtered from
    // this in memory rather than in a second query: it is the same handful
    // of trackers, and one read of one index beats two.
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    type: t.type,
    habit: t.habit,
  }));

  const entries = rows.map((r) => ({
    trackerId: String(r.trackerId),
    date: String(r.date),
    value: Number(r.value),
  }));

  const inWindow = entries.filter((e) => e.date >= start && e.date <= end);
  const first = entries.reduce<string | null>(
    (f, e) => (f === null || e.date < f ? e.date : f),
    null
  );
  // The first logged day through today, inclusive — what "all time" means
  // for this account, and the denominator its per-day figure needs.
  const allDays = first
    ? Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000) + 1)
    : 1;

  return NextResponse.json({
    value,
    period,
    window: timeSpend({ trackers, entries: inWindow, from: start, to: end, days, value }),
    allTime: timeSpend({
      trackers,
      entries,
      from: first ?? today,
      to: today,
      days: allDays,
      value,
    }),
  });
}
