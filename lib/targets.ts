import { addDays, daysBetween } from "./dates";

/**
 * "70 kg by December." "Twenty books this year." "A hundred hours of Arabic
 * before the exam."
 *
 * A goal in this app has always been a *daily* question — 2 hours today, 8
 * glasses today, under one coffee today. It is the right shape for a habit
 * and the wrong shape for an ambition: nothing here could hold a number you
 * are walking towards, or say whether you will arrive.
 *
 * So a target is the other kind of number, and it comes in exactly two
 * shapes, because everything anybody wants to reach is one of them:
 *
 * - **`total`** — add it up. Pages read, hours studied, kilometres run.
 *   Progress is the sum since the target was set.
 * - **`level`** — get *to* it. Weight, a resting pulse, a lift. Progress is
 *   the latest reading, and the direction is decided by where you started,
 *   not by a setting: someone at 80 aiming for 70 is going down, and it
 *   would be absurd to ask them to say so.
 *
 * The arithmetic is deliberately the same arithmetic as `readingPace` in
 * `lib/books` — days elapsed, rate so far, a date at that rate — because
 * this app already told somebody when they would finish a book, and two
 * different answers to "when will I get there?" is one too many.
 *
 * **It never flatters.** With no movement there is no projection, and the
 * card says so rather than printing a date it cannot support.
 */

export type TargetKind = "total" | "level";

export type Target = {
  kind: TargetKind;
  /** The number being walked towards. */
  value: number;
  /** The day it should be reached by, "YYYY-MM-DD". */
  by: string;
  /** When the count started. Null means "from the first day on record". */
  from: string | null;
};

export type TargetPoint = { date: string; value: number };

export type TargetProgress = {
  kind: TargetKind;
  target: number;
  by: string;
  /** Where the count started, once the data has said. */
  from: string | null;
  /** How it stands right now: the running total, or the latest reading. */
  current: number;
  /** For a `level` target, the reading it started from. */
  start: number | null;
  /** What is still between here and the target. Never negative. */
  remaining: number;
  /** Days from today to the deadline; negative once it has passed. */
  daysLeft: number;
  /** Reached it — for a level, from whichever side it started on. */
  done: boolean;
  /** The deadline has passed. */
  over: boolean;
  /** Progress 0–100 for a bar. */
  pct: number;
  /** Movement per day so far. Null when there isn't enough to say. */
  pace: number | null;
  /** What each remaining day needs to carry. Null when the day has passed. */
  needPerDay: number | null;
  /** The day it lands on at the current pace. Null when nothing is moving. */
  projected: string | null;
  /** Whether that projection beats the deadline. Null when there isn't one. */
  onTrack: boolean | null;
};

/** A target as it stands today, from the values on record. */
export function targetProgress(
  target: Target,
  points: TargetPoint[],
  today: string
): TargetProgress {
  const inWindow = points
    .filter((p) => p.date <= today && (!target.from || p.date >= target.from))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const from = target.from ?? inWindow[0]?.date ?? null;
  // The first day counts as a day — the same rule `readingPace` uses, and
  // the reason a target set this morning doesn't divide by zero.
  const elapsed = from ? Math.max(1, daysBetween(from, today) + 1) : 0;
  const daysLeft = daysBetween(today, target.by);
  const over = daysLeft < 0;

  const totals = inWindow.reduce((sum, p) => sum + p.value, 0);
  const latest = inWindow.length > 0 ? inWindow[inWindow.length - 1].value : null;
  const start = inWindow.length > 0 ? inWindow[0].value : null;

  if (target.kind === "total") {
    const current = totals;
    const remaining = Math.max(0, target.value - current);
    const done = current >= target.value;
    const pace = elapsed > 0 && current > 0 ? current / elapsed : null;
    const left = Math.max(0, daysLeft) + (over ? 0 : 1);

    return {
      kind: "total",
      target: target.value,
      by: target.by,
      from,
      current,
      start: null,
      remaining,
      daysLeft,
      done,
      over,
      pct: clampPct(target.value === 0 ? 1 : current / target.value),
      pace,
      needPerDay: done || over || left <= 0 ? null : remaining / left,
      projected: pace && !done ? addDays(today, Math.ceil(remaining / pace)) : null,
      onTrack:
        done ? true : pace ? addDays(today, Math.ceil(remaining / pace)) <= target.by : null,
    };
  }

  /* ------------------------------- a level ------------------------------ */
  // Which way is up is a fact about the data, not a setting: whoever starts
  // at 80 with 70 in mind is going down, and being asked to declare that
  // would be a form asking a question it can already answer.
  const current = latest ?? 0;
  const falling = start !== null ? target.value < start : target.value < current;
  const done =
    latest === null ? false : falling ? current <= target.value : current >= target.value;
  const remaining = Math.abs(target.value - current);
  const moved = start === null ? 0 : current - start;
  // Movement counts only if it is towards the target; drifting the wrong way
  // has no honest arrival date at all.
  const towards = falling ? -moved : moved;
  const pace = start !== null && elapsed > 1 && towards > 0 ? towards / elapsed : null;
  const distance = start === null ? 0 : Math.abs(target.value - start);
  const projected = pace && !done ? addDays(today, Math.ceil(remaining / pace)) : null;

  return {
    kind: "level",
    target: target.value,
    by: target.by,
    from,
    current,
    start,
    remaining,
    daysLeft,
    done,
    over,
    pct: clampPct(distance === 0 ? (done ? 1 : 0) : Math.max(0, towards) / distance),
    pace,
    needPerDay: done || over || daysLeft <= 0 ? null : remaining / daysLeft,
    projected,
    onTrack: done ? true : projected ? projected <= target.by : null,
  };
}

function clampPct(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

/** Validate an incoming target; null means "no target", never a guess. */
export function parseTarget(raw: unknown): Target | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const value = Number(t.value);
  const by = typeof t.by === "string" ? t.by : "";
  if (!Number.isFinite(value) || value < 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(by)) return null;
  const from =
    typeof t.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.from) ? t.from : null;
  return { kind: t.kind === "level" ? "level" : "total", value, by, from };
}
