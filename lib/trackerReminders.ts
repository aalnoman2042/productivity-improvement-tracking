/**
 * Per-tracker reminders: "gym at 18:00", "prayers at 05:00".
 *
 * The nightly cron fires once; this schedule is polled — an external
 * scheduler hits /api/cron/tracker-reminders every few minutes, because
 * Vercel's Hobby plan won't fire a cron more than once a day. Everything
 * here is therefore written for a caller that arrives *repeatedly and
 * unpredictably*: a reminder is due for a whole grace window, sends at
 * most once per local day, and a window missed entirely (the scheduler
 * was down) is stamped as missed rather than delivered at midnight.
 */

/** How long past the set time a reminder is still worth sending. */
export const REMINDER_GRACE_MIN = 180;

/** Validate an incoming reminder time; anything unclear is "no reminder". */
export function parseReminderTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

export type TrackerReminder = {
  /** Local time of day, "HH:MM". */
  time: string;
  /** The local date last handled — sent or missed — so a re-poll can't double-send. */
  lastSentFor?: string | null;
};

export type ReminderCheck = {
  /** The user's local date this poll is about. */
  date: string;
  /** Send it now. */
  due: boolean;
  /** The window passed unserved — stamp the day and stay quiet. */
  missed: boolean;
};

/**
 * What one tracker's reminder calls for at this moment, in the user's
 * timezone. Exactly one of `due`/`missed` can be true, and both stay false
 * when the time hasn't come yet or the day is already stamped.
 */
export function checkReminder(
  reminder: TrackerReminder,
  now: Date,
  tzOffset: number
): ReminderCheck {
  const local = new Date(now.getTime() + tzOffset * 60_000);
  const date = local.toISOString().slice(0, 10);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();

  const [h, m] = reminder.time.split(":").map(Number);
  const target = h * 60 + m;

  if (reminder.lastSentFor === date || minutes < target) {
    return { date, due: false, missed: false };
  }
  const late = minutes - target;
  return {
    date,
    due: late <= REMINDER_GRACE_MIN,
    missed: late > REMINDER_GRACE_MIN,
  };
}
