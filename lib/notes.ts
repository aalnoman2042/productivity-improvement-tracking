/**
 * The written half of a day.
 *
 * Numbers say what happened; they never say why. A day with four hours of
 * study and a slipped streak reads the same in the charts whether the reason
 * was a migraine or a party — so the log takes words too: one note for the
 * day as a whole, and one per tracker for the detail that belongs to it
 * ("finished chapter 4", "woke twice").
 *
 * Two caps, because they are different kinds of writing: a tracker note is a
 * margin scribble, the day's note is a diary line. Both are trimmed and
 * emptiness becomes null, so "cleared it" and "never wrote one" are the same
 * thing in the database rather than two.
 */

/** A note hung off one tracker's entry — matches the `entries` validator. */
export const MAX_TRACKER_NOTE = 300;

/** The day's own note. Long enough for a paragraph, short of an essay. */
export const MAX_DAY_NOTE = 2000;

export function cleanNote(raw: unknown, max = MAX_TRACKER_NOTE): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().slice(0, max);
  return text ? text : null;
}
