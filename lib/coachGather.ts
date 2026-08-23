import type { Db, ObjectId } from "mongodb";
import { buildReportCard, type ReportCard } from "./report";
import { toTracker } from "./trackerDoc";
import type { Tracker } from "./trackers";
import {
  buildCoachFacts,
  type CoachChallengeRow,
  type CoachEntry,
  type CoachFacts,
} from "./coachFacts";
import type { CoachSnapshot } from "./coach";

/**
 * Everything the AI is allowed to know, fetched and computed in one place.
 *
 * Three callers need exactly this now — the daily read, the question box and
 * the weekly review — and the *reason* it is one function rather than three
 * queries is the privacy promise, not the duplication: what leaves this
 * server is decided here, once. Numbers and tracker names. Never a note,
 * never an email, never a word anyone wrote.
 */

export type Gathered = {
  facts: CoachFacts;
  snapshot: CoachSnapshot;
  report: ReportCard;
  trackers: Tracker[];
};

/**
 * Null when there is nothing on record — which is a real answer and not a
 * failure: an AI asked to read an empty life will invent one.
 */
export async function gatherCoachFacts(
  d: Db,
  userId: ObjectId,
  today: string
): Promise<Gathered | null> {
  // `meta` comes along for the ride: bedtimes are the one thing the coach was
  // most often asked about and had no way of knowing.
  const [trackerDocs, entryDocs, challengeDocs] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, meta: 1, _id: 0 } }
      )
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker) as Tracker[];
  const entries: CoachEntry[] = entryDocs.map((e) => ({
    trackerId: String(e.trackerId),
    date: String(e.date),
    value: Number(e.value),
    meta: (e.meta as CoachEntry["meta"]) ?? null,
  }));
  if (entries.length === 0) return null;

  const challenges: CoachChallengeRow[] = challengeDocs.map((c) => ({
    name: String(c.name),
    trackerId: String(c.trackerId),
    startDate: String(c.startDate),
    days: Number(c.days),
    target: c.target == null ? null : Number(c.target),
    direction: c.direction === "max" ? "max" : "min",
  }));

  const report = buildReportCard(trackers, entries, [], today);
  const { facts, snapshot } = buildCoachFacts(
    trackers,
    entries,
    challenges,
    report,
    today
  );

  return { facts, snapshot, report, trackers };
}
