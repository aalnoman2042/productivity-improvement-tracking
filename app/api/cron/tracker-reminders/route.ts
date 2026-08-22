import { NextResponse } from "next/server";
import { pushConfigured } from "@/lib/push";
import { runTrackerReminders } from "@/lib/trackerReminderRun";
import { TRACKER_REMINDER_JOB, lastRunAt, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/** How long the schedule may go unrecorded before it logs a quiet heartbeat. */
const HEARTBEAT_MS = 6 * 60 * 60 * 1000;

/**
 * Per-tracker reminders: "gym at 18:00", or namaz at all five waqts —
 * each time-slot fires once, and only while the day still needs it.
 *
 * Vercel's Hobby plan fires a cron once a day, which is useless for times
 * chosen per tracker — so this route is built to be *polled*: GitHub Actions
 * every 15 minutes (`.github/workflows/reminders.yml`), cron-job.org, or
 * anything else that can make an HTTP request. The app also pokes
 * `/api/reminders/flush` when it is opened, so a phone that opens PIT catches
 * up on its own reminders even with no scheduler at all.
 *
 * The arithmetic lives in lib/trackerReminders, the delivery in
 * lib/trackerReminderRun: a slot is due for a 3-hour window after its time,
 * sends at most once per local day, and a window that passed while the
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

  // Same door policy as the daily job: header or ?key=, and a wrong secret
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
    // matter. But *complete* silence is indistinguishable from a schedule
    // that stopped, which is the failure this log exists to catch, so a
    // quiet run still leaves a heartbeat every few hours.
    const did = result.notified > 0 || result.missed > 0;
    const last = did ? null : await lastRunAt(TRACKER_REMINDER_JOB);
    const stale = last === null || Date.now() - last.getTime() > HEARTBEAT_MS;
    if (did || stale) {
      await recordRun(TRACKER_REMINDER_JOB, startedAt, {
        ok: true,
        checked: result.checked,
        notified: result.notified,
        skipped: result.skipped + result.missed,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await recordRun(TRACKER_REMINDER_JOB, startedAt, { ok: false, error: message });
    console.error("Tracker reminder run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
