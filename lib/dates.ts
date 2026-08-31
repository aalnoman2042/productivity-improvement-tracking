export type Period = "week" | "15d" | "month" | "6mo" | "year";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "15d", label: "Half month" },
  { value: "month", label: "Month" },
  { value: "6mo", label: "6 Months" },
  { value: "year", label: "Year" },
];

/** Bucket granularity used for the trend chart of each period. */
export const PERIOD_BUCKET: Record<Period, "day" | "week" | "month"> = {
  week: "day",
  "15d": "day",
  month: "day",
  "6mo": "week",
  year: "month",
};

export function isValidDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Format a Date as local YYYY-MM-DD. */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/**
 * A day nobody has lived through yet — the server's test for "you can't log
 * that".
 *
 * The awkward part is that the server has no idea what day it is *for the
 * caller*. Rule: never trust a client's "today" for anything that guards,
 * but a date-scoped feature is about the reader's clock, not UTC's. So this
 * allows a full day of slack in both directions of the international date
 * line — someone in UTC+14 is legitimately a day ahead of the server, and
 * refusing their evening's log would be a bug they could never explain.
 *
 * What it catches is the thing worth catching: a log dated next week. The
 * daily page can offer tomorrow for *planning* precisely because logging it
 * is refused here, where the refusal cannot be edited out by a client.
 */
export function isBeyondToday(date: string, now: Date = new Date()): boolean {
  const utcToday = now.toISOString().slice(0, 10);
  return date > addDays(utcToday, 1);
}

/** Whole days from `a` to `b` — negative if `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  // Rounded, so a daylight-saving shift inside the range can't lose a day.
  return Math.round(ms / 86_400_000);
}

/* ------------------------- calendar periods --------------------------- */

/**
 * Every period on this app is a **calendar unit**, not a rolling window.
 *
 * "Month" means August — the 1st to the 31st — and never "the last thirty
 * days", which is a different question with a different answer and no name a
 * person would use. The same goes down the list: a week is Monday to Sunday,
 * a half is the 1st–15th or the 16th–end, a half-year is Jan–Jun or Jul–Dec,
 * a year is January to December. That is what makes a period something you
 * can *pick* — August is a thing that stays still, "the last 30 days" is not
 * — and it is why the picker can offer a list of them.
 *
 * A unit is identified by its first day, which is what `anchor` is
 * everywhere below and on the wire.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** A month index counted from year 0, back as YYYY-MM. */
const monthKey = (months: number) =>
  `${Math.floor(months / 12)}-${pad((months % 12) + 1)}`;

/** First day of the calendar unit of `period` that `date` falls in. */
export function periodStart(period: Period, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  switch (period) {
    case "week": {
      const dt = parseDateStr(date);
      dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // back to Monday
      return toDateStr(dt);
    }
    case "15d":
      return `${y}-${pad(m)}-${d <= 15 ? "01" : "16"}`;
    case "month":
      return `${y}-${pad(m)}-01`;
    case "6mo":
      return `${y}-${m <= 6 ? "01" : "07"}-01`;
    case "year":
      return `${y}-01-01`;
  }
}

/** Last day of the unit beginning on `start`, whether or not it has arrived. */
export function periodEnd(period: Period, start: string): string {
  const [y, m, d] = start.split("-").map(Number);
  switch (period) {
    case "week":
      return addDays(start, 6);
    case "15d":
      // Day 0 of the next month is the last day of this one, leap years and all.
      return d === 1 ? `${y}-${pad(m)}-15` : toDateStr(new Date(y, m, 0));
    case "month":
      return toDateStr(new Date(y, m, 0));
    case "6mo":
      return toDateStr(new Date(y, m + 5, 0));
    case "year":
      return `${y}-12-31`;
  }
}

/** The unit `n` steps away from the one beginning on `start`. */
export function shiftPeriod(period: Period, start: string, n: number): string {
  if (period === "week") return addDays(start, 7 * n);
  const [y, m, d] = start.split("-").map(Number);
  if (period === "15d") {
    // Halves alternate, so count in halves and split the answer back out.
    const halves = (y * 12 + (m - 1)) * 2 + (d === 1 ? 0 : 1) + n;
    return `${monthKey(Math.floor(halves / 2))}-${halves % 2 === 0 ? "01" : "16"}`;
  }
  const step = period === "month" ? 1 : period === "6mo" ? 6 : 12;
  return `${monthKey(y * 12 + (m - 1) + step * n)}-01`;
}

export type PeriodRange = {
  /** First day of the unit. */
  start: string;
  /** Last day *counted* — the unit's end, or today while it is still running. */
  end: string;
  /** Days from `start` to `end`, inclusive. */
  days: number;
  /** Last day of the unit itself, reached or not. */
  unitEnd: string;
  /** The unit hasn't finished yet, so `end` is short of `unitEnd`. */
  partial: boolean;
};

