"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import DayDial from "@/components/DayDial";
import DayNotes from "@/components/DayNotes";
import DayTasks from "@/components/DayTasks";
import RestDay from "@/components/RestDay";
import CardBoundary from "@/components/CardBoundary";
import DeleteDays from "@/components/DeleteDays";
import InstallPrompt from "@/components/InstallPrompt";
import MotivationLine from "@/components/MotivationLine";
import QuickLog from "@/components/QuickLog";
import ReadingToday from "@/components/ReadingToday";
import TapGrid from "@/components/TapGrid";
import TrackerInput from "@/components/TrackerInput";
import { cacheSet, getCached, post, type PostResult } from "@/lib/sync";
import { useCached, useStored } from "@/lib/useCached";
import { useMinutesElapsed } from "@/lib/useElapsed";
import { addDays, formatMinutes, isValidDateStr, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import { buildPrefills, type RecentEntry } from "@/lib/prefill";
import {
  DAY_MINUTES,
  EMPTY,
  buildDraft,
  dayTimeTotal,
  draftNote,
  draftToEntry,
  isLogged,
  slipsMissingReason,
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

/**
 * The kinds answered with a tap, and the kinds answered with typing. The page
 * shows all the taps first as a dense grid — most of a day is settled there
 * in seconds — and keeps full rows only for the few that need a keyboard.
 */
const TAP_TYPES: TrackerType[] = ["check", "streak", "scale", "prayer"];

/**
 * The typed kinds that need a whole row on a phone.
 *
 * A count or a measurement is one box — two of them fit side by side on the
 * narrowest screen, which is what makes the log a grid rather than a column.
 * Time and sleep are not one box: a stopwatch with an hours and a minutes
 * field, or two clock pickers and a quality row, squeezed into 160px is worse
 * than a scroll. So those keep the full width until there is room for two.
 */
const WIDE_TYPES: TrackerType[] = ["duration", "sleep"];

/**
 * Send the day's changes, and keep the offline copy in step.
 *
 * Only the trackers in `only` are sent (everything, when it's empty — the
 * explicit Save button and whole-day actions want that). Sending just what
 * changed is what lets two devices edit *different rows* of the same day
 * without silently overwriting each other: the server upserts per entry, so
 * a phone that only touched Sleep can't erase the laptop's Study.
 */
async function persist(
  date: string,
  trackers: Tracker[],
  draft: Record<string, Draft>,
  only: Set<string>
): Promise<PostResult> {
  const all = trackers.map((t) => ({
    trackerId: t.id,
    ...draftToEntry(t.type as TrackerType, draft[t.id] ?? EMPTY),
    // The note travels with every save, including the ones that didn't touch
    // it: the server writes the note it is given, so leaving it out would
    // quietly erase what was written the last time.
    note: draftNote(draft[t.id]),
  }));
  const sending =
    only.size > 0 ? all.filter((e) => only.has(e.trackerId)) : all;
  const result = await post("/api/entries", { date, entries: sending });
  // The cache holds the whole day as it stands on screen, sent or not.
  cacheSet(
    `entries:${date}`,
    all.filter((e) => e.value > 0 || e.meta)
  );
  return result;
}

const chipCls = (on: boolean) =>
  `rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
    on
      ? "border-accent bg-accent text-white"
      : "border-edge text-secondary hover:bg-surface-2"
  }`;

function TodayLog() {
  // `?date=YYYY-MM-DD` opens straight on that day — it's how the reminder
  // lands you on the day it's nagging about, and how tapping a square on the
  // calendar opens *that* square.
  //
  // It has to come from the router rather than from `window.location`: on a
  // client-side navigation the address bar is only rewritten after the new
  // page has rendered, so a page that reads the URL itself gets the one it
  // was navigated *from* — which is why tapping a day used to land on today.
  const params = useSearchParams();
  const asked = params.get("date");

  const [date, setDate] = useState(() => {
    const first = toDateStr(new Date());
    return isValidDateStr(asked) && asked <= first ? asked : first;
  });
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [quick, setQuick] = useState(false);
  // Which category sections are rolled up. Kept on the device rather than in
  // the account: it's about the screen you're logging on, and a phone and a
  // laptop have different amounts of room to spend.
  const [folded, setFolded] = useStored<string[]>("logFolded", []);

  const today = toDateStr(new Date());

  const trackersQ = useCached<Tracker[]>("/api/trackers", "trackers");
  const entriesQ = useCached<Entry[]>(`/api/entries?date=${date}`, `entries:${date}`);
  // The week before this day, turned into "same as usual" offers per tracker.
  const recentQ = useCached<RecentEntry[]>(
    `/api/entries/recent?before=${date}`,
    `recent:${date}`
  );

  const trackers = useMemo(
    () => (trackersQ.data ?? []).filter((t) => !t.archived),
    [trackersQ.data]
  );

  const prefills = useMemo(
    () => buildPrefills(trackers, recentQ.data ?? []),
    [trackers, recentQ.data]
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
  // Which trackers changed since the last successful save — what a partial
  // save sends. Empty means "send everything" (the explicit Save button).
  const changedRef = useRef<Set<string>>(new Set());

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

    // A day only has 24 hours, strictly — refuse to send one that doesn't.
    // The day stays dirty, so trimming a number saves it as usual.
    const timeTotal = dayTimeTotal(ts, dr);
    if (timeTotal > DAY_MINUTES) {
      setState("error");
      setError(
        `A day only has 24 hours — this one adds up to ${formatValue(timeTotal, "duration", "min")} of time. Trim something and it'll save.`
      );
      return;
    }

    const before = beforeRef.current;
    const changed = changedRef.current;
    dirtyRef.current = false;
    beforeRef.current = null;
    changedRef.current = new Set();
    savingRef.current = true;
    setState("saving");
    try {
      const result = await persist(d, ts, dr, changed);
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
      for (const id of changed) changedRef.current.add(id); // still unsent
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
    changedRef.current.add(id);
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));
    setState("idle");
    schedule();
  }

  /** Whole-day actions (undo, copy, the Save button) touch every tracker. */
  function markAllChanged() {
    for (const t of latest.current.trackers) changedRef.current.add(t.id);
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
    markAllChanged();
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

  // The address can also change under a page that's already open — the nav's
  // Today tab is a link to `/`, with no day on it. Follow it, but only when
  // it actually moves: an arrow tap changes the day without touching the URL,
  // and that must not be undone on the next render.
  const askedRef = useRef(asked);
  useEffect(() => {
    if (askedRef.current === asked) return;
    askedRef.current = asked;
    const wanted = isValidDateStr(asked) && asked <= today ? asked : today;
    if (wanted !== latest.current.date) changeDate(wanted);
  });

  function changeDate(next: string) {
    void saveNow(); // reads the day being left out of the ref, before it moves
    setDraft({});
    setState("idle");
    setError("");
    appliedRef.current = null;
    dirtyRef.current = false;
    changedRef.current = new Set();
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
    markAllChanged();
    setDraft(buildDraft(trackers, data));
    setError("");
    setState("idle");
    schedule();
  }

  /* ------------------------------- grouping ------------------------------ */

  // One section per category, in the same order as the Trackers page, so the
  // day reads the way the list was set up — Faith on top, then the rest.
  // Inside a section the one-tap kinds still come first as a dense grid, and
  // the rows that need a keyboard follow.
  const groups = useMemo(
    () =>
      orderCategories(trackers.map((t) => t.category))
        .map((value) => {
          const items = trackers.filter(
            (t) => t.category.toLowerCase() === value.toLowerCase()
          );
          return {
            value,
            ...categoryMeta(value),
            items,
            taps: items.filter((t) =>
              TAP_TYPES.includes(t.type as TrackerType)
            ),
            typed: items.filter(
              (t) => !TAP_TYPES.includes(t.type as TrackerType)
            ),
          };
        })
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

  // Time spent plus sleep — the total that strictly can't pass 24 hours.
  const dayTimeMinutes = useMemo(
    () => dayTimeTotal(trackers, draft),
    [trackers, draft]
  );
  const overDay = dayTimeMinutes > DAY_MINUTES;

  // Slips still waiting on a reason. Asked for, never enforced — see the
  // note on `slipNeedsReason` in lib/draft: the day saves either way.
  const unexplained = useMemo(
    () => slipsMissingReason(trackers, draft),
    [trackers, draft]
  );

  // How much of *today* has happened, and how much of that is unaccounted
  // for. Both null on any other day: yesterday is not behind, it is over.
  const elapsed = useMinutesElapsed(date);
  const adrift =
    elapsed === null || overDay ? 0 : Math.max(0, elapsed - dayTimeMinutes);
  // Not before the morning is properly under way, and not for a gap small
  // enough to be a coffee: this is a nudge, and a nudge that fires all day
  // is a scold.
  // Only where the advice can actually be taken: a day being *lived* (not a
  // planned tomorrow), with the trackers loaded, and with at least one
  // tracker that counts minutes. Without those three it fired over the
  // loading skeleton, and on an empty account it said to start a timer on a
  // tracker that does not exist.
  const hasTimeTracker = trackers.some(
    (t) => t.type === "duration" || t.type === "sleep"
  );
  const nudge =
    elapsed !== null &&
    elapsed >= 8 * 60 &&
    adrift >= 2 * 60 &&
    hasTimeTracker &&
    !trackersQ.loading;

  const doneInGroup = (items: Tracker[]) =>
    items.filter((t) => isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY))
      .length;

  const isFolded = (category: string) => folded.includes(category.toLowerCase());

  /** Roll a section up or down. Folding never touches what's in it. */
  function toggleFold(category: string) {
    const key = category.toLowerCase();
    setFolded(isFolded(key) ? folded.filter((f) => f !== key) : [...folded, key]);
  }

  /* -------------------------------- render ------------------------------- */

  const statusLine =
    state === "saving"
      ? { text: "Saving…", tone: "text-muted" }
      : state === "saved"
        ? { text: "✓ Saved", tone: "text-green-700 dark:text-green-500" }
        : state === "queued"
          ? {
            text: "✓ Saved on device — will sync",
            tone: "text-amber-700 dark:text-amber-500",
          }
          : state === "error"
            ? { text: error || "Could not save", tone: "text-red-600" }
            : null;

  const pct =
    trackers.length > 0 ? Math.round((loggedCount / trackers.length) * 100) : 0;

  // Tomorrow is reachable, but only to plan: a day nobody has lived cannot
  // be logged, and the server refuses an entry dated past today whatever
  // this page thinks (`isBeyondToday`). So the page shows the one thing
  // that *is* about a day before it starts — the list of what has to happen
  // in it — and nothing else at all.
  const tomorrow = addDays(today, 1);
  const planning = date > today;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Daily log</h1>
          <p className="mt-1 text-sm text-secondary">
            Tap or type — it saves itself. Leave anything blank if it
            doesn&apos;t apply.
          </p>
        </div>
        {/* Twenty-four hours, and how much of them is on record — the gap in
            the ring is the part of the day nobody wrote down. */}
        {trackers.length > 0 && (
          <DayDial trackers={trackers} draft={draft} date={date} />
        )}
      </div>

      {/* The hours that went somewhere you didn't write down. It says the
          number and then what to do about it, because "4h unaccounted" on
          its own is a complaint rather than a suggestion. */}
      {nudge && (
        <p className="animate-fade-in rounded-lg border border-amber-600/40 bg-amber-600/5 p-3 text-sm text-secondary">
          <strong className="text-foreground tabular-nums">
            {formatMinutes(adrift)}
          </strong>{" "}
          of the {Math.floor(elapsed / 60)} hours today has had so far
          isn&apos;t logged. Top it up every half hour while you still
          remember it — or start the ⏱ timer on a tracker and let it count
          for you.
        </p>
      )}

      {/* Slips with nothing written on them. An ASK, never a gate — the day
          has already saved, and the words can come whenever they come.
          It was a gate for one afternoon and the afternoon was enough: it
          silently refused a month of backfilled days, which is the exact
          opposite of what a tracker is for. */}
      {unexplained.length > 0 && (
        <p className="animate-fade-in rounded-lg border border-amber-600/40 bg-amber-600/5 p-3 text-sm text-secondary">
          <strong className="text-foreground">
            {unexplained.map((t) => t.name).join(", ")}
          </strong>{" "}
          {unexplained.length === 1 ? "is" : "are"} marked slipped with no
          reason. It&apos;s saved either way — but a word now (
          <em>tired</em>, <em>argument</em>, <em>3am</em>) is the part you
          can actually learn from three months later.
        </p>
      )}

      <InstallPrompt />

      {/* Which day */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(addDays(date, -1))}
            className="rounded-lg border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2"
            aria-label="Previous day"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            max={tomorrow}
            onChange={(e) => e.target.value && changeDate(e.target.value)}
            suppressHydrationWarning
            className="min-w-0 flex-1 rounded-lg border border-edge card px-3 py-2 text-center shadow-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => changeDate(addDays(date, 1))}
            disabled={date >= tomorrow}
            className="rounded-lg border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2 disabled:opacity-40"
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
          <button
            onClick={() => changeDate(tomorrow)}
            className={chipCls(date === tomorrow)}
          >
            Tomorrow
          </button>
        </div>

        {/* A day you meant to take off. Not offered for a day that hasn't
            started — you cannot have rested through it yet. It records
            nothing and moves no number; see components/RestDay. */}
        {!planning && (
          <CardBoundary title="🌙 Rest day">
            <RestDay date={date} />
          </CardBoundary>
        )}
      </div>

      {planning ? (
        /* A day before it starts holds exactly one useful thing: what has to
           happen in it. No dial, no trackers, no notes, no save bar — there
           is nothing yet to record, and offering the inputs would invite
           logging a day that hasn't been lived. */
        <>
          <p className="rounded-xl border border-accent/40 bg-accent/5 p-3 text-sm">
            <strong>Tomorrow hasn&apos;t started.</strong> You can decide now
            what has to happen in it — the logging waits until the day does.
          </p>
          <CardBoundary title="✅ Have to do it today">
            <DayTasks date={date} />
          </CardBoundary>
        </>
      ) : trackersQ.loading ? (
        <div className="space-y-2">
          <div aria-hidden="true" className="space-y-2">
            <div className="skeleton h-16 w-full rounded-lg" />
            <div className="skeleton h-16 w-full rounded-lg" />
            <div className="skeleton h-16 w-full rounded-lg" />
          </div>
          <MotivationLine className="pt-3" />
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
          <div className="rounded-xl border border-edge card p-3 shadow-sm">
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
                  // The page saves itself; whether that worked is not
                  // something a reader should have to be watching to learn.
                  role="status"
                  aria-live="polite"
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
            {pct === 100 && (
              <p className="animate-rise-in mt-2 text-sm font-medium text-green-700 dark:text-green-500">
                🎉 Every tracker filled in — the whole day is on record.
              </p>
            )}
          </div>

          {/* The one part of this page that faces forward, so it goes above
              the record of what already happened. At 9am it is the answer to
              "what was I supposed to do today?"; at 11pm it is the last
              thing checked before sleeping. Nothing in it counts towards a
              score — see components/DayTasks. */}
          <DayTasks date={date} />

          {/* One section per category. Taps still come first inside each,
              so most of a section is settled in a few seconds.

              Two columns once the screen is wide enough to hold them, so a
              dozen trackers is a page rather than a scroll. A plain grid
              rather than the .card-stack columns used elsewhere: this page
              has sticky bars below, and sticky inside a multi-column
              container is unreliable. `items-start` keeps a folded section
              its own height instead of stretching it to match its neighbour. */}
          <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
          {groups.map((group) => {
            const done = doneInGroup(group.items);
            const open = !isFolded(group.value);
            return (
              <section key={group.value}>
                {/* The whole header folds the section. A day with a dozen
                    trackers is a long scroll otherwise, and the sections
                    already finished are the ones worth getting out of the
                    way. */}
                <button
                  type="button"
                  onClick={() => toggleFold(group.value)}
                  aria-expanded={open}
                  className="mb-2 flex w-full items-center gap-2 text-sm font-semibold text-secondary"
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block text-xs transition-transform duration-200 ${
                      open ? "rotate-90" : ""
                    }`}
                  >
                    &#9654;
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
                {open && (
                  <div className="space-y-2">
                    {group.taps.length > 0 && (
                      <TapGrid
                        trackers={group.taps}
                        draft={draft}
                        set={set}
                        date={date}
                      />
                    )}
                    {/* Two to a row, phones included: the name above its
                        inputs, so a half-width card still reads. The kinds
                        that carry more than one field take the full row
                        until there is room for two of them. */}
                    {group.typed.length > 0 && (
                      <ul className="stagger grid grid-cols-2 gap-2">
                        {group.typed.map((t) => (
                          <li
                            key={t.id}
                            className={`flex flex-col gap-2 rounded-xl border border-edge card p-3 shadow-sm ${
                              WIDE_TYPES.includes(t.type as TrackerType)
                                ? "col-span-2 sm:col-span-1"
                                : ""
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className="h-3.5 w-3.5 shrink-0 rounded-full"
                                style={{ backgroundColor: seriesColor(t.color) }}
                              />
                              <span className="min-w-0 truncate font-medium">
                                {t.name}
                              </span>
                            </span>
                            <div className="flex justify-end">
                              <TrackerInput
                                tracker={t}
                                draft={draft[t.id]}
                                set={set}
                                date={date}
                                onTimerSaved={afterTimer}
                                prefill={prefills[t.id]}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          </div>

          {/* A bookmark is a thing you move at the end of a day too, and
              nobody goes to another screen to do it. Renders nothing at all
              when no book is on the go. */}
          <CardBoundary title="📖 Reading now">
            <ReadingToday />
          </CardBoundary>

          {/* Words last, after the numbers they explain — but still inside
              the day, not on a page of their own. */}
          <CardBoundary title="📝 Notes">
            <DayNotes date={date} trackers={trackers} draft={draft} set={set} />
          </CardBoundary>

          {/* Sits above the save bar so it's the first thing under your thumb
              in the seconds after a save you didn't mean. */}
          {undo && undo.date === date && (
            <div className="animate-rise-in sticky bottom-36 z-10 flex items-center gap-3 rounded-xl border border-amber-600/40 card p-3 shadow-md sm:bottom-20">
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

          <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-edge card p-3 shadow-md sm:bottom-4">
            <span className="text-sm text-secondary">
              Time logged:{" "}
              <strong
                className={`tabular-nums ${overDay ? "text-red-600" : ""}`}
              >
                {formatValue(dayTotalMinutes, "duration", "min")}
              </strong>
            </span>
            {overDay && (
              <span className="text-sm font-medium text-red-600">
                ⚠ With sleep that&apos;s{" "}
                {formatValue(dayTimeMinutes, "duration", "min")} — a day only
                has 24 hours.
              </span>
            )}
            {statusLine && (
              <span
                role="status"
                aria-live="polite"
                className={`animate-fade-in text-sm font-medium ${statusLine.tone}`}
              >
                {statusLine.text}
              </span>
            )}
            <button
              onClick={() => {
                markDirty();
                markAllChanged();
                void saveNow();
              }}
              disabled={state === "saving"}
              className="ml-auto rounded-lg bg-brand-gradient px-6 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
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
              prefills={prefills}
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

/**
 * Reading the query string makes this tree client-rendered, and Next asks for
 * that boundary to be drawn on purpose rather than inferred. The fallback is
 * the same grey blocks the page shows while its trackers load, so the
 * handover is invisible.
 */
export default function TodayPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-2" aria-hidden="true">
          <div className="skeleton h-16 w-full rounded-lg" />
          <div className="skeleton h-16 w-full rounded-lg" />
          <div className="skeleton h-16 w-full rounded-lg" />
        </div>
      }
    >
      <TodayLog />
    </Suspense>
  );
}
