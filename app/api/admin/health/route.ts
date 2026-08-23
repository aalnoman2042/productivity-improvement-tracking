import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAdminId } from "@/lib/admin";
import { REMINDER_JOB, TRACKER_REMINDER_JOB, cronHealth } from "@/lib/cronLog";

/**
 * Is the app actually working?
 *
 * Two questions the counts elsewhere on the admin page cannot answer.
 *
 * **Is the schedule alive?** Every reminder this app sends depends on
 * something outside it calling `/api/cron/*` every quarter hour. When that
 * something is missing the failure is *silence* — no error, no exception,
 * just reminders that never arrive — which is the hardest kind of broken to
 * notice. `cronRuns` has recorded every run all along; this puts it where
 * somebody looks.
 *
 * **Is the database enforcing what the code thinks?** A validator that
 * silently matches nothing rejects every write to its collection, and the
 * only symptom is a save that fails. `npm run check:db` answers this from a
 * terminal; there is no reason it should need one.
 *
 * Counts, timestamps and schema shapes. No document is read.
 */

export const dynamic = "force-dynamic";

/** Every collection the code expects, and the date field worth checking. */
const EXPECTED: Record<string, string | null> = {
  users: null,
  trackers: null,
  entries: "date",
  dayNotes: "date",
  tasks: "date",
  books: null,
  challenges: "startDate",
  aiReviews: null,
  weeklyReviews: "weekStart",
  pushSubs: null,
  rateLimits: null,
  cronRuns: null,
};

/** What a date must match. A pattern that lost its backslashes matches nothing. */
const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export type CollectionHealth = {
  name: string;
  exists: boolean;
  hasValidator: boolean;
  /** Null when this collection has no date field worth checking. */
  datePatternOk: boolean | null;
  indexes: number;
  rows: number;
};

export async function GET() {
  const adminId = await currentAdminId();
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = await db();

  /* ------------------------- is the schedule alive? --------------------- */
  const [daily, perTracker, lastRuns, devices, dailyOn, timedTrackers] =
    await Promise.all([
      cronHealth(REMINDER_JOB),
      cronHealth(TRACKER_REMINDER_JOB),
      d
        .collection("cronRuns")
        .find({}, { projection: { _id: 0 } })
        .sort({ startedAt: -1 })
        .limit(8)
        .toArray(),
      d.collection("pushSubs").countDocuments({}),
      d.collection("users").countDocuments({ "reminder.enabled": true }),
      d
        .collection("trackers")
        .countDocuments({ archived: false, reminder: { $ne: null } }),
    ]);

  /* ------------------ is the database enforcing the code? --------------- */
  const present = await d.listCollections({}, { nameOnly: false }).toArray();
  const byName = new Map(present.map((c) => [c.name, c]));

  const collections: CollectionHealth[] = [];
  for (const [name, dateField] of Object.entries(EXPECTED)) {
    const info = byName.get(name);
    if (!info) {
      // Not a fault: collections self-create on first write, so one nobody
      // has used yet is simply absent.
      collections.push({
        name,
        exists: false,
        hasValidator: false,
        datePatternOk: null,
        indexes: 0,
        rows: 0,
      });
      continue;
    }

    const schema = (
      info.options?.validator as { $jsonSchema?: Record<string, never> } | undefined
    )?.$jsonSchema as
      | { properties?: Record<string, { pattern?: string }> }
      | undefined;

    let indexes = 0;
    let rows = 0;
    try {
      indexes = (await d.collection(name).indexes()).length;
      rows = await d.collection(name).estimatedDocumentCount();
    } catch {
      // A collection the cluster won't describe still counts as present.
    }

    collections.push({
      name,
      exists: true,
      hasValidator: Boolean(schema),
      datePatternOk: dateField
        ? schema?.properties?.[dateField]?.pattern === DATE_PATTERN
        : null,
      indexes,
      rows,
    });
  }

  return NextResponse.json({
    schedule: {
      daily,
      perTracker,
      // What could receive a reminder even if the schedule is perfect.
      devices,
      accountsWithDailyOn: dailyOn,
      trackersWithTimes: timedTrackers,
      recent: lastRuns.map((r) => ({
        job: String(r.job),
        startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : null,
        ok: Boolean(r.ok),
        tookMs: r.tookMs == null ? null : Number(r.tookMs),
        checked: r.checked == null ? null : Number(r.checked),
        notified: r.notified == null ? null : Number(r.notified),
        skipped: r.skipped == null ? null : Number(r.skipped),
        lapses: r.lapses == null ? null : Number(r.lapses),
        digests: r.digests == null ? null : Number(r.digests),
        error: r.error ? String(r.error) : null,
      })),
    },
    schema: { collections },
  });
}
