/**
 * A line to read while something loads.
 *
 * The awkward part is timing. A skeleton is on screen for a few hundred
 * milliseconds; a round trip to a quote API takes longer than that, so a line
 * fetched *when* the spinner appears arrives after the spinner has gone. So
 * nothing is ever fetched on the critical path: the client keeps a small pool
 * in `localStorage`, shows one instantly, and tops the pool up afterwards.
 *
 * The bundled lines below are the floor. They're always there — first run,
 * offline, or every external source down at once — and they're about *this*
 * app rather than generic inspiration, which is the only reason a line under
 * a spinner earns its place at all.
 */

export type Line = { text: string; author: string | null };

/** Always available, no network involved. Kept short enough to read in a glance. */
export const BUNDLED: Line[] = [
  { text: "The day you don't feel like logging is the day worth logging.", author: null },
  { text: "A month of honest data beats a year of good intentions.", author: null },
  { text: "You can't improve what you never wrote down.", author: null },
  { text: "Small numbers, repeated, become large ones.", author: null },
  { text: "The streak doesn't care how you feel about it today.", author: null },
  { text: "Going to bed on time is a decision you make at 11pm, not at 1am.", author: null },
  { text: "Missing one day is an accident. Missing two is a new habit.", author: null },
  { text: "Track the boring days — they're the ones that hold the pattern.", author: null },
  { text: "Progress is mostly the days nobody would have noticed.", author: null },
  { text: "Discipline is remembering what you actually want.", author: null },
  { text: "You are what you do on the days you'd rather not.", author: null },
  { text: "An hour reclaimed from the phone is an hour, every time.", author: null },
  { text: "The best time to start was last month. The second best is tonight.", author: null },
  { text: "Consistency is not intensity. It's just showing up again.", author: null },
  { text: "Don't break the chain.", author: null },
];

/** Where the fresher lines come from. All free, none needing a key. */
export const SOURCES = [
  "zenquotes",
  "dummyjson",
  "affirmations",
  "stoic",
] as const;

export type Source = (typeof SOURCES)[number];

const MAX_LEN = 150;

/** Trim, collapse whitespace, and reject anything that wouldn't read well. */
export function clean(text: unknown, author: unknown): Line | null {
  if (typeof text !== "string") return null;
  const t = text
    .replace(/\s+/g, " ")
    .replace(/^["“”'']+|["“”'']+$/g, "")
    .trim();
  // Too long to read under a spinner, or too short to be worth reading.
  if (t.length < 12 || t.length > MAX_LEN) return null;
  const a = typeof author === "string" ? author.replace(/\s+/g, " ").trim() : "";
  return { text: t, author: a && a.toLowerCase() !== "unknown" ? a : null };
}

/** One line at random, never the same one twice in a row if we can help it. */
export function pick(pool: Line[], avoid?: string | null): Line {
  const source = pool.length > 0 ? pool : BUNDLED;
  if (source.length === 1) return source[0];
  const options = avoid ? source.filter((l) => l.text !== avoid) : source;
  const from = options.length > 0 ? options : source;
  return from[Math.floor(Math.random() * from.length)];
}
