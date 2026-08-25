import { addDays, daysBetween } from "./dates";

/**
 * A year, one square a day.
 *
 * Everything else in this app answers a question — how am I doing, what
 * should I fix, will I get there. This answers none of them. It is the
 * picture of the record itself, the thing a wall calendar with crosses on it
 * gives you and a database never does: proof, at a glance, that a lot of
 * days happened.
 *
 * Deliberately drawn from the same values everything else is graded on, and
 * deliberately *not* a judgement: five levels of one colour, no red, no
 * grades, no "you missed 40 days". A year of a life is allowed to have holes
 * in it — see `lib/rest`, whose days are their own mark rather than a blank.
 *
 * Pure. The route hands it dates and values; the component draws exactly
 * what comes back, which is what keeps the picture honest and testable.
 */

/** Weeks start Monday here, as everywhere else in this app. */
export function startOfWeek(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // Sunday = 0
  const back = day === 0 ? 6 : day - 1;
  return addDays(date, -back);
}

export type PixelDay = {
  date: string;
  /** The day's value for whatever is being drawn; 0 when nothing was logged. */
  value: number;
  /** 0–4. 0 is "nothing on record", so an empty day is never a shade of one. */
  level: number;
  /** Marked as a day off on purpose — drawn as itself, not as a hole. */
  rest: boolean;
};

export type PixelYear = {
  from: string;
  to: string;
  /** Columns of seven, Monday at the top, oldest week first. */
  weeks: (PixelDay | null)[][];
  /** The largest value in the window — what the shades are measured against. */
  max: number;
  /** Days with anything on record. */
  logged: number;
  /** Days deliberately taken off. */
  rested: number;
  /** The sum of every value, for the kinds where a total means something. */
  total: number;
};

/**
 * Five buckets, and the reason there are five: fewer and a good day looks
 * like an average one; more and nobody can tell two shades apart on a phone.
 *
 * The scale is relative to the best day in the window rather than to a goal,
 * because a goal changes and a year should not be redrawn when it does.
 */
export function levelFor(value: number, max: number): number {
  if (value <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

/**
 * Lay a window of days out as calendar weeks.
 *
 * `values` is keyed by date. The grid always starts on the Monday on or
 * before `from` and ends on the Sunday on or after `to`, with the days
 * outside the window left as `null` — a square for a day that isn't in the
 * range would be a lie about how far back the record goes.
 */
export function pixelYear(
  from: string,
  to: string,
  values: Record<string, number>,
  rest: ReadonlySet<string> = new Set()
): PixelYear {
  const first = startOfWeek(from);
  const span = daysBetween(first, to);
  const max = Object.values(values).reduce((m, v) => (v > m ? v : m), 0);

  const weeks: (PixelDay | null)[][] = [];
  let week: (PixelDay | null)[] = [];
  let logged = 0;
  let rested = 0;
  let total = 0;

  for (let i = 0; i <= span; i++) {
    const date = addDays(first, i);
    if (date < from) {
      week.push(null);
    } else {
      const value = values[date] ?? 0;
      if (value > 0) logged++;
      if (rest.has(date)) rested++;
      total += value;
      week.push({ date, value, level: levelFor(value, max), rest: rest.has(date) });
    }
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  // The last week is padded so every column is seven tall — an uneven column
  // reads as a missing day rather than as a week that hasn't finished.
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return { from, to, weeks, max, logged, rested, total };
}

/** The month a column starts in, for the labels along the top. */
export function monthLabels(weeks: (PixelDay | null)[][]): (string | null)[] {
  let last = "";
  return weeks.map((week) => {
    const first = week.find((d) => d !== null);
    if (!first) return null;
    const month = first.date.slice(0, 7);
    if (month === last) return null;
    last = month;
    return month;
  });
}
