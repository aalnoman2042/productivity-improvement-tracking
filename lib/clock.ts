/**
 * Clock-time maths for sleep.
 *
 * Bedtime is the awkward one. 23:40 and 00:20 are forty minutes apart, but on
 * a midnight-based clock they're 1,400 minutes apart — average them and you
 * land at lunchtime. So every time here is measured on the **night axis**:
 * minutes since 18:00, wrapping once. An evening bedtime and the morning that
 * follows it come out in order (23:00 → 300, 07:00 → 780), which is what makes
 * an average, a range bar and a "later than last week" comparison mean
 * anything.
 */

const DAY = 24 * 60;

/** Where the night axis starts — 18:00, late enough that no bedtime precedes it. */
export const NIGHT_ORIGIN = 18 * 60;

/** Minutes past midnight for "HH:MM", or null if it isn't one. */
export function clockToMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** "HH:MM" onto the night axis — 23:00 → 300, 00:30 → 390, 07:00 → 780. */
export function toNight(value: unknown): number | null {
  const m = clockToMinutes(value);
  return m === null ? null : (((m - NIGHT_ORIGIN) % DAY) + DAY) % DAY;
}

/** A night-axis value back to minutes past midnight. */
export function nightToClock(v: number): number {
  return (((Math.round(v) + NIGHT_ORIGIN) % DAY) + DAY) % DAY;
}

/** "11:40 pm" — deterministic, so the server and the client agree. */
export function nightLabel(v: number): string {
  const abs = nightToClock(v);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The same thing for an axis tick, where "11 pm" is enough. */
export function nightTick(v: number): string {
  const abs = nightToClock(v);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "am" : "pm";
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * "22 min earlier" — how `now` compares with `before` on the night axis, from
 * the point of view of someone trying to get to bed sooner.
 */
export function shiftLabel(now: number, before: number): string | null {
  const delta = Math.round(now - before);
  if (Math.abs(delta) < 5) return "about the same";
  const mins = Math.abs(delta);
  const text =
    mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? `${mins % 60}m` : ""}`.trim()
      : `${mins} min`;
  return `${text} ${delta < 0 ? "earlier" : "later"}`;
}

/** Hour-aligned ticks covering a night-axis range, at most `max` of them. */
export function nightTicks(min: number, max: number, target = 6): number[] {
  const span = Math.max(60, max - min);
  const stepHours = [1, 2, 3, 4, 6, 8, 12].find(
    (h) => span / (h * 60) <= target
  ) ?? 12;
  const step = stepHours * 60;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max; v += step) ticks.push(v);
  return ticks;
}