/**
 * The dates one period covers.
 *
 * `anchor` is any day inside the wanted unit (its first day, normally).
 * `today` is the reader's clock: the current month is counted up to today
 * rather than to the 31st, because a coverage figure that counts days you
 * haven't lived yet as untracked is a lie about the month you're having.
 * A finished month is counted whole.
 */
export function periodRange(
  period: Period,
  anchor: string,
  today?: string
): PeriodRange {
  const start = periodStart(period, anchor);
  const unitEnd = periodEnd(period, start);
  const running = today !== undefined && today >= start && today < unitEnd;
  const end = running ? today : unitEnd;
  return { start, end, days: daysBetween(start, end) + 1, unitEnd, partial: running };
}

/**
 * The stretch a period is compared against: the unit before it.
 *
 * A *running* unit is compared against the same many days of the one before,
 * not the whole of it — five days of September against the whole of August
 * would read as a collapse every month, on the 5th.
 */
export function previousRange(
  period: Period,
  range: PeriodRange
): { start: string; end: string } {
  const start = shiftPeriod(period, range.start, -1);
  const last = addDays(range.start, -1);
  if (!range.partial) return { start, end: last };
  const sameLength = addDays(start, range.days - 1);
  return { start, end: sameLength < last ? sameLength : last };
}

/** "August 2026", "16–31 Aug 2026", "Jan–Jun 2026" — a unit, said out loud. */
export function periodLabel(period: Period, start: string): string {
  const [y, m, d] = start.split("-").map(Number);
  const end = parseDateStr(periodEnd(period, start));
  switch (period) {
    case "year":
      return String(y);
    case "6mo":
      return `${m <= 6 ? "Jan–Jun" : "Jul–Dec"} ${y}`;
    case "month":
      return `${MONTH_NAMES[m - 1]} ${y}`;
    case "15d":
      return `${d}–${end.getDate()} ${MONTHS[m - 1]} ${y}`;
    case "week":
      return end.getMonth() === m - 1
        ? `${d}–${end.getDate()} ${MONTHS[m - 1]} ${y}`
        : `${d} ${MONTHS[m - 1]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  }
}

/**
 * The units the picker offers: newest first, back to the one holding `from`
 * (the first day ever logged), capped so a long record can't build a list
 * nobody can scroll.
 */
export function periodOptions(
  period: Period,
  from: string,
  to: string,
  max = 120
): string[] {
  const first = periodStart(period, from);
  const out: string[] = [];
  let cur = periodStart(period, to);
  while (cur >= first && out.length < max) {
    out.push(cur);
    cur = shiftPeriod(period, cur, -1);
  }
  return out;
}

/** Label for a bucket key shown on the trend chart's x-axis. */
export function bucketOf(date: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return date;
  if (granularity === "month") return date.slice(0, 7); // YYYY-MM
  // week: Monday of that week
  const d = parseDateStr(date);
  const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dow);
  return toDateStr(d);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** "Friday 1 Aug" — for notification text and delete confirmations. */
export function prettyDate(s: string): string {
  const d = parseDateStr(s);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function bucketLabel(key: string, granularity: "day" | "week" | "month"): string {
  if (granularity === "month") {
    const [, m] = key.split("-").map(Number);
    return MONTHS[m - 1];
  }
  const d = parseDateStr(key);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** All bucket keys covering the range, in order (so empty buckets still appear). */
export function bucketsForRange(
  start: string,
  end: string,
  granularity: "day" | "week" | "month"
): string[] {
  const keys: string[] = [];
  let cur = bucketOf(start, granularity);
  const last = bucketOf(end, granularity);
  while (cur <= last) {
    keys.push(cur);
    if (granularity === "day") cur = addDays(cur, 1);
    else if (granularity === "week") cur = addDays(cur, 7);
    else {
      const [y, m] = cur.split("-").map(Number);
      cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return keys;
}

/* -------------------------- calendar months --------------------------- */

/**
 * A 24-hour "HH:MM" said the way people say it — "11 PM", "6:30 am".
 * The input keeps 24-hour time because that's what a time field speaks; the
 * sentence around it shouldn't have to.
 */
export function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function isValidMonthStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
}

/** The month a date falls in, as YYYY-MM. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First and last day of a month, inclusive. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    // Day 0 of the next month is the last day of this one, leap years included.
    end: toDateStr(new Date(y, m, 0)),
  };
}

/** "August 2026" — for the calendar's heading. */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Every date in a month, padded to whole weeks starting Monday, with nulls
 * for the leading and trailing blanks so a grid can render it straight out.
 */
export function calendarGrid(month: string): (string | null)[] {
  const { start, end } = monthRange(month);
  const lead = (parseDateStr(start).getDay() + 6) % 7; // Mon=0
  const days: (string | null)[] = Array(lead).fill(null);
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
