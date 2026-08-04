"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import DeleteDays from "@/components/DeleteDays";
import QuickLog from "@/components/QuickLog";
import TrackerInput from "@/components/TrackerInput";
import { cacheSet, getCached, post, type PostResult } from "@/lib/sync";
import { useCached, useStored } from "@/lib/useCached";
import { addDays, isValidDateStr, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import {
  EMPTY,
  buildDraft,
  draftToEntry,
  isLogged,
  type Draft,
  type Entry,
} from "@/lib/draft";
import {
  categoryMeta,
  formatValue,
  orderCategories,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

/** How long after you stop typing the day is saved for you. */
const AUTOSAVE_MS = 900;

/**
 * How long the way back stays open after a save.
 *
 * This page saves itself a second after you stop typing, which is right for
 * logging on a phone at midnight and wrong for the moment you realise you
 * typed 12 hours of study into the sleep row. Long enough to notice, short
 * enough that it isn't clutter.
 */
const UNDO_MS = 10_000;

const CLOSED_KEY = "closed-sections";

/** Stable empty default, so it doesn't look like a new value every render. */
const NONE_CLOSED: string[] = [];

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
  const [quick, setQuick] = useState(false);

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

  // The day as it stood before the current run of edits. Captured on the first
  // change after a save, so one undo takes back the whole burst rather than a
  // single keystroke.
  const beforeRef = useRef<Record<string, Draft> | null>(null);
  const [undo, setUndo] = useState<{
    date: string;
    draft: Record<string, Draft>;
  } | null>(null);

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current || savingRef.current) return;
    const { date: d, trackers: ts, draft: dr } = latest.current;
    if (ts.length === 0) return;

    const before = beforeRef.current;
    dirtyRef.current = false;
    beforeRef.current = null;
    savingRef.current = true;
    setState("saving");
    try {
      const result = await persist(d, ts, dr);
      setState(result === "queued" ? "queued" : "saved");
      setError("");
      // Only offer the way back if this actually changed something, and only
      // for the day it belongs to.
      if (before && JSON.stringify(before) !== JSON.stringify(dr)) {
        setUndo({ date: d, draft: before });
      }
    } catch (err) {
      dirtyRef.current = true; // it never landed — try again on the next edit
      beforeRef.current = before; // and the way back still points at the right day
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

  /**
   * The stopwatch writes its minutes straight to the server, so the page has
   * to flush what's on screen and then read the day back rather than trusting
   * its own copy.
   */
  const afterTimer = useCallback(async () => {
    await saveNow();
    dirtyRef.current = false;
    appliedRef.current = null;
    await entriesQ.refresh();
  }, [saveNow, entriesQ]);

  /** Remember where the day stood, if this is the first change since a save. */
  function markDirty() {
    if (!dirtyRef.current && beforeRef.current === null) {
      beforeRef.current = latest.current.draft;
    }
    dirtyRef.current = true;
  }

  function set(id: string, patch: Partial<Draft>) {
    markDirty();
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));
    setState("idle");
    schedule();
  }

  /**
   * Put the day back the way it was before the last save, and save that. It
   * goes through the same path as any other edit, so the offline queue and
   * the local cache follow it.
   */
  function undoLast() {
    if (!undo) return;
    if (undo.date !== date) {
      // They've moved to another day; the snapshot no longer applies.
      setUndo(null);
      return;
    }
    beforeRef.current = latest.current.draft;
    dirtyRef.current = true;
    setDraft(undo.draft);
    setUndo(null);
    setState("idle");
    schedule();
  }

  // The offer expires on its own. It's also tied to the day it was made for —
  // putting yesterday's values onto today would be a worse mistake than the
  // one being undone — which is why both the button and `undoLast` check the
  // date rather than this clearing the state the moment you navigate.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

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
    // Overwriting a whole day in one tap is exactly what undo is for.
    markDirty();
    setDraft(buildDraft(trackers, data));
    setError("");
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
              {/* The way through a whole day without hunting for rows. */}
              {loggedCount < trackers.length && (
                <button
                  onClick={() => setQuick(true)}
                  className="rounded-md border border-accent px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/5"
                >
                  ⚡ Quick log
                  {loggedCount > 0 && ` (${trackers.length - loggedCount} left)`}
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
                          <TrackerInput
                            tracker={t}
                            draft={draft[t.id]}
                            set={set}
                            date={date}
                            onTimerSaved={afterTimer}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {/* Sits above the save bar so it's the first thing under your thumb
              in the seconds after a save you didn't mean. */}
          {undo && undo.date === date && (
            <div className="animate-rise-in sticky bottom-36 z-10 flex items-center gap-3 rounded-lg border border-amber-600/40 card p-3 shadow-md sm:bottom-20">
              <span className="min-w-0 flex-1 text-sm text-secondary">
                Saved. Changed something by mistake?
              </span>
              <button
                onClick={undoLast}
                className="shrink-0 rounded-md border border-edge px-3.5 py-1.5 text-sm font-medium hover:bg-surface-2"
              >
                ↩ Undo
              </button>
              <button
                onClick={() => setUndo(null)}
                className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

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
                markDirty();
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

          {quick && (
            <QuickLog
              trackers={trackers}
              draft={draft}
              set={set}
              date={date}
              onClose={() => {
                setQuick(false);
                void saveNow();
              }}
              onTimerSaved={afterTimer}
            />
          )}
        </>
      )}
    </div>
  );
}
