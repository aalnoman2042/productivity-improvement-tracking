"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TrackerInput from "@/components/TrackerInput";
import { EMPTY, isLogged, type Draft } from "@/lib/draft";
import { categoryMeta, type Tracker, type TrackerType } from "@/lib/trackers";
import { seriesColor } from "@/lib/palette";
import { prettyDate } from "@/lib/dates";

/**
 * One tracker at a time, full screen.
 *
 * The full log shows twelve rows at once, which is the right shape for
 * correcting one thing and the wrong shape for filling in a whole day: every
 * row is a small target next to eleven other small targets. Here there's one
 * question on screen, controls big enough to hit without looking, and Enter
 * moves on — so a twelve-tracker day is twelve taps and a rhythm rather than a
 * scroll and a hunt.
 *
 * It writes through the same `set` the full log uses, so autosave, the offline
 * queue and undo all apply without knowing this exists.
 */
export default function QuickLog({
  trackers,
  draft,
  set,
  date,
  onClose,
  onTimerSaved,
}: {
  trackers: Tracker[];
  draft: Record<string, Draft>;
  set: (id: string, patch: Partial<Draft>) => void;
  date: string;
  onClose: () => void;
  onTimerSaved?: () => void | Promise<void>;
}) {
  // Start on the first thing not yet filled in — coming back to finish a
  // half-done day shouldn't mean tapping past what's already there.
  const [i, setI] = useState(() => {
    const first = trackers.findIndex(
      (t) => !isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY)
    );
    return first === -1 ? 0 : first;
  });

  const t = trackers[Math.min(i, trackers.length - 1)];
  const atEnd = i >= trackers.length - 1;
  const panel = useRef<HTMLDivElement>(null);

  const next = useCallback(() => {
    setI((n) => (n >= trackers.length - 1 ? n : n + 1));
  }, [trackers.length]);

  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Enter advances, Escape leaves, arrows move — the keyboard flow that makes
  // this quick on a laptop, without taking anything away on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (atEnd) onClose();
        else next();
        return;
      }
      // Not while someone is typing into a box — the arrows belong to the
      // caret then.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atEnd, next, back, onClose]);

  // Move focus onto the panel when the tracker changes, so the keys above
  // keep working after a tap and a screen reader announces the new question.
  useEffect(() => {
    panel.current?.focus();
  }, [i]);

  if (!t) return null;

  const done = trackers.filter((x) =>
    isLogged(x.type as TrackerType, draft[x.id] ?? EMPTY)
  ).length;
  const filled = isLogged(t.type as TrackerType, draft[t.id] ?? EMPTY);
  const meta = categoryMeta(t.category);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick log"
      // A swipe in here is a mis-tap on the big controls, not "change page".
      data-no-swipe
      className="fixed inset-0 z-50 flex flex-col bg-surface"
    >
      {/* Progress and the way out */}
      <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            <span className="tabular-nums">{i + 1}</span> of{" "}
            <span className="tabular-nums">{trackers.length}</span>
            <span className="ml-2 text-muted">
              · {done} filled in · {prettyDate(date)}
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="bg-brand-gradient h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${((i + 1) / trackers.length) * 100}%` }}
            />
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm text-secondary hover:bg-surface-2"
        >
          Done
        </button>
      </div>

      {/* The one question */}
      <div
        ref={panel}
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-6 outline-none"
      >
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {meta.icon} {meta.label}
          </p>
          <h2 className="mt-1 flex items-center justify-center gap-2 text-2xl font-bold">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: seriesColor(t.color) }}
            />
            {t.name}
          </h2>
          {filled && (
            <p className="mt-1 text-sm text-green-700 dark:text-green-500">
              ✓ filled in
            </p>
          )}
        </div>

        <div className="w-full max-w-md">
          <TrackerInput
            tracker={t}
            draft={draft[t.id]}
            set={set}
            date={date}
            size="large"
            onTimerSaved={onTimerSaved}
          />
        </div>

        <p className="text-xs text-muted">
          Leave it blank if it doesn&apos;t apply — press Enter to move on.
        </p>
      </div>

      {/* Move */}
      <div className="safe-bottom flex items-center gap-2 border-t border-edge px-4 py-3">
        <button
          onClick={back}
          disabled={i === 0}
          className="rounded-md border border-edge px-4 py-3 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-30"
        >
          ← Back
        </button>
        <button
          onClick={atEnd ? onClose : next}
          className="flex-1 rounded-md bg-brand-gradient px-6 py-3 font-medium text-white hover:brightness-110"
        >
          {atEnd ? "Finish" : filled ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}
