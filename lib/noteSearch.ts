/**
 * Finding what you wrote.
 *
 * Notes arrived attached to days, which is the right place to write them and
 * the wrong place to look for them: the only way back to "the week I kept
 * waking up at 3" was to remember roughly when it was and tap around the
 * calendar. A note you cannot find again is a note you did not keep.
 *
 * The matching itself is deliberately dumb — a case-insensitive substring,
 * the thing everyone expects a search box to do. No stemming, no ranking by
 * cleverness: these are one person's diary lines, and recency is a better
 * order than relevance when the corpus is your own year.
 */

/** The shortest query worth running. One letter matches everything. */
export const MIN_QUERY = 2;

/** Long enough for a sentence someone half-remembers. */
export const MAX_QUERY = 80;

/**
 * A user's query, made safe to put inside a RegExp. Every character that
 * means something to the engine is escaped, so a search for "5:30" or
 * "why(?)" is a search for those characters and never a pattern — or, worse,
 * a pattern that runs for ever.
 */
export function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trim and bound an incoming query; null means "don't search for that". */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().slice(0, MAX_QUERY);
  return q.length >= MIN_QUERY ? q : null;
}

export type NoteHit = {
  date: string;
  /** The tracker it was written against, or null for the day's own note. */
  tracker: string | null;
  text: string;
};

/**
 * The part of a note worth showing in a list of results: the match, with
 * enough either side to read it, and ellipses where something was cut. A
 * 2000-character day note otherwise buries its own answer.
 */
export function snippet(text: string, query: string, radius = 70): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || text.length <= radius * 2) return text;

  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  // Cut at a space where there is one nearby, so the excerpt doesn't start
  // mid-word for the sake of exactly seventy characters.
  const from = start === 0 ? 0 : text.indexOf(" ", start) + 1 || start;
  const to = end === text.length ? end : text.lastIndexOf(" ", end) + 1 || end;

  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/**
 * Newest first, and within one day the day's own note leads — it is about
 * the day, where the tracker notes are about one row of it.
 */
export function sortHits(hits: NoteHit[]): NoteHit[] {
  return [...hits].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if ((a.tracker === null) !== (b.tracker === null)) return a.tracker === null ? -1 : 1;
    return (a.tracker ?? "").localeCompare(b.tracker ?? "");
  });
}
