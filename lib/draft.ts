import { MAX_TRACKER_NOTE } from "./notes";
import { minutesBetween, orderPrayers, type Tracker, type TrackerType } from "./trackers";

/**
 * A nap: how long it lasted, and the clock time it began when that is
 * actually known — the timer knows, a nap typed in afterwards doesn't, and
 * inventing one would be a worse record than admitting the gap.
 */
export type Nap = { mins: number; at: string | null };

/** No day gets more than this many naps on it. */
export const MAX_NAPS = 12;

/**
 * What a day looks like while you're typing it.
 *
 * The daily log keeps everything as strings — a half-typed "1" in an hours box
 * isn't a number yet, and forcing it to be one is what makes inputs fight the
 * person using them. `draftToEntry` is the single place where this becomes
 * something the API will accept, so the full log and the quick log can't
 * disagree about what a value means.
 */
export type Draft = {
  h: string;
  m: string;
  num: string;
  start: string;
  end: string;
  quality: number | null;
  /** Sleep: daytime naps, added into the night's total. */
  naps: Nap[];
  checked: boolean;
  /** Namaz: which of the five prayers are ticked. */
  parts: string[];
  /** Clean-streak trackers: how the day went. */
  status: "clean" | "slip" | null;
  /** What was worth writing down about this tracker, today. */
  note: string;
};

export type EntryMeta = {
  start?: string | null;
  end?: string | null;
  quality?: number | null;
  naps?: Nap[] | null;
  parts?: string[] | null;
  status?: "clean" | "slip" | null;
} | null;

export type Entry = {
  trackerId: string;
  value: number;
  meta: EntryMeta;
  /** Absent on rows read from older caches, which simply had no note. */
  note?: string | null;
};

/** Stable empty default, so it doesn't look like a new value every render. */
export const EMPTY: Draft = {
  h: "",
  m: "",
  num: "",
  start: "",
  end: "",
  quality: null,
  naps: [],
  checked: false,
  parts: [],
  status: null,
  note: "",
};

export function toDraft(type: TrackerType, entry: Entry | undefined): Draft {
  if (!entry) return { ...EMPTY };
  // Whatever the kind, the note comes back with it — a save that dropped it
  // would quietly delete words nobody asked it to touch.
  const base: Draft = { ...EMPTY, note: entry.note ?? "" };
  if (type === "duration") {
    return {
      ...base,
      h: String(Math.floor(entry.value / 60) || ""),
      m: String(Math.round(entry.value % 60) || ""),
    };
  }
  if (type === "sleep") {
    return {
      ...base,
      start: entry.meta?.start ?? "",
      end: entry.meta?.end ?? "",
      quality: entry.meta?.quality ?? null,
      naps: entry.meta?.naps ?? [],
    };
  }
  if (type === "check") return { ...base, checked: entry.value > 0 };
  if (type === "prayer") {
    return { ...base, parts: orderPrayers(entry.meta?.parts ?? []) };
  }
  if (type === "streak") {
    // Older entries pre-date the status field; the value still says it.
    return {
      ...base,
      status: entry.meta?.status ?? (entry.value > 0 ? "clean" : "slip"),
    };
  }
  return { ...base, num: String(entry.value) };
}

/**
 * The note as it should be sent — trimmed, and null when there's nothing in
 * it. A note only rides along with something logged: the entry it hangs off
 * is deleted when the day's value is cleared, and a note with no day behind
 * it would be a row that no page knows how to show.
 */
export function draftNote(dr: Draft | undefined): string | null {
  const text = (dr?.note ?? "").trim();
  return text ? text.slice(0, MAX_TRACKER_NOTE) : null;
}

/**
 * A slip that hasn't said why yet.
 *
 * A clean-streak tracker is the one place in the app where a tap records a
 * failure, and "0" is the least useful thing you can know about one. Three
 * months later the run is a row of red squares with nothing to learn from;
 * with a line each — *tired*, *argument*, *3am*, *nothing, just did it* —
 * it is a list of the things that actually break you, which is the only
 * part of a slip worth keeping. So the reason box opens with the tap, takes
 * the caret, and is outlined until it has words in it.
 *
 * **It is an ask, and never a gate.** It was a gate for exactly one
 * afternoon: the server returned 400 for a note-less slip, the daily page
 * refused the whole day over one, and Catch up quietly declined to send the
 * tap at all. The owner went to backfill a month and the month did not go
 * in — no error, no clue, just days that wouldn't save. Which is the
 * opposite of the point: a slip you couldn't put words to is still a slip
 * that happened, and an app that refuses to record it teaches you to log
 * nothing rather than to log honestly. Same rule as rest days and notes —
 * nothing in this app may stand between a person and their own record.
 *
 * What this function is for now: the outline on the box, and the line on the
 * daily page listing what is still unexplained. Both ask. Neither blocks.
 */
