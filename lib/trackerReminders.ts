/**
 * Per-tracker reminders: "gym at 18:00" — or namaz at all five waqts.
 *
 * A tracker carries up to five local times of day. This schedule is polled —
 * an external scheduler hits /api/cron/tracker-reminders every few minutes,
 * because Vercel's Hobby plan won't fire a cron more than once a day. (The
 * daily ask in /api/cron/reminders is polled by the same scheduler now that
 * its hour is the reader's to choose, but the arithmetic differs: that one
 * catches up all day, these slots expire.) Everything here is therefore
 * written for a caller that arrives *repeatedly and unpredictably*: each
 * time-slot is due for a grace window, sends at most once per local day, and
 * a slot missed entirely (the scheduler was down) is stamped as missed
 * rather than delivered at midnight.
 *
 * The dedupe stamp is a single string, `"YYYY-MM-DD HH:MM"` — the latest
 * slot handled. String order is time order, so "already handled" is one
 * lexicographic comparison, and yesterday's stamp can never silence today.
 */

/** How long past its set time a slot is still worth sending. */
export const REMINDER_GRACE_MIN = 180;

/** Five covers the use that asked for this — one reminder per waqt. */
export const MAX_REMINDER_TIMES = 5;

/**
 * Validate incoming reminder times — one "HH:MM" or a list — into a sorted,
 * deduplicated list. Anything unclear is "no reminder".
 */
export function parseReminderTimes(raw: unknown): string[] | null {
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const valid = list.filter(
    (t): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
  );
  const times = [...new Set(valid)].sort().slice(0, MAX_REMINDER_TIMES);
  return times.length > 0 ? times : null;
}

/**
 * Where a tracker's times come from. "fixed" is the list as typed; "prayer"
 * means the list is recomputed from the sun each day (`lib/prayerTimes`),
 * because a waqt is not a clock time — the stored `times` survive only as
 * the fallback for a day the sun can't be asked about.
 */
export type ReminderMode = "fixed" | "prayer";

export function parseReminderMode(raw: unknown): ReminderMode {
  return raw === "prayer" ? "prayer" : "fixed";
}

export type TrackerReminder = {
  /** Local times of day, "HH:MM", sorted. */
  times: string[];
  /** The latest slot handled, `"YYYY-MM-DD HH:MM"` — sent, missed or skipped. */
  lastSentFor?: string | null;
};

/**
 * The date it is where the user is. Shared with the schedule's callers
 * because the times for a day have to be computed for the *same* day this
 * poll is about — two ideas of "today" three hours apart is how a Fajr
 * reminder ends up being sent about yesterday.
 */
export function localDateFor(now: Date, tzOffset: number): string {
  return new Date(now.getTime() + tzOffset * 60_000).toISOString().slice(0, 10);
}

export type ReminderCheck = {
  /** The user's local date this poll is about. */
  date: string;
  /** The slot to send now, or null. When several slots crowd into one
   *  window, only the latest speaks — one push, not a backlog. */
  due: string | null;
  /** Slots whose window passed unserved this poll — stamped, never sent. */
  missed: string[];
  /** What `lastSentFor` should become once this poll is acted on. */
  stamp: string | null;
};

/** The dedupe key for one slot of one local day. */
export function slotKey(date: string, time: string): string {
  return `${date} ${time}`;
}

/**
 * What one tracker's reminder calls for at this moment, in the user's
 * timezone. Slots are walked oldest-first; anything at or before the stamp
 * is already handled, anything still in the future stops the walk.
 */
export function checkReminders(
  reminder: TrackerReminder,
  now: Date,
  tzOffset: number
): ReminderCheck {
  const local = new Date(now.getTime() + tzOffset * 60_000);
  const date = localDateFor(now, tzOffset);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const last = reminder.lastSentFor ?? "";

  let due: string | null = null;
  const missed: string[] = [];

  for (const time of [...reminder.times].sort()) {
    if (slotKey(date, time) <= last) continue;

    const [h, m] = time.split(":").map(Number);
    const late = minutes - (h * 60 + m);
    if (late < 0) break;

    if (late <= REMINDER_GRACE_MIN) {
      // A later slot inside the window supersedes an earlier one — the
      // notification tag would replace it in the tray anyway, so the
      // earlier slot is filed as missed rather than sent as a double.
      if (due) missed.push(due);
      due = time;
    } else {
      missed.push(time);
    }
  }

  const handled = due ?? missed[missed.length - 1] ?? null;
  return { date, due, missed, stamp: handled ? slotKey(date, handled) : null };
}
