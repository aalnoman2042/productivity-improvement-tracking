/**
 * The five daily prayers.
 *
 * Kept in its own leaf module — with no imports of its own — so the entries
 * API can validate a namaz entry without pulling in the whole tracker model.
 */

export const PRAYERS = [
  { key: "fajr", label: "Fajr" },
  { key: "dhuhr", label: "Dhuhr" },
  { key: "asr", label: "Asr" },
  { key: "maghrib", label: "Maghrib" },
  { key: "isha", label: "Isha" },
] as const;

export const PRAYER_KEYS: readonly string[] = PRAYERS.map((p) => p.key);

/** "fajr" | "dhuhr" | … — the five, as a type rather than five strings. */
export type PrayerKey = (typeof PRAYERS)[number]["key"];

/** Sort a set of prayer keys back into the order they're prayed in. */
export function orderPrayers(keys: string[]): string[] {
  const set = new Set(keys);
  return PRAYER_KEYS.filter((k) => set.has(k));
}
