/**
 * The numbers worth stopping to notice.
 *
 * A streak is motivating exactly when its length is made visible at the
 * right moment — crossing 30 days and hearing nothing wastes the crossing.
 */

export const MILESTONES = [7, 30, 100, 365] as const;

/** The highest milestone at or below `n`, or null before the first one. */
export function reached(n: number): number | null {
  let hit: number | null = null;
  for (const m of MILESTONES) if (n >= m) hit = m;
  return hit;
}

/**
 * The milestone crossed within the last `window` days of a run — what the
 * weekly digest congratulates. A 34-day streak crossed 30 this week; a
 * 45-day one did not.
 */
export function crossedRecently(current: number, window = 7): number | null {
  for (const m of [...MILESTONES].reverse()) {
    if (current >= m && current - window < m) return m;
  }
  return null;
}
