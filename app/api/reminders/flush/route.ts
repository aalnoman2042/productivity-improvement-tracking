import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { pushConfigured } from "@/lib/push";
import { runReminders } from "@/lib/reminderRun";
import { runTrackerReminders } from "@/lib/trackerReminderRun";

// Reads the clock and the database on every call; nothing to cache.
export const dynamic = "force-dynamic";

/**
 * "Anything owed to me right now?" — the app asking on its own behalf.
 *
 * A reminder at a time you chose needs something to notice that the time has
 * come, and a Vercel Hobby deployment can only run a cron once a day. A
 * scheduler solves that properly (see DEPLOY.md), but a scheduler is a thing
 * the owner has to set up, and until they do, every per-tracker time is
 * silent — which is exactly the bug this exists to close.
 *
 * So the app pokes this whenever it is opened or comes back to the front. It
 * runs the same idempotent work the cron does, **for the caller only**: no
 * secret, no other accounts, nothing that a stranger could use to make
 * someone else's phone buzz. Every send is still stamped per day, so a poke
 * a minute cannot produce two notifications.
 *
 * It is a safety net, not the schedule. A phone in a pocket sends nothing.
 */
export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ ok: true, skipped: "no-push" });

  try {
    const [daily, tracker] = await Promise.all([
      runReminders(userId),
      runTrackerReminders(userId),
    ]);
    return NextResponse.json({
      ok: true,
      sent: daily.notified + tracker.notified,
      daily,
      tracker,
    });
  } catch (err) {
    // Never surface this to the page: it runs unasked, in the background,
    // and a failure here must not look like a broken app.
    console.error("Reminder flush failed:", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
