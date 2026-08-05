import { addDays, daysBetween } from "./dates";
import type { StreakInfo } from "./stats";

/**
 * Clean-streak trackers count days since the last slip, not consecutive
 * check-ins — a day you simply didn't open the app shouldn't reset a
 * three-month run.
 *
 * Lives here rather than in the stats route so the digest, the tracker
 * detail page and the tests all share one definition of "how long is the
 * streak" — three copies of this arithmetic would drift.
 */
export function streakInfo(
  first: string | null,
  slipDates: string[],
  today: string
): StreakInfo {
  if (!first) {
    return { current: 0, best: 0, slips: 0, lastSlip: null, since: null };
  }

  const slips = [...new Set(slipDates)].filter((d) => d <= today).sort();
  // The day before the first entry: every run is measured from a boundary,
  // and this is the boundary the first run starts from.
  const boundaries = [addDays(first, -1), ...slips];

  let best = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    best = Math.max(best, daysBetween(boundaries[i], boundaries[i + 1]) - 1);
  }

  const last = boundaries[boundaries.length - 1];
  const current = Math.max(0, daysBetween(last, today));

  return {
    current,
    best: Math.max(best, current),
    slips: slips.length,
    lastSlip: slips.length > 0 ? slips[slips.length - 1] : null,
    since: first,
  };
}
