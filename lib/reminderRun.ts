import { type Db, type ObjectId } from "mongodb";
import { db } from "./db";
import { sendToUser } from "./push";
import { addDays, daysBetween, parseDateStr } from "./dates";
import { dayToLog, dueNow, localDateStr, reminderTime } from "./reminders";
import { buildDigest } from "./digest";
import { challengeProgress } from "./challenges";
import { streakInfo } from "./streak";
import {
  LAPSE_DAYS,
  lapseMessage,
  loggingRun,
  nightlyMessage,
  type StakeInput,
} from "./stakes";

/**
 * The daily push run: the ask at the hour you chose, the Sunday week in
 * review, and the check-in for someone who has gone quiet.
 *
 * Lives in lib rather than in the cron route because two callers need it —
 * the schedule that polls `/api/cron/reminders`, and `/api/reminders/flush`,
 * which the app pokes when it is opened. Everything is idempotent and
 * stamped per day, so being called four times an hour costs nothing and
 * cannot send anything twice.
 */

export type ReminderRunResult = {
  checked: number;
  /** Users whose chosen hour had passed when this run came in. */
  due: number;
  notified: number;
  /** Asks that had something specific to say. */
  stakes: number;
  /** Check-ins sent to people who had stopped logging. */
  lapses: number;
  /** Already handled today. */
  skipped: number;
  /** Owed, but no browser took it. */
  undelivered: number;
  digests: number;
};

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
      const rows = streakRows.filter((e) => String(e.trackerId) === String(t._id));
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

/** The last day this account has anything on record for, or null. */
async function lastLoggedDate(d: Db, userId: ObjectId): Promise<string | null> {
  const row = await d
    .collection("entries")
    .findOne({ userId }, { projection: { date: 1 }, sort: { date: -1 } });
  return row ? String(row.date) : null;
}

/**
 * Run the schedule. With `onlyUserId` it runs for one person — that is the
 * in-app poke, which must never send someone else's reminders.
 */
export async function runReminders(
  onlyUserId?: ObjectId
): Promise<ReminderRunResult> {
  const now = new Date();
  const d = await db();

  // Two audiences, one pass. The daily ask belongs to whoever switched
  // reminders on; the gone-quiet check-in goes to anyone with a device
  // listening at all — it is the message you cannot ask for in advance,
  // because by the time it applies you have stopped opening the app.
  const subscribed = (await d
    .collection("pushSubs")
    .distinct("userId", onlyUserId ? { userId: onlyUserId } : {})) as ObjectId[];

  const users = await d
    .collection("users")
    .find(
      {
        ...(onlyUserId ? { _id: onlyUserId } : {}),
        $or: [{ "reminder.enabled": true }, { _id: { $in: subscribed } }],
      },
      { projection: { name: 1, reminder: 1, createdAt: 1 } }
    )
    .toArray();

  const result: ReminderRunResult = {
    checked: users.length,
    due: 0,
    notified: 0,
    stakes: 0,
    lapses: 0,
    skipped: 0,
    undelivered: 0,
    digests: 0,
  };

  for (const user of users) {
    const tzOffset = Number(user.reminder?.tzOffset ?? 0);
    const time = reminderTime(user.reminder?.time);
    // Their hour hasn't come round yet — say nothing, and don't count it as
    // a skip either. Nothing was owed.
    if (!dueNow(now, tzOffset, time)) continue;
    result.due++;

    const today = localDateStr(now, tzOffset);
    const date = dayToLog(now, tzOffset, time);

    // --- Gone quiet --------------------------------------------------------
    // Three days without a single entry is the habit coming apart, and it is
    // exactly when the app has stopped being opened — so this one doesn't
    // wait to be asked for, and it replaces the ordinary ask rather than
    // arriving beside it. Re-sent no more often than the gap it is about.
    const last = await lastLoggedDate(d, user._id);
    const away = last ? daysBetween(last, today) : accountAge(user.createdAt, today);
    const lastLapse = user.reminder?.lastLapseFor as string | undefined;
    const quietSince = lastLapse ? daysBetween(lastLapse, today) : Infinity;

    if (away >= LAPSE_DAYS && quietSince >= LAPSE_DAYS) {
      const message = lapseMessage(away, last);
      const { sent } = await sendToUser(user._id, {
        title: message.title,
        body: message.body,
        url: message.url,
        tag: `pit-lapse-${today}`,
      });
      if (sent > 0) {
        result.lapses++;
        result.notified++;
        await d.collection("users").updateOne(
          { _id: user._id },
          {
            // The day's ordinary ask is stamped too: one message, never two.
            $set: { "reminder.lastLapseFor": today, "reminder.lastSentFor": date },
          }
        );
      } else {
        result.undelivered++;
      }
      continue;
    }

    if (!user.reminder?.enabled) continue;

    // --- The daily ask -----------------------------------------------------
    // Goes out every day, logged or not — the ask is the closing ritual of
    // the day, not just a nag about an empty one. What it *says* depends on
    // the night: a milestone crossed, a challenge on its last day, a logging
    // run about to break, or the ordinary question.
    if (user.reminder?.lastSentFor === date) {
      result.skipped++;
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
        result.notified++;
        if (stake.kind !== "plain") result.stakes++;
        await d
          .collection("users")
          .updateOne({ _id: user._id }, { $set: { "reminder.lastSentFor": date } });
      } else {
        // Reminders are on but no browser is subscribed — leave the day
        // unstamped so a later run can still reach them.
        result.undelivered++;
      }
    }

    // --- The week-in-review ------------------------------------------------
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
          result.digests++;
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

  return result;
}

/**
 * How long an account with nothing on record has had the chance. Someone who
 * signed up yesterday is not lapsed, they are new — and being told off on
 * day two is how an app gets deleted.
 */
function accountAge(createdAt: unknown, today: string): number {
  if (!(createdAt instanceof Date)) return 0;
  return daysBetween(createdAt.toISOString().slice(0, 10), today);
}
