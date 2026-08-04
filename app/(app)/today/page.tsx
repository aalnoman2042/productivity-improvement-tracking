"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DeleteDays from "@/components/DeleteDays";
import Timer from "@/components/Timer";
import { cacheSet, getCached, post, type PostResult } from "@/lib/sync";
import { useCached, useStored } from "@/lib/useCached";
import { addDays, isValidDateStr, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import {
  PRAYERS,
  PRAYER_KEYS,
  categoryMeta,
  formatValue,
  minutesBetween,
  orderCategories,
  orderPrayers,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

type Draft = {
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

type EntryMeta = {
  start?: string | null;
  end?: string | null;
  quality?: number | null;
  parts?: string[] | null;
  status?: "clean" | "slip" | null;
} | null;

type Entry = {
  trackerId: string;
  value: number;
  meta: EntryMeta;
};

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

/** How long after you stop typing the day is saved for you. */
const AUTOSAVE_MS = 900;

const CLOSED_KEY = "closed-sections";

/** Stable empty default, so it doesn't look like a new value every render. */
const NONE_CLOSED: string[] = [];

const EMPTY: Draft = {
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

function toDraft(type: TrackerType, entry: Entry | undefined): Draft {
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
function draftToEntry(type: TrackerType, dr: Draft) {
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
function isLogged(type: TrackerType, dr: Draft): boolean {
  const { value, meta } = draftToEntry(type, dr);
  return value > 0 || meta !== null;
}

function buildDraft(trackers: Tracker[], rows: Entry[]): Record<string, Draft> {
  const byId = new Map(rows.map((r) => [r.trackerId, r]));
  const next: Record<string, Draft> = {};
  for (const t of trackers) {
    next[t.id] = toDraft(t.type as TrackerType, byId.get(t.id));
  }
  return next;
}

/** Send a whole day, and keep the offline copy in step. */
async function persist(
  date: string,
  trackers: Tracker[],
  draft: Record<string, Draft>
): Promise<PostResult> {
  const entries = trackers.map((t) => ({
    trackerId: t.id,
    ...draftToEntry(t.type as TrackerType, draft[t.id] ?? EMPTY),
  }));
  const result = await post("/api/entries", { date, entries });
  cacheSet(
    `entries:${date}`,
    entries
      .filter((e) => e.value > 0 || e.meta)
      .map((e) => ({ ...e, note: null }))
  );
  return result;
}

const inputCls =
  "rounded-md border border-edge bg-transparent px-2 py-1.5 text-right outline-none focus:border-accent";

const chipCls = (on: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
    on
      ? "border-accent bg-accent text-white"
      : "border-edge text-secondary hover:bg-surface-2"
  }`;

export default function TodayPage() {
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [closed, setClosed] = useStored<string[]>(CLOSED_KEY, NONE_CLOSED);

  const today = toDateStr(new Date());

  const trackersQ = useCached<Tracker[]>("/api/trackers", "trackers");
  const entriesQ = useCached<Entry[]>(`/api/entries?date=${date}`, `entries:${date}`);

  const trackers = useMemo(
    () => (trackersQ.data ?? []).filter((t) => !t.archived),
    [trackersQ.data]
  );

  /* --------------------------- saving as you go -------------------------- */

  // Kept in a ref so the save that fires on a timer, or as you leave the page,
  // always sends what's on screen right now rather than a stale copy.
  const latest = useRef({ date, trackers, draft });
  useEffect(() => {
    latest.current = { date, trackers, draft };
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const scheduleRef = useRef<() => void>(() => {});

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current || savingRef.current) return;
    const { date: d, trackers: ts, draft: dr } = latest.current;
    if (ts.length === 0) return;

    dirtyRef.current = false;
    savingRef.current = true;
    setState("saving");
    try {
      const result = await persist(d, ts, dr);
      setState(result === "queued" ? "queued" : "saved");
      setError("");
    } catch (err) {
      dirtyRef.current = true; // it never landed — try again on the next edit
      setState("error");
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      savingRef.current = false;
      // Anything typed while that request was in the air still needs sending.
      if (dirtyRef.current) scheduleRef.current();
    }
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, AUTOSAVE_MS);
  }, [saveNow]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  // Closing the tab, switching apps or locking the phone shouldn't lose the
  // second and a half between the last keystroke and the autosave.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void saveNow();
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [saveNow]);

  /* ----------------------------- loading a day --------------------------- */

  // `?date=YYYY-MM-DD` opens straight on that day — it's how the nightly
  // reminder lands you on the day it's nagging about. Applied after mount
  // so the server and the first client render still agree.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("date");
    if (isValidDateStr(asked) && asked <= toDateStr(new Date())) setDate(asked);
  }, []);

  const appliedRef = useRef<Entry[] | null>(null);

  useEffect(() => {
    const rows = entriesQ.data;
    if (trackersQ.data === null) return;
    if (dirtyRef.current || savingRef.current) return; // don't stomp on edits
    if (rows === null) {
      // A day with nothing cached yet: empty boxes, not the last day's.
      if (appliedRef.current !== null) {
        appliedRef.current = null;
        setDraft({});
      }
      return;
    }
    if (appliedRef.current === rows) return;
    appliedRef.current = rows;
    setDraft(buildDraft(trackers, rows));
  }, [trackers, trackersQ.data, entriesQ.data]);

  function set(id: string, patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));
    dirtyRef.current = true;
    setState("idle");
    schedule();
  }

  function digits(raw: string, max: number) {
    return raw.replace(/[^0-9]/g, "").slice(0, max);
  }

  function changeDate(next: string) {
    void saveNow(); // reads the day being left out of the ref, before it moves
    setDraft({});
    setState("idle");
    setError("");
    appliedRef.current = null;
    dirtyRef.current = false;
    setDate(next);
  }

  async function copyYesterday() {
    const prev = addDays(date, -1);
    const { data } = await getCached<Entry[]>(
      `/api/entries?date=${prev}`,
      `entries:${prev}`
    );
    if (!data || data.length === 0) {
      setError("Nothing logged yesterday to copy");
      return;
    }
    setDraft(buildDraft(trackers, data));
    setError("");
    dirtyRef.current = true;
    setState("idle");
    schedule();
  }

  function toggleSection(value: string) {
    setClosed(
      closed.includes(value)
        ? closed.filter((v) => v !== value)
        : [...closed, value]
    );
  }

  /* ------------------------------- grouping ------------------------------ */

  const grouped = useMemo(
    () =>
      orderCategories(trackers.map((t) => t.category))
        .map((value) => ({
          value,
          ...categoryMeta(value),
          items: trackers.filter(
            (t) => t.category.toLowerCase() === value.toLowerCase()
          ),
        }))
        .filter((g) => g.items.length > 0),
    [trackers]
  );

  const loggedCount = useMemo(
    () =>
      trackers.filter((t) =>
        isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY)
      ).length,
    [trackers, draft]
  );

  const dayTotalMinutes = useMemo(
    () =>
      trackers
        .filter((t) => t.type === "duration")
        .reduce(
          (s, t) => s + draftToEntry("duration", draft[t.id] ?? EMPTY).value,
          0
        ),
    [trackers, draft]
  );

  const doneInGroup = (items: Tracker[]) =>
    items.filter((t) => isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY))
      .length;

  /* -------------------------------- inputs ------------------------------- */

  function renderInput(t: Tracker) {
    const dr = draft[t.id] ?? EMPTY;
    const type = t.type as TrackerType;

    if (type === "duration") {
      return (
        <div className="flex items-center gap-1.5">
          <Timer
            trackerId={t.id}
            date={date}
            onSaved={async () => {
              await saveNow();
              dirtyRef.current = false;
              appliedRef.current = null;
              await entriesQ.refresh();
            }}
          />
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.h}
            onChange={(e) => set(t.id, { h: digits(e.target.value, 2) })}
            className={`${inputCls} w-12`}
            aria-label={`${t.name} hours`}
          />
          <span className="text-sm text-muted">h</span>
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.m}
            onChange={(e) => set(t.id, { m: digits(e.target.value, 3) })}
            className={`${inputCls} w-12`}
            aria-label={`${t.name} minutes`}
          />
          <span className="text-sm text-muted">m</span>
        </div>
      );
    }

    if (type === "sleep") {
      const mins = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1 text-sm text-muted">
            Slept
            <input
              type="time"
              value={dr.start}
              onChange={(e) => set(t.id, { start: e.target.value })}
              className={`${inputCls} text-center`}
            />
          </label>
          <label className="flex items-center gap-1 text-sm text-muted">
            Woke
            <input
              type="time"
              value={dr.end}
              onChange={(e) => set(t.id, { end: e.target.value })}
              className={`${inputCls} text-center`}
            />
          </label>
          {mins > 0 && (
            <span className="rounded-md bg-surface-2 px-2 py-1 text-sm font-medium tabular-nums">
              {formatValue(mins, "sleep", "min")}
            </span>
          )}
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set(t.id, { quality: dr.quality === n ? null : n })}
                className={`h-7 w-7 rounded-md border text-sm ${
                  (dr.quality ?? 0) >= n
                    ? "border-accent bg-accent text-white"
                    : "border-edge text-muted hover:bg-surface-2"
                }`}
                title={`Sleep quality ${n}/5`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (type === "prayer") {
      const done = new Set(dr.parts);
      const all = done.size === PRAYERS.length;
      return (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {PRAYERS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={done.has(p.key)}
              onClick={() =>
                set(t.id, {
                  parts: orderPrayers(
                    done.has(p.key)
                      ? dr.parts.filter((k) => k !== p.key)
                      : [...dr.parts, p.key]
                  ),
                })
              }
              className={
                done.has(p.key)
                  ? "rounded-md border border-green-700 bg-green-700 px-2.5 py-1.5 text-sm font-medium text-white"
                  : "rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-surface-2"
              }
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => set(t.id, { parts: all ? [] : [...PRAYER_KEYS] })}
            className="rounded-md border border-edge px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2"
          >
            {all ? "Clear" : "All 5"}
          </button>
          <span className="ml-1 text-sm font-medium tabular-nums text-secondary">
            {done.size}/5
          </span>
        </div>
      );
    }

    if (type === "streak") {
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              set(t.id, { status: dr.status === "clean" ? null : "clean" })
            }
            className={`rounded-md border px-3.5 py-1.5 text-sm font-medium ${
              dr.status === "clean"
                ? "border-green-700 bg-green-700 text-white"
                : "border-edge text-secondary hover:bg-surface-2"
            }`}
          >
            ✓ Clean
          </button>
          <button
            type="button"
            onClick={() =>
              set(t.id, { status: dr.status === "slip" ? null : "slip" })
            }
            className={`rounded-md border px-3.5 py-1.5 text-sm font-medium ${
              dr.status === "slip"
                ? "border-red-600 bg-red-600 text-white"
                : "border-edge text-secondary hover:bg-surface-2"
            }`}
          >
            Slipped
          </button>
        </div>
      );
    }

    if (type === "count") {
      const n = parseFloat(dr.num) || 0;
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => set(t.id, { num: String(Math.max(0, n - 1)) })}
            className="h-8 w-8 rounded-md border border-edge text-lg leading-none hover:bg-surface-2"
            aria-label={`Decrease ${t.name}`}
          >
            −
          </button>
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.num}
            onChange={(e) => set(t.id, { num: digits(e.target.value, 4) })}
            className={`${inputCls} w-14 text-center`}
            aria-label={t.name}
          />
          <button
            type="button"
            onClick={() => set(t.id, { num: String(n + 1) })}
            className="h-8 w-8 rounded-md border border-edge text-lg leading-none hover:bg-surface-2"
            aria-label={`Increase ${t.name}`}
          >
            +
          </button>
          {t.unit && <span className="text-sm text-muted">{t.unit}</span>}
        </div>
      );
    }

    if (type === "scale") {
      const current = parseFloat(dr.num) || 0;
      return (
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set(t.id, { num: current === n ? "" : String(n) })}
              className={`h-8 w-8 rounded-md border text-sm ${
                current === n
                  ? "border-accent bg-accent text-white"
                  : "border-edge text-secondary hover:bg-surface-2"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      );
    }

    if (type === "check") {
      return (
        <button
          type="button"
          onClick={() => set(t.id, { checked: !dr.checked })}
          className={`rounded-md border px-4 py-1.5 text-sm font-medium ${
            dr.checked
              ? "border-green-700 bg-green-700 text-white"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          {dr.checked ? "✓ Done" : "Mark done"}
        </button>
      );
    }

    // measure
    return (
      <div className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          placeholder="0"
          value={dr.num}
          onChange={(e) =>
            set(t.id, { num: e.target.value.replace(/[^0-9.]/g, "").slice(0, 7) })
          }
          className={`${inputCls} w-20`}
          aria-label={t.name}
        />
        {t.unit && <span className="text-sm text-muted">{t.unit}</span>}
      </div>
    );
  }

  /* -------------------------------- render ------------------------------- */

  const statusLine =
    state === "saving"
      ? { text: "Saving…", tone: "text-muted" }
      : state === "saved"
        ? { text: "✓ Saved", tone: "text-green-700 dark:text-green-500" }
        : state === "queued"
          ? { text: "✓ Saved on device — will sync", tone: "text-amber-700" }
          : state === "error"
            ? { text: error || "Could not save", tone: "text-red-600" }
            : null;

  const pct =
    trackers.length > 0 ? Math.round((loggedCount / trackers.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily log</h1>
        <p className="mt-1 text-sm text-secondary">
          Tap or type — it saves itself. Leave anything blank if it doesn&apos;t
          apply.
        </p>
      </div>

      {/* Which day */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(addDays(date, -1))}
            className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2"
            aria-label="Previous day"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && changeDate(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-edge card px-3 py-2 text-center shadow-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => changeDate(addDays(date, 1))}
            disabled={date >= today}
            className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2 disabled:opacity-30"
            aria-label="Next day"
          >
            →
          </button>
        </div>
        <div className="flex justify-center gap-1.5">
          <button onClick={() => changeDate(today)} className={chipCls(date === today)}>
            Today
          </button>
          <button
            onClick={() => changeDate(addDays(today, -1))}
            className={chipCls(date === addDays(today, -1))}
          >
            Yesterday
          </button>
        </div>
      </div>

      {trackersQ.loading ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="skeleton h-16 w-full rounded-lg" />
          <div className="skeleton h-16 w-full rounded-lg" />
          <div className="skeleton h-16 w-full rounded-lg" />
        </div>
      ) : trackers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-secondary">
          You don&apos;t have any trackers yet.{" "}
          <Link href="/trackers" className="font-medium text-accent underline">
            Set them up
          </Link>{" "}
          to start logging.
        </div>
      ) : (
        <>
          {/* How much of the day is filled in */}
          <div className="rounded-lg border border-edge card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium">
                <span className="tabular-nums">{loggedCount}</span> of{" "}
                <span className="tabular-nums">{trackers.length}</span> filled in
              </span>
              {loggedCount === 0 && (
                <button
                  onClick={copyYesterday}
                  className="rounded-md border border-edge px-2.5 py-1 text-xs font-medium text-secondary hover:bg-surface-2"
                >
                  Copy yesterday
                </button>
              )}
              {statusLine && (
                <span
                  className={`ml-auto animate-fade-in text-sm font-medium ${statusLine.tone}`}
                >
                  {statusLine.text}
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bg-brand-gradient h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {grouped.map((group) => {
            const isClosed = closed.includes(group.value);
            const done = doneInGroup(group.items);
            return (
              <section key={group.value}>
                <button
                  onClick={() => toggleSection(group.value)}
                  className="mb-2 flex w-full items-center gap-2 text-sm font-semibold text-secondary"
                  aria-expanded={!isClosed}
                >
                  <span
                    className={`text-xs text-muted transition-transform ${
                      isClosed ? "" : "rotate-90"
                    }`}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                  <span>
                    {group.icon} {group.label}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      done === group.items.length
                        ? "bg-green-700/10 text-green-700 dark:text-green-500"
                        : "bg-surface-2 text-muted"
                    }`}
                  >
                    {done}/{group.items.length}
                  </span>
                </button>
                {!isClosed && (
                  <ul className="stagger space-y-2">
                    {group.items.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-edge card p-3 shadow-sm"
                      >
                        <span
                          className="h-4 w-4 shrink-0 rounded-full"
                          style={{ backgroundColor: seriesColor(t.color) }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {t.name}
                        </span>
                        {/* Inputs sit beside the name on a wide screen and drop
                            to their own full-width row on a phone. */}
                        <div className="flex w-full justify-end sm:ml-auto sm:w-auto">
                          {renderInput(t)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-edge card p-3 shadow-md sm:bottom-4">
            <span className="text-sm text-secondary">
              Time logged:{" "}
              <strong className="tabular-nums">
                {formatValue(dayTotalMinutes, "duration", "min")}
              </strong>
            </span>
            {statusLine && (
              <span className={`animate-fade-in text-sm font-medium ${statusLine.tone}`}>
                {statusLine.text}
              </span>
            )}
            <button
              onClick={() => {
                dirtyRef.current = true;
                void saveNow();
              }}
              disabled={state === "saving"}
              className="ml-auto rounded-md bg-brand-gradient px-6 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {state === "saving" ? "Saving…" : "Save now"}
            </button>
          </div>

          <DeleteDays
            date={date}
            onDeleted={() => {
              dirtyRef.current = false;
              appliedRef.current = null;
              void entriesQ.refresh();
            }}
          />
        </>
      )}
    </div>
  );
}
