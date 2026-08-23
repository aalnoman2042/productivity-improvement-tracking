import { type Db, type ObjectId } from "mongodb";
import { db } from "./db";
import { sendToUser } from "./push";
import { prayerTimesFor, type PrayerPlace } from "./prayerTimes";
import { checkReminders, localDateFor } from "./trackerReminders";

/**
 * Delivering the per-tracker reminders — "gym at 18:00", namaz at all five
 * waqts.
 *
 * The arithmetic lives in `lib/trackerReminders`; this is the part that
 * touches the database and the push service. It sits in lib rather than in
 * the route because **two** callers need it: the schedule that polls
 * `/api/cron/tracker-reminders`, and `/api/reminders/flush`, which the app
 * pokes when it is opened. That second caller is the difference between a
 * reminder arriving and a reminder existing: without an external poller, a
 * Vercel Hobby deployment can only fire a cron once a day, and a time you
 * chose yourself would never come round.
 */

export type TrackerRunResult = {
  checked: number;
  notified: number;
  /** Slots due but already satisfied by a log, or undeliverable — quiet. */
  skipped: number;
  /** Slots whose window passed unserved — stamped quiet. */
  missed: number;
};

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

function stamp(d: Db, trackerId: ObjectId, key: string) {
  return d
    .collection("trackers")
    .updateOne({ _id: trackerId }, { $set: { "reminder.lastSentFor": key } });
}

/**
 * Run the schedule. With `onlyUserId` it runs for one person — that is the
 * in-app poke, which must never send someone else's reminders just because
 * they happened to open the app.
 */
export async function runTrackerReminders(
  onlyUserId?: ObjectId
): Promise<TrackerRunResult> {
  const now = new Date();
  const d = await db();

  const trackers = await d
    .collection("trackers")
    .find(
      {
        reminder: { $ne: null },
        archived: false,
        ...(onlyUserId ? { userId: onlyUserId } : {}),
      },
      { projection: { userId: 1, name: 1, type: 1, reminder: 1 } }
    )
    .toArray();

  const result: TrackerRunResult = {
    checked: trackers.length,
    notified: 0,
    skipped: 0,
    missed: 0,
  };
  if (trackers.length === 0) return result;

  // One read for every owner's clock rather than one per tracker.
  const userIds = [...new Set(trackers.map((t) => String(t.userId)))].map(
    (id) => trackers.find((t) => String(t.userId) === id)!.userId
  );
  const users = await d
    .collection("users")
    .find(
      { _id: { $in: userIds } },
      { projection: { "reminder.tzOffset": 1, "reminder.place": 1 } }
    )
    .toArray();
  const tzBy = new Map(
    users.map((u) => [String(u._id), Number(u.reminder?.tzOffset ?? NaN)])
  );
  const placeBy = new Map(
    users.map((u) => [
      String(u._id),
      (u.reminder?.place as PrayerPlace | undefined) ?? null,
    ])
  );

  // Today's waqts, worked out once per (person, day) however many prayer
  // trackers they keep — the arithmetic is cheap but not free, and a poll
  // runs every fifteen minutes forever.
  const waqtCache = new Map<string, ReturnType<typeof prayerTimesFor>>();
  function waqts(userId: string, place: PrayerPlace, date: string) {
    const key = `${userId} ${date}`;
    if (!waqtCache.has(key)) {
      waqtCache.set(key, prayerTimesFor(date, place, tzBy.get(userId)!));
    }
    return waqtCache.get(key)!;
  }

  for (const t of trackers) {
    const tzOffset = tzBy.get(String(t.userId));
    // No known clock, no reminder — better silent than at a stranger's 3 AM.
    if (tzOffset === undefined || !Number.isFinite(tzOffset)) {
      result.skipped++;
      continue;
    }

    const stored = Array.isArray(t.reminder.times)
      ? t.reminder.times.map(String)
      : [];

    // A prayer tracker asks the sun, not the stored list: a waqt moves by an
    // hour and a half across the year. The stored times stay as the fallback
    // for the two cases the sun can't cover — no location on file, and the
    // polar days where there is no true Fajr at all.
    const place = placeBy.get(String(t.userId));
    const prayerMode = t.reminder.mode === "prayer" && place;
    const slots = prayerMode
      ? waqts(String(t.userId), place, localDateFor(now, tzOffset))
      : null;
    const times = slots ? slots.map((s) => s.time) : stored;

    const check = checkReminders(
      { times, lastSentFor: t.reminder.lastSentFor ?? null },
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

    // Naming the waqt is the difference between "something is due" and
    // knowing what: the time alone means nothing when it moves every day.
    const waqt = slots?.find((s) => s.time === check.due)?.label ?? null;

    const { sent } = await sendToUser(t.userId, {
      title: waqt ? `🕌 ${waqt} — ${name}` : `⏰ ${name}`,
      body: waqt
        ? `${waqt} is in at ${check.due}. Log ${name} once you've prayed.`
        : `You asked for a nudge at ${check.due} — log ${name} when it's done.`,
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
