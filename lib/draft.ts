import { minutesBetween, orderPrayers, type Tracker, type TrackerType } from "./trackers";

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
  checked: boolean;
  /** Namaz: which of the five prayers are ticked. */
  parts: string[];
  /** Clean-streak trackers: how the day went. */
  status: "clean" | "slip" | null;
};

export type EntryMeta = {
  start?: string | null;
  end?: string | null;
  quality?: number | null;
  parts?: string[] | null;
  status?: "clean" | "slip" | null;
} | null;

export type Entry = {
  trackerId: string;
  value: number;
  meta: EntryMeta;
};

/** Stable empty default, so it doesn't look like a new value every render. */
export const EMPTY: Draft = {
  h: "",
  m: "",
  num: "",
  start: "",
  end: "",
  quality: null,
  checked: false,
  parts: [],
  status: null,
};

export function toDraft(type: TrackerType, entry: Entry | undefined): Draft {
  if (!entry) return { ...EMPTY };
  if (type === "duration") {
    return {
      ...EMPTY,
      h: String(Math.floor(entry.value / 60) || ""),
      m: String(Math.round(entry.value % 60) || ""),
    };
  }
  if (type === "sleep") {
    return {
      ...EMPTY,
      start: entry.meta?.start ?? "",
      end: entry.meta?.end ?? "",
      quality: entry.meta?.quality ?? null,
    };
  }
  if (type === "check") return { ...EMPTY, checked: entry.value > 0 };
  if (type === "prayer") {
    return { ...EMPTY, parts: orderPrayers(entry.meta?.parts ?? []) };
  }
  if (type === "streak") {
    // Older entries pre-date the status field; the value still says it.
    return {
      ...EMPTY,
      status: entry.meta?.status ?? (entry.value > 0 ? "clean" : "slip"),
    };
  }
  return { ...EMPTY, num: String(entry.value) };
}

/** Turn what's typed into the value + meta the API stores. */
export function draftToEntry(type: TrackerType, dr: Draft) {
  if (type === "duration") {
    const value = (parseInt(dr.h, 10) || 0) * 60 + (parseInt(dr.m, 10) || 0);
    return { value, meta: null };
  }
  if (type === "sleep") {
    const value = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
    const meta =
      dr.start || dr.end || dr.quality
        ? { start: dr.start || null, end: dr.end || null, quality: dr.quality }
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
