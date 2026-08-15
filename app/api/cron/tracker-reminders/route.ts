import { NextResponse } from "next/server";
import { type Db, type ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { checkReminder } from "@/lib/trackerReminders";
import { TRACKER_REMINDER_JOB, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/**
 * Per-tracker reminders: "gym at 18:00", every day, until it's logged.
 *
 * Vercel's Hobby plan fires a cron once a day, which is right for the 11 PM
 * ask and useless for times chosen per tracker — so this route is built to be
 * *polled* by an external scheduler (cron-job.org, every 10–15 minutes; see
 * DEPLOY.md). All the arithmetic lives in lib/trackerReminders: a reminder is
 * due for a 3-hour window after its time, sends at most once per local day,
 * skips a tracker already logged today, and a window that passed while the
 * scheduler was down is stamped as missed rather than delivered at midnight.
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
  /** Due, but already logged today or the window was missed — stamped quiet. */
  skipped: number;
  missed: number;
};

/** Map this run's shape onto the shared cronRuns columns. */
function counts(r: RunResult) {
  return { checked: r.checked, notified: r.notified, skipped: r.skipped + r.missed };
}

async function runTrackerReminders(): Promise<RunResult> {
  const now = new Date();
  const d = await db();

  const trackers = await d
    .collection("trackers")
    .find(
      { reminder: { $ne: null }, archived: false },
      { projection: { userId: 1, name: 1, reminder: 1 } }
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

    const check = checkReminder(
      { time: String(t.reminder.time), lastSentFor: t.reminder.lastSentFor ?? null },
      now,
      tzOffset
    );

    if (check.missed) {
      // The window passed unserved — stamp the day so the next poll doesn't
      // deliver a 6 PM reminder at midnight.
      await stamp(d, t._id, check.date);
      result.missed++;
      continue;
    }
    if (!check.due) continue;

    // The whole point of the reminder is a day not yet logged — one that is
    // gets stamped quiet, slips included; a slip is still a day handled.
    const logged = await d
      .collection("entries")
      .findOne(
        { userId: t.userId, trackerId: t._id, date: check.date },
        { projection: { _id: 1 } }
      );
    if (logged) {
      await stamp(d, t._id, check.date);
      result.skipped++;
      continue;
    }

    const name = String(t.name);
    const { sent } = await sendToUser(t.userId, {
      title: `⏰ ${name}`,
      body: `You asked to be reminded at ${t.reminder.time} — log ${name} when it's done.`,
      url: "/",
      // One live notification per tracker per day; a re-send replaces it.
      tag: `pit-tracker-${t._id}-${check.date}`,
    });
    if (sent > 0) {
      await stamp(d, t._id, check.date);
      result.notified++;
    } else {
      // Reminders set but no browser subscribed — leave the day unstamped so
      // a device that subscribes within the window still gets it.
      result.skipped++;
    }
  }

  return result;
}

function stamp(d: Db, trackerId: ObjectId, date: string) {
  return d
    .collection("trackers")
    .updateOne({ _id: trackerId }, { $set: { "reminder.lastSentFor": date } });
}
