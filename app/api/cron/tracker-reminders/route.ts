import { NextResponse } from "next/server";
import { type Db, type ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { checkReminders } from "@/lib/trackerReminders";
import { TRACKER_REMINDER_JOB, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/**
 * Per-tracker reminders: "gym at 18:00", or namaz at all five waqts —
 * each time-slot fires once, and only while the day still needs it.
 *
 * Vercel's Hobby plan fires a cron once a day, which is right for the 11 PM
 * ask and useless for times chosen per tracker — so this route is built to be
 * *polled* by an external scheduler (cron-job.org, every 10–15 minutes; see
 * DEPLOY.md). All the arithmetic lives in lib/trackerReminders: a slot is
 * due for a 3-hour window after its time, sends at most once per local day,
 * and a window that passed while the scheduler was down is stamped as missed
 * rather than delivered at midnight.
 */
export async function GET(req: Request) {
  const startedAt = new Date();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await recordRun(TRACKER_REMINDER_JOB, startedAt, {
      ok: false,
      error: "CRON_SECRET is not set",
    });
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }

  // Same door policy as the nightly job: header or ?key=, and a wrong secret
  // is not logged so strangers can't bury a real outage in noise.
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!pushConfigured()) {
    await recordRun(TRACKER_REMINDER_JOB, startedAt, {
      ok: false,
      error: "Push is not configured (VAPID keys missing)",
    });
    return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
  }

  try {
    const result = await runTrackerReminders();
    // A poll that found nothing to do isn't worth a log row — at 15-minute
    // intervals that would be ~96 rows a day drowning out the ones that
    // matter, and the TTL'd collection is also the nightly job's history.
    if (result.notified > 0 || result.missed > 0) {
      await recordRun(TRACKER_REMINDER_JOB, startedAt, { ok: true, ...counts(result) });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await recordRun(TRACKER_REMINDER_JOB, startedAt, { ok: false, error: message });
    console.error("Tracker reminder run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type RunResult = {
  checked: number;
  notified: number;
  /** Slots due but already satisfied by a log, or undeliverable — quiet. */
  skipped: number;
  /** Slots whose window passed unserved — stamped quiet. */
  missed: number;
};

/** Map this run's shape onto the shared cronRuns columns. */
function counts(r: RunResult) {
  return { checked: r.checked, notified: r.notified, skipped: r.skipped + r.missed };
}

/**
 * Whether today's log already satisfies this tracker, making a reminder
 * noise. For most trackers any entry does it. A prayer tracker is the
 * exception this feature was asked for: Fajr logged at dawn must not
 * silence the Maghrib reminder — only all five parts close the day.
 */
async function alreadySatisfied(
  d: Db,
  userId: ObjectId,
  trackerId: ObjectId,
  type: string,
  date: string
): Promise<boolean> {
  const entry = await d
    .collection("entries")
    .findOne(
      { userId, trackerId, date },
      { projection: { value: 1, "meta.parts": 1 } }
    );
  if (!entry) return false;
  if (type !== "prayer") return true;
  const parts = Array.isArray(entry.meta?.parts) ? entry.meta.parts.length : 0;
  return Math.max(parts, Number(entry.value) || 0) >= 5;
}

async function runTrackerReminders(): Promise<RunResult> {
  const now = new Date();
  const d = await db();

  const trackers = await d
    .collection("trackers")
    .find(
      { reminder: { $ne: null }, archived: false },
      { projection: { userId: 1, name: 1, type: 1, reminder: 1 } }
    )
    .toArray();

  const result: RunResult = { checked: trackers.length, notified: 0, skipped: 0, missed: 0 };
  if (trackers.length === 0) return result;

  // One read for every owner's clock rather than one per tracker.
  const userIds = [...new Set(trackers.map((t) => String(t.userId)))].map(
    (id) => trackers.find((t) => String(t.userId) === id)!.userId
  );
  const users = await d
    .collection("users")
    .find({ _id: { $in: userIds } }, { projection: { "reminder.tzOffset": 1 } })
    .toArray();
  const tzBy = new Map(
    users.map((u) => [String(u._id), Number(u.reminder?.tzOffset ?? NaN)])
  );

  for (const t of trackers) {
    const tzOffset = tzBy.get(String(t.userId));
    // No known clock, no reminder — better silent than at a stranger's 3 AM.
    if (tzOffset === undefined || !Number.isFinite(tzOffset)) {
      result.skipped++;
      continue;
    }

    const check = checkReminders(
      {
        times: Array.isArray(t.reminder.times) ? t.reminder.times.map(String) : [],
        lastSentFor: t.reminder.lastSentFor ?? null,
      },
      now,
      tzOffset
    );
    result.missed += check.missed.length;

    if (!check.due) {
      // Nothing to send, but windows that expired unserved still need their
      // stamp, or every later poll re-discovers and re-counts them.
      if (check.stamp) await stamp(d, t._id, check.stamp);
      continue;
    }

    const name = String(t.name);

    // The whole point of a slot is a day not yet satisfied — for prayers
    // that means all five, so each waqt gets its own ask until then.
    if (await alreadySatisfied(d, t.userId, t._id, String(t.type), check.date)) {
      await stamp(d, t._id, check.stamp!);
      result.skipped++;
      continue;
    }

    const { sent } = await sendToUser(t.userId, {
      title: `⏰ ${name}`,
      body: `You asked for a nudge at ${check.due} — log ${name} when it's done.`,
      url: "/",
      // One live notification per tracker per day; the next slot replaces it.
      tag: `pit-tracker-${t._id}-${check.date}`,
    });
    if (sent > 0) {
      await stamp(d, t._id, check.stamp!);
      result.notified++;
    } else {
      // Reminders set but no browser subscribed — leave the slot unstamped so
      // a device that subscribes within the window still gets it.
      result.skipped++;
    }
  }

  return result;
}

function stamp(d: Db, trackerId: ObjectId, key: string) {
  return d
    .collection("trackers")
    .updateOne({ _id: trackerId }, { $set: { "reminder.lastSentFor": key } });
}
