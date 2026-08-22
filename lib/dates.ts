export type Period = "week" | "15d" | "month" | "6mo" | "year";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "15d", label: "15 Days" },
  { value: "month", label: "Month" },
  { value: "6mo", label: "6 Months" },
  { value: "year", label: "Year" },
];

const PERIOD_DAYS: Record<Period, number> = {
  week: 7,
  "15d": 15,
  month: 30,
  "6mo": 183,
  year: 365,
};

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

/** Whole days from `a` to `b` — negative if `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateStr(b).getTime() - parseDateStr(a).getTime();
  // Rounded, so a daylight-saving shift inside the range can't lose a day.
  return Math.round(ms / 86_400_000);
}

/** Inclusive date range ending on `today` for the given period. */
export function periodRange(
  period: Period,
  today: string
): { start: string; end: string; days: number } {
  const days = PERIOD_DAYS[period];
  return { start: addDays(today, -(days - 1)), end: today, days };
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
