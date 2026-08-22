import { NextResponse } from "next/server";
import { type Db, type ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { pushConfigured, sendToUser } from "@/lib/push";
import { addDays, parseDateStr } from "@/lib/dates";
import { dayToLog, dueNow, reminderTime } from "@/lib/reminders";
import { buildDigest } from "@/lib/digest";
import { challengeProgress } from "@/lib/challenges";
import { streakInfo } from "@/lib/streak";
import { loggingRun, nightlyMessage, type StakeInput } from "@/lib/stakes";
import { REMINDER_JOB, recordRun } from "@/lib/cronLog";

// Nothing here may be prerendered or cached — it must read the database at
// the moment it is called.
export const dynamic = "force-dynamic";

/**
 * The daily nudge, at the hour each person chose.
 *
 * That choice is what makes this a *polled* endpoint rather than a scheduled
 * one: Vercel's Hobby plan fires a cron once a day, which can only ever be
 * right for one timezone and one bedtime. So the same external scheduler
 * that drives the per-tracker reminders calls this every 15 minutes (see
 * DEPLOY.md), and each poll asks `dueNow` whose time has come. The Vercel
 * cron in vercel.json stays as a once-a-day backstop.
 *
 * Deliberately idempotent: each user records the last day it nagged them
 * about, so calling this a hundred times — a retry, a manual poke, a second
 * scheduler — can't produce two notifications for the same day.
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
    if (result.notified > 0 || result.digests > 0 || result.undelivered > 0) {
      await recordRun(REMINDER_JOB, startedAt, { ok: true, ...counts(result) });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await recordRun(REMINDER_JOB, startedAt, { ok: false, error: message });
    console.error("Nightly reminder run failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * What is actually at stake for one person tonight.
 *
 * Three small reads, handed straight to `nightlyMessage` — nothing here
 * decides anything, it only fetches. The entry window reaches back far enough
 * for the logging run *and* to the start of the longest challenge still
 * running, because a 60-day challenge has to be judged over all 60.
 */
async function gatherStake(
  d: Db,
  userId: ObjectId,
  date: string
): Promise<StakeInput> {
  const [trackerDocs, challengeDocs] = await Promise.all([
    d
      .collection("trackers")
      .find({ userId }, { projection: { name: 1, type: 1 } })
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
  ]);

  let since = addDays(date, -34);
  for (const c of challengeDocs) {
    const start = String(c.startDate);
    if (start < since) since = start;
  }

  const streakIds = trackerDocs.filter((t) => t.type === "streak").map((t) => t._id);

  const [windowRows, streakRows] = await Promise.all([
    d
      .collection("entries")
      .find(
        { userId, date: { $gte: since, $lte: date } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    // A clean streak is measured from its last slip, and that can be any date
    // at all — so these come whole rather than windowed. One row per day.
    streakIds.length > 0
      ? d
          .collection("entries")
          .find(
            { userId, trackerId: { $in: streakIds }, date: { $lte: date } },
            { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
          )
          .toArray()
      : Promise.resolve([]),
  ]);

  const loggedDates = new Set(windowRows.map((e) => String(e.date)));

  const streaks = trackerDocs
    .filter((t) => t.type === "streak")
    .map((t) => {
      const rows = streakRows.filter(
        (e) => String(e.trackerId) === String(t._id)
      );
      const dates = rows.map((e) => String(e.date)).sort();
      const info = streakInfo(
        dates[0] ?? null,
        rows.filter((e) => Number(e.value) <= 0).map((e) => String(e.date)),
        date
      );
      return { name: String(t.name), current: info.current };
    });

  const challenges = challengeDocs.map((c) => {
    const values: Record<string, number> = {};
    for (const e of windowRows) {
      if (String(e.trackerId) === String(c.trackerId)) {
        values[String(e.date)] = Number(e.value);
      }
    }
    const p = challengeProgress(
      {
        startDate: String(c.startDate),
        days: Number(c.days),
        target: c.target == null ? null : Number(c.target),
        direction: c.direction === "max" ? "max" : "min",
        values,
      },
      date
    );
    return {
      name: String(c.name),
      status: p.status,
      dayNumber: p.dayNumber,
      days: Number(c.days),
      todayMet: p.todayMet,
    };
  });

  return {
    date,
    loggedToday: loggedDates.has(date),
    loggingStreak: loggingRun(loggedDates, date),
    streaks,
    challenges,
  };
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
  // Owed, but no browser took it — reminders on, no live subscription.
  let undelivered = 0;
  let digests = 0;
  // How many of tonight's asks had something specific to say.
  let stakes = 0;
  // Users whose chosen hour had passed when this poll came in.
  let due = 0;

  for (const user of users) {
    const tzOffset = Number(user.reminder?.tzOffset ?? 0);
    const time = reminderTime(user.reminder?.time);
    // Their hour hasn't come round yet — say nothing, and don't count it as
    // a skip either. Nothing was owed.
    if (!dueNow(now, tzOffset, time)) continue;
    due++;

    const date = dayToLog(now, tzOffset, time);

    // --- The daily ask -----------------------------------------------------
    // Goes out every day, logged or not — the ask is the closing ritual of
    // the day, not just a nag about an empty one. What it *says*
    // depends on the night: a milestone crossed, a challenge on its last day,
    // a logging run about to break, or the ordinary question.
    if (user.reminder?.lastSentFor === date) {
      skipped++;
    } else {
      const stake = nightlyMessage(await gatherStake(d, user._id, date));
      const { sent } = await sendToUser(user._id, {
        title: stake.title,
        body: stake.body,
        url: stake.url,
        // One notification per day: a re-send replaces it rather than
        // stacking a second one in the tray.
        tag: `pit-reminder-${date}`,
      });
      if (sent > 0) {
        notified++;
        if (stake.kind !== "plain") stakes++;
        await d
          .collection("users")
          .updateOne({ _id: user._id }, { $set: { "reminder.lastSentFor": date } });
      } else {
        // Reminders are on but no browser is subscribed — leave the day
        // unstamped so a later run can still reach them.
        undelivered++;
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

  return { checked: users.length, due, notified, stakes, skipped, undelivered, digests };
}

/** The run's shape, mapped onto the shared cronRuns columns. */
function counts(r: {
  checked: number;
  notified: number;
  stakes: number;
  skipped: number;
  undelivered: number;
  digests: number;
}) {
  return {
    checked: r.checked,
    notified: r.notified,
    stakes: r.stakes,
    skipped: r.skipped + r.undelivered,
    digests: r.digests,
  };
}
