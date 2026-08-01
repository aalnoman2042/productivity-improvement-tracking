/**
 * Which day a nightly reminder is about.
 *
 * The cron fires at one moment in UTC; everyone reading the notification is
 * somewhere else. `tzOffset` is minutes east of UTC (+360 for UTC+6), stored
 * when the reminder is switched on.
 */

/** The date it currently is where the user is. */
export function localDateStr(now: Date, tzOffset: number): string {
  return shifted(now, tzOffset).toISOString().slice(0, 10);
}

/**
 * The day the reminder should nag about. Stepping back two hours matters:
 * a nudge landing at 00:00 is about the day that just ended, not the one
 * that started sixty seconds ago.
 */
export function dayToLog(now: Date, tzOffset: number): string {
  return shifted(now, tzOffset - 120).toISOString().slice(0, 10);
}

function shifted(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}