export function slipNeedsReason(type: TrackerType, dr: Draft | undefined): boolean {
  return type === "streak" && dr?.status === "slip" && draftNote(dr) === null;
}

/** Every tracker on the day marked slipped with no reason written on it. */
export function slipsMissingReason(
  trackers: Tracker[],
  draft: Record<string, Draft>
): Tracker[] {
  return trackers.filter((t) =>
    slipNeedsReason(t.type as TrackerType, draft[t.id])
  );
}

/** How much of the day was napped away. */
export function napMinutes(naps: Nap[] | null | undefined): number {
  return (naps ?? []).reduce((s, n) => s + (Number(n?.mins) || 0), 0);
}

/** Turn what's typed into the value + meta the API stores. */
export function draftToEntry(type: TrackerType, dr: Draft) {
  if (type === "duration") {
    const value = (parseInt(dr.h, 10) || 0) * 60 + (parseInt(dr.m, 10) || 0);
    return { value, meta: null };
  }
  if (type === "sleep") {
    const night = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
    const naps = dr.naps ?? [];
    // Sleep is sleep: an afternoon hour on the sofa is an hour you slept,
    // so it lands in the same total the goal, the score and the day's 24
    // hours are all judged against. The times keep describing the *night*
    // — the clock chart draws bedtimes, and a nap is not one.
    const value = night + napMinutes(naps);
    const meta =
      dr.start || dr.end || dr.quality || naps.length > 0
        ? {
            start: dr.start || null,
            end: dr.end || null,
            quality: dr.quality,
            naps: naps.length > 0 ? naps : null,
          }
        : null;
    return { value, meta };
  }
  if (type === "check") return { value: dr.checked ? 1 : 0, meta: null };
  if (type === "prayer") {
    const parts = orderPrayers(dr.parts);
    return {
      value: parts.length,
      meta: parts.length > 0 ? { parts } : null,
    };
  }
  if (type === "streak") {
    if (dr.status === "clean") return { value: 1, meta: { status: "clean" } };
    // A slip is value 0 *with* meta, so it's stored rather than cleared —
    // that's what keeps it distinct from a day you never filled in.
    if (dr.status === "slip") return { value: 0, meta: { status: "slip" } };
    return { value: 0, meta: null };
  }
  const n = parseFloat(dr.num);
  return { value: Number.isFinite(n) && n > 0 ? n : 0, meta: null };
}

/** Has this tracker actually been filled in for the day? */
export function isLogged(type: TrackerType, dr: Draft): boolean {
  const { value, meta } = draftToEntry(type, dr);
  return value > 0 || meta !== null;
}

export function buildDraft(
  trackers: Tracker[],
  rows: Entry[]
): Record<string, Draft> {
  const byId = new Map(rows.map((r) => [r.trackerId, r]));
  const next: Record<string, Draft> = {};
  for (const t of trackers) {
    next[t.id] = toDraft(t.type as TrackerType, byId.get(t.id));
  }
  return next;
}

/** Keep only digits, capped at `max` of them — for the numeric boxes. */
export function digits(raw: string, max: number): string {
  return raw.replace(/[^0-9]/g, "").slice(0, max);
}

/** Minutes in a day — the hard ceiling on a day's time log. */
export const DAY_MINUTES = 24 * 60;

/** One tracker's share of the day, for the 24-hour dial. */
export type TimeSlice = {
  id: string;
  name: string;
  color: string;
  minutes: number;
};

/**
 * The day broken into its time-measured parts, in the order the trackers are
 * kept — what the dial on the daily log draws.
 *
 * Only trackers counted in minutes appear, and only once they have minutes in
 * them: an empty row is not a slice of nothing, it is simply not part of the
 * day yet. Everything not covered by these is the gap the dial leaves open,
 * which is the number the whole thing exists to show.
 */
export function timeSlices(
  trackers: Tracker[],
  draft: Record<string, Draft>
): TimeSlice[] {
  return trackers
    .filter((t) => t.type === "duration" || t.type === "sleep")
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      minutes: draftToEntry(t.type as TrackerType, draft[t.id] ?? EMPTY).value,
    }))
    .filter((slice) => slice.minutes > 0);
}

/**
 * The day's time-measured total: everything counted in minutes — time spent
 * and sleep — added up. This is the number that strictly cannot pass 24
 * hours; the server refuses a day that does, and the page refuses to send
 * one.
 */
export function dayTimeTotal(
  trackers: Tracker[],
  draft: Record<string, Draft>
): number {
  return trackers
    .filter((t) => t.type === "duration" || t.type === "sleep")
    .reduce(
      (s, t) =>
        s + draftToEntry(t.type as TrackerType, draft[t.id] ?? EMPTY).value,
      0
    );
}
