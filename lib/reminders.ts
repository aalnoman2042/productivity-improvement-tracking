/**
 * When a nightly reminder goes out, and which day it is about.
 *
 * The cron fires at one moment in UTC; everyone reading the notification is
 * somewhere else. `tzOffset` is minutes east of UTC (+360 for UTC+6), stored
 * when the reminder is switched on.
 *
 * The hour is the user's to choose, which changes what the schedule has to
 * be: a job that fires once a day can only ever be right for one person's
 * evening, so `/api/cron/reminders` is written to be **polled** (every 15
 * minutes, same scheduler as the per-tracker reminders) and each poll asks
 * this module whether that person's time has come. `dueNow` is a catch-up,
 * not a window — once the chosen time has passed, the next poll of the day
 * sends. A poller that stalls until evening delivers late; it never skips
 * the day silently, which is the failure nobody would notice.
 */

/** The hour the reminder kept before it was anyone's to set. */
export const DEFAULT_REMINDER_TIME = "23:00";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A chosen time of day, or null if it isn't one. */
export function parseTimeOfDay(raw: unknown): string | null {
  return typeof raw === "string" && HHMM.test(raw) ? raw : null;
}

/** A stored time, falling back to the hour this feature was born with. */
export function reminderTime(raw: unknown): string {
  return parseTimeOfDay(raw) ?? DEFAULT_REMINDER_TIME;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The date it currently is where the user is. */
export function localDateStr(now: Date, tzOffset: number): string {
  return shifted(now, tzOffset).toISOString().slice(0, 10);
}

/** Minutes past local midnight, where the user is. */
export function localMinutes(now: Date, tzOffset: number): number {
  const local = shifted(now, tzOffset);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Has this person's chosen time arrived today? True for the rest of their
 * local day once it has — the send itself is deduped by the day it names,
 * so a late poll still delivers exactly one reminder.
 */
export function dueNow(now: Date, tzOffset: number, time: unknown): boolean {
  return localMinutes(now, tzOffset) >= minutesOf(reminderTime(time));
}

/**
 * The day the reminder should ask about.
 *
 * Stepping back two hours matters for an evening ask: one landing at 11 PM
 * names the day that's wrapping up, and one that slips past midnight still
 * names the day that just ended, not the one that started sixty seconds ago.
 *
 * A reminder set for the morning is a different question — nobody wants to
 * be asked at 7 AM how today went — so anything before noon asks about
 * yesterday instead.
 */
export function dayToLog(now: Date, tzOffset: number, time?: unknown): string {
  const chosen = reminderTime(time);
  const morning = minutesOf(chosen) < 12 * 60;
  return shifted(now, tzOffset - 120 - (morning ? 1440 : 0))
    .toISOString()
    .slice(0, 10);
}

function shifted(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}
