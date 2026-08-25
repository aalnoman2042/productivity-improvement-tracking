import { NextResponse } from "next/server";
import { pushConfigured } from "@/lib/push";
import { runReminders } from "@/lib/reminderRun";
import { REMINDER_JOB, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/**
 * The daily nudge, at the hour each person chose — and the check-in for
 * anyone who has gone quiet for days.
 *
 * That choice of hour is what makes this a *polled* endpoint rather than a
 * scheduled one: Vercel's Hobby plan fires a cron once a day, which can only
 * ever be right for one timezone and one bedtime. So a scheduler calls this
 * every 15 minutes (GitHub Actions in `.github/workflows/reminders.yml`, or
 * cron-job.org — see DEPLOY.md), and each poll asks whose time has come. The
 * daily cron in vercel.json stays as a backstop, and the app itself pokes
 * `/api/reminders/flush` when it is opened.
 *
 * All the work is in `lib/reminderRun`; this file is the door. Deliberately
 * idempotent: each user records the day it was last nagged about, so calling
 * this a hundred times cannot produce two notifications for the same day.
 */
export async function GET(req: Request) {
  const startedAt = new Date();

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Worth recording: "the schedule fired but the site wasn't configured for
    // it" and "the schedule never fired" look identical from the outside.
    await recordRun(REMINDER_JOB, startedAt, {
      ok: false,
      error: "CRON_SECRET is not set",
    });
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; the query
  // parameter is there for schedulers that can't set headers.
  // A wrong secret is deliberately *not* logged — otherwise anyone who can
  // reach the URL could fill the run log and hide a real outage behind it.
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!pushConfigured()) {
    await recordRun(REMINDER_JOB, startedAt, {
      ok: false,
      error: "Push is not configured (VAPID keys missing)",
    });
    return NextResponse.json({ error: "Push is not configured" }, { status: 503 });
  }

  try {
    const result = await runReminders();
    // Only a poll that *did* something is worth a row. Four an hour, all
    // day, would bury the runs that matter — and the Account page reads the
    // newest row to say when a reminder last went out, which should mean
    // exactly that. A reminder owed but undeliverable counts: that is the
    // outage worth seeing.
    if (
      result.notified > 0 ||
      result.digests > 0 ||
      result.undelivered > 0 ||
      result.deferred > 0
    ) {
      await recordRun(REMINDER_JOB, startedAt, {
        ok: true,
        checked: result.checked,
        notified: result.notified,
        stakes: result.stakes,
        lapses: result.lapses,
        skipped: result.skipped + result.undelivered,
        deferred: result.deferred,
        digests: result.digests,
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await recordRun(REMINDER_JOB, startedAt, { ok: false, error: message });
    console.error("Reminder run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
