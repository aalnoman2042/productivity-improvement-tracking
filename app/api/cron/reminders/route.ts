import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { addDays, parseDateStr, prettyDate } from "@/lib/dates";
import { dayToLog } from "@/lib/reminders";
import { buildDigest } from "@/lib/digest";
import { REMINDER_JOB, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/**
 * The nightly nudge. Vercel Cron calls this on the schedule in vercel.json
 * (see DEPLOY.md); any scheduler that can send a header works just as well.
 *
 * Deliberately idempotent: each user records the last day it nagged them
 * about, so calling this twice — a retry, a manual poke, a second scheduler —
 * can't produce two notifications for the same day.
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
    await recordRun(REMINDER_JOB, startedAt, { ok: true, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await recordRun(REMINDER_JOB, startedAt, { ok: false, error: message });
    console.error("Nightly reminder run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** The run itself, lifted out so the wrapper above can log whatever it does. */
async function runReminders() {
  const now = new Date();
  const d = await db();
  const users = await d
    .collection("users")
    .find({ "reminder.enabled": true }, { projection: { name: 1, reminder: 1 } })
    .toArray();

  let notified = 0;
  let skipped = 0;
  let digests = 0;

  for (const user of users) {
    const date = dayToLog(now, Number(user.reminder?.tzOffset ?? 0));

    // --- The nightly ask ---------------------------------------------------
    // Goes out every night, logged or not — the 11 PM ask is the closing
    // ritual of the day, not just a nag about an empty one.
    if (user.reminder?.lastSentFor === date) {
      skipped++;
    } else {
      const { sent } = await sendToUser(user._id, {
        title: "The day is finished — how was it?",
        body: `Tell me about ${prettyDate(date)}, so I can track your life better.`,
        url: `/?date=${date}`,
        // One notification per day: a re-send replaces it rather than
        // stacking a second one in the tray.
        tag: `pit-reminder-${date}`,
      });
      if (sent > 0) {
        notified++;
        await d
          .collection("users")
          .updateOne({ _id: user._id }, { $set: { "reminder.lastSentFor": date } });
      } else {
        // Reminders are on but no browser is subscribed — leave the day
        // unstamped so a later run can still reach them.
        skipped++;
      }
    }

    // --- The week-in-review ----------------------------------------------
    // Covers the most recent completed Mon–Sun week. Normally that means
    // Sunday night, but a phone that was off then still gets it on Monday
    // or Tuesday — the week is stamped only once a device has actually
    // taken the push. Past Tuesday the week is stale and quietly dropped.
    const dow = parseDateStr(date).getDay(); // Sunday = 0
    const weekEnd = dow === 0 ? date : addDays(date, -dow);
    if (dow <= 2 && user.reminder?.lastDigestFor !== weekEnd) {
      const digest = await buildDigest(d, user._id, weekEnd);
      if (digest) {
        const { sent } = await sendToUser(user._id, {
          ...digest,
          url: "/status",
          tag: `pit-digest-${weekEnd}`,
        });
        if (sent > 0) {
          digests++;
          await d
            .collection("users")
            .updateOne(
              { _id: user._id },
              { $set: { "reminder.lastDigestFor": weekEnd } }
            );
        }
      }
    }
  }

  return { checked: users.length, notified, skipped, digests };
}
