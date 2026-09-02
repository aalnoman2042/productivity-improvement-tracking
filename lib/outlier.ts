import { formatValue, type Tracker, type TrackerType } from "./trackers";
import type { RecentEntry } from "./prefill";

/**
 * "That isn't your usual day — did you mean it?"
 *
 * A mistyped number is the most expensive thing that can happen to this
 * record and the only one the app can never notice afterwards. 14h of study
 * instead of 1h 40m is a legal value on a legal day: from the moment it is
 * saved it sits inside every average, every grade, every correlation and
 * everything the coach is shown, and nothing downstream can tell it from a
 * real afternoon. There is no later moment when it becomes findable.
 *
 * So it is caught at the one moment somebody still knows the answer — while
 * they are looking at what they just typed — and it is caught as a QUESTION.
 * Rule 2b holds: this refuses no save, blocks no field, clears no value and
 * is never required. A genuinely enormous day is dismissed with one tap and
 * stays enormous.
 */

/**
 * Times the usual day before a number is worth a second look.
 *
 * Four, not three. The mistake this is looking for is a slipped decimal
 * point or a unit confusion — an order of magnitude, not a good afternoon.
 * At three the warning would appear on every genuinely strong day and become
 * furniture within a week, and a warning nobody reads is worse than no
 * warning at all, because it makes the next one invisible too.
 */
export const USUAL_FACTOR = 4;

/**
 * ...and, for the kinds that really do have big days, times the best day in
 * the window as well. Both tests have to agree. If last week already
 * contains a nine-hour Saturday, a second nine-hour Saturday is not news.
 */
export const PEAK_FACTOR = 2.5;

/** Logged days needed before "usual" is a word this can honestly use. */
export const MIN_HISTORY = 4;

export type Baseline = {
  /** Median of the logged days in the window — one huge day can't move it. */
  usual: number;
  /** The largest of them. */
  best: number;
  /** How many days it was drawn from. */
  days: number;
};

export type OddValue = {
  direction: "high" | "low";
  /** The usual day, already formatted for reading. */
  usual: string;
  /** How far out it is, rounded — the 8 in "8× your usual". */
  times: number;
};

/**
 * The kinds where a free-typed number goes straight into the record.
 *
 * Sleep is deliberately absent: its value is two clock times plus the naps,
 * and the strict 24-hour day cap already refuses the impossible ones — which
 * is the check that belongs there. Everything else here is bounded by its
 * own definition (a check is 0 or 1, a scale is 1–5, prayer is 0–5) and
 * cannot be mistyped into a wrong magnitude at all.
 */
const WATCHED: TrackerType[] = ["duration", "count", "measure"];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What each tracker's ordinary day looks like, from the same rows the
 * prefills are built out of — so this costs no request of its own.
 */
export function buildBaselines(
  trackers: Tracker[],
  rows: RecentEntry[]
): Record<string, Baseline> {
  const byTracker = new Map<string, number[]>();
  for (const r of rows) {
    // A zero is a day that happened, not a level this tracker sits at;
    // counting them would drag every "usual" towards nothing and start
    // questioning ordinary days.
    if (!(r.value > 0)) continue;
    const list = byTracker.get(r.trackerId);
    if (list) list.push(r.value);
    else byTracker.set(r.trackerId, [r.value]);
  }

  const out: Record<string, Baseline> = {};
  for (const t of trackers) {
    if (!WATCHED.includes(t.type as TrackerType)) continue;
    const values = byTracker.get(t.id);
    if (!values || values.length < MIN_HISTORY) continue;
    out[t.id] = {
      usual: median(values),
      best: Math.max(...values),
      days: values.length,
    };
  }
  return out;
}

/** Is this value worth asking about? Null means "it's an ordinary number". */
export function oddValue(
  tracker: Tracker,
  value: number,
  base: Baseline | undefined
): OddValue | null {
  const type = tracker.type as TrackerType;
  if (!WATCHED.includes(type)) return null;
  if (!base || base.days < MIN_HISTORY || base.usual <= 0) return null;
  if (!Number.isFinite(value) || value <= 0) return null;

  const usual = formatValue(base.usual, type, tracker.unit);

  if (type === "measure") {
    // A measurement is the one kind where too *small* is as wrong as too
    // large — 7.5 kg and 750 kg are the same slipped decimal — and the one
    // kind with almost no spread, so the peak test would never fire on it: a
    // weight's best week is a few percent from its usual. Judged on the
    // usual alone, in both directions.
    if (value >= base.usual * USUAL_FACTOR) {
      return { direction: "high", usual, times: Math.round(value / base.usual) };
    }
    if (value * USUAL_FACTOR <= base.usual) {
      return { direction: "low", usual, times: Math.round(base.usual / value) };
    }
    return null;
  }

  if (value >= base.usual * USUAL_FACTOR && value >= base.best * PEAK_FACTOR) {
    return { direction: "high", usual, times: Math.round(value / base.usual) };
  }
  return null;
}
