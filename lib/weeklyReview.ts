import { addDays, bucketOf, parseDateStr } from "./dates";

/**
 * The week in review — and, more to the point, the weeks in review.
 *
 * The daily coach is a snapshot that the next one replaces: eight hours
 * later, what it said in June is gone. That is right for "how am I doing
 * right now" and useless as a record. A life is judged over months, so one
 * review a week is written once and then kept — forty of them is a year you
 * can actually read back.
 *
 * Everything here is the arithmetic of which week is which. Weeks run Monday
 * to Sunday, as everywhere else in this app.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type Week = { start: string; end: string };

/** The Monday–Sunday week that `date` falls inside. */
export function weekOf(date: string): Week {
  const start = bucketOf(date, "week");
  return { start, end: addDays(start, 6) };
}

/**
 * The most recent week that is actually over.
 *
 * A week is not reviewable while it is still being lived, so Sunday reviews
 * the week before it and Monday reviews the one that just ended. The
 * alternative — reviewing a week at noon on its last day — produces a
 * verdict that the evening can still make wrong.
 */
export function lastCompleteWeek(today: string): Week {
  const thisWeek = weekOf(today);
  return today > thisWeek.end
    ? thisWeek
    : { start: addDays(thisWeek.start, -7), end: addDays(thisWeek.start, -1) };
}

/** Whether a week has ended, and can therefore be reviewed. */
export function isComplete(week: Week, today: string): boolean {
  return week.end < today;
}

/** "18–24 Aug", or "29 Jun – 5 Jul" when it straddles two months. */
export function weekTitle(week: Week): string {
  const a = parseDateStr(week.start);
  const b = parseDateStr(week.end);
  const left = `${a.getDate()}${a.getMonth() === b.getMonth() ? "" : ` ${MONTHS[a.getMonth()]}`}`;
  const right = `${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return a.getMonth() === b.getMonth()
    ? `${left}–${right}`
    : `${left} – ${right}`;
}

/**
 * The weeks between two dates, newest first — what "catch up on the ones I
 * missed" offers, bounded so a year-old account isn't handed fifty buttons.
 */
export function completeWeeksSince(from: string, today: string, max = 8): Week[] {
  const weeks: Week[] = [];
  let week = lastCompleteWeek(today);
  while (weeks.length < max && week.end >= from) {
    weeks.push(week);
    week = { start: addDays(week.start, -7), end: addDays(week.end, -7) };
  }
  return weeks;
}
