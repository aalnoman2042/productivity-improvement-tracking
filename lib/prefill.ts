import { nightLabel, nightToClock, toNight } from "./clock";
import type { Draft } from "./draft";
import { formatValue, type Tracker, type TrackerType } from "./trackers";

/**
 * Suggested answers for today, worked out from the last week.
 *
 * Typing is the painful half of logging — taps are fine. Most days repeat
 * yesterday closely, so each typed input gets a one-tap suggestion: the most
 * recent value for durations, counts and measures, and the *usual* bed and
 * wake times for sleep (averaged over up to seven nights, so one odd night
 * doesn't become the suggestion).
 *
 * A prefill is only an offer — it's shown while the row is still empty and a
 * tap writes it through the same `set` as any keystroke, so autosave, undo
 * and the offline queue treat it like typing, only faster.
 */

export type Prefill = {
  /** What accepting the offer writes into the draft. */
  patch: Partial<Draft>;
  /** What the chip says — "was 7h 30m", "usually 11:30 pm → 7:00 am". */
  label: string;
};

/** A row from /api/entries/recent. */
export type RecentEntry = {
  trackerId: string;
  date: string;
  value: number;
  meta: { start?: string | null; end?: string | null } | null;
};

/** A night-axis average back to the "HH:MM" a time input wants. */
function nightToInput(v: number): string {
  const abs = nightToClock(v);
  return `${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(
    abs % 60
  ).padStart(2, "0")}`;
}

export function buildPrefills(
  trackers: Tracker[],
  rows: RecentEntry[]
): Record<string, Prefill> {
  // Newest first, so "the most recent value" is a find(), not a sort per
  // tracker.
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
  const byTracker = new Map<string, RecentEntry[]>();
  for (const r of sorted) {
    const list = byTracker.get(r.trackerId);
    if (list) list.push(r);
    else byTracker.set(r.trackerId, [r]);
  }

  const out: Record<string, Prefill> = {};
  for (const t of trackers) {
    const recent = byTracker.get(t.id) ?? [];
    const type = t.type as TrackerType;

    if (type === "duration" || type === "count" || type === "measure") {
      const last = recent.find((r) => r.value > 0);
      if (!last) continue;
      const patch: Partial<Draft> =
        type === "duration"
          ? {
              h: String(Math.floor(last.value / 60) || ""),
              m: String(Math.round(last.value % 60) || ""),
            }
          : { num: String(last.value) };
      out[t.id] = { patch, label: `was ${formatValue(last.value, type, t.unit)}` };
      continue;
    }

    if (type === "sleep") {
      // Average on the night axis, where 11:40 pm and 0:20 am are forty
      // minutes apart — a midnight-based average would land at lunchtime.
      const nights = recent
        .map((r) => ({
          bed: toNight(r.meta?.start),
          wake: toNight(r.meta?.end),
        }))
        .filter((n): n is { bed: number; wake: number } =>
          n.bed !== null && n.wake !== null
        )
        .slice(0, 7);
      if (nights.length === 0) continue;
      const bed = nights.reduce((s, n) => s + n.bed, 0) / nights.length;
      const wake = nights.reduce((s, n) => s + n.wake, 0) / nights.length;
      out[t.id] = {
        patch: { start: nightToInput(bed), end: nightToInput(wake) },
        label: `usually ${nightLabel(bed)} → ${nightLabel(wake)}`,
      };
    }

    // check, streak, scale, prayer: already one tap — nothing to shortcut.
  }
  return out;
}
