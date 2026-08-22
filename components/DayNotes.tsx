"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cacheSet, post } from "@/lib/sync";
import { useCached } from "@/lib/useCached";
import { EMPTY, isLogged, type Draft } from "@/lib/draft";
import { MAX_DAY_NOTE, MAX_TRACKER_NOTE } from "@/lib/notes";
import { seriesColor } from "@/lib/palette";
import type { Tracker, TrackerType } from "@/lib/trackers";

/**
 * The words that go with the day.
 *
 * Numbers are what this app is for, and they are also what it can't say: two
 * identical days — same hours, same prayers, same sleep — can be a good one
 * and a bad one, and only a sentence knows which. So the log takes writing in
 * two places. The day's note belongs to the day itself and lives in its own
 * collection, which is why it can exist on a day nothing was logged. A
 * tracker note belongs to one row of it ("finished chapter 4") and rides on
 * that row's entry, so it is only offered for the trackers actually filled in
 * — a note hanging off nothing would vanish the moment the day was saved.
 *
 * Both save themselves, like everything else on this page: the day note
 * through the offline queue on its own timer, the tracker notes through the
 * page's `set`, which means autosave, undo and the queue already handle them.
 */

/** Long enough to notice you stopped typing, short enough to feel automatic. */
const AUTOSAVE_MS = 1200;

type DayNote = { date: string; text: string };

export default function DayNotes({
  date,
  trackers,
  draft,
  set,
}: {
  date: string;
  trackers: Tracker[];
  draft: Record<string, Draft>;
  set: (id: string, patch: Partial<Draft>) => void;
}) {
  const q = useCached<DayNote>(`/api/notes?date=${date}`, `note:${date}`);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [open, setOpen] = useState<string[]>([]);

  const dirty = useRef(false);
  const applied = useRef<DayNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What's on screen right now, for the saves that fire on a timer or as the
  // day changes underneath them.
  const latest = useRef({ date, text });
  useEffect(() => {
    latest.current = { date, text };
  });

  const save = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    const { date: d, text: value } = latest.current;
    dirty.current = false;
    setState("saving");
    try {
      await post("/api/notes", { date: d, text: value });
      // Keep the cached copy in step, so coming back to this day paints the
      // note that was typed rather than the one the server last confirmed.
      cacheSet(`note:${d}`, { date: d, text: value.trim() });
      setState("saved");
    } catch {
      dirty.current = true;
      setState("error");
    }
  }, []);

  // Whatever was typed follows the day it was typed on: leaving this date —
  // or the page — flushes it before anything repaints.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const flush = () => void saveRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
      dirty.current = false;
      applied.current = null;
    };
  }, [date]);

  // The stored note, painted in once it lands — never over something being
  // typed, and never yesterday's words on today's blank day.
  useEffect(() => {
    const row = q.data;
    if (dirty.current) return;
    if (!row || row.date !== date) {
      if (applied.current !== null) {
        applied.current = null;
        setText("");
      }
      return;
    }
    if (applied.current === row) return;
    applied.current = row;
    setText(row.text ?? "");
  }, [q.data, date]);

  function edit(value: string) {
    setText(value.slice(0, MAX_DAY_NOTE));
    dirty.current = true;
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save();
    }, AUTOSAVE_MS);
  }

  /* ------------------------- notes on one tracker ------------------------ */

  const logged = trackers.filter((t) =>
    isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY)
  );
  const shown = logged.filter(
    (t) => (draft[t.id]?.note ?? "") !== "" || open.includes(t.id)
  );
  const addable = logged.filter((t) => !shown.includes(t));

  const status =
    state === "saving"
      ? { text: "Saving…", tone: "text-muted" }
      : state === "saved"
        ? { text: "✓ Saved", tone: "text-green-700 dark:text-green-500" }
        : state === "error"
          ? { text: "Could not save the note", tone: "text-red-600" }
          : null;

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3">
        <h2 className="font-semibold">📝 Notes</h2>
        {status && (
          <span className={`ml-auto animate-fade-in text-sm font-medium ${status.tone}`}>
            {status.text}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-secondary">
        What the numbers can&apos;t say. Kept with the day, and read back on
        the calendar.
      </p>

      <textarea
        value={text}
        onChange={(e) => edit(e.target.value)}
        onBlur={() => void save()}
        rows={3}
        maxLength={MAX_DAY_NOTE}
        placeholder="How was today, really?"
        className="mt-3 w-full resize-y rounded-md border border-edge bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />

      <div className="mt-3 border-t border-edge pt-3">
        {logged.length === 0 ? (
          <p className="text-xs text-muted">
            Fill something in above and you can pin a note to it — &ldquo;woke
            twice&rdquo;, &ldquo;finished chapter 4&rdquo;.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {shown.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: seriesColor(t.color) }}
                    aria-hidden="true"
                  />
                  <span className="w-24 shrink-0 truncate text-sm font-medium">
                    {t.name}
                  </span>
                  <input
                    value={draft[t.id]?.note ?? ""}
                    onChange={(e) => set(t.id, { note: e.target.value })}
                    maxLength={MAX_TRACKER_NOTE}
                    placeholder={`A note about ${t.name.toLowerCase()}`}
                    aria-label={`Note about ${t.name}`}
                    className="min-w-0 flex-1 rounded-md border border-edge bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      set(t.id, { note: "" });
                      setOpen((ids) => ids.filter((id) => id !== t.id));
                    }}
                    className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2"
                    aria-label={`Remove the note about ${t.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {addable.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Note on:</span>
                {addable.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpen((ids) => [...ids, t.id])}
                    className="rounded-full border border-dashed border-edge px-2.5 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
                  >
                    ＋ {t.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
