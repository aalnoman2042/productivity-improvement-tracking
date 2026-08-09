"use client";

import TrackerInput from "@/components/TrackerInput";
import { EMPTY, isLogged, type Draft } from "@/lib/draft";
import { seriesColor } from "@/lib/palette";
import type { Tracker, TrackerType } from "@/lib/trackers";

/**
 * The one-tap trackers as a dense grid instead of a column of rows.
 *
 * Checks, streaks, scales and prayers need no typing — so they shouldn't cost
 * a screen-height of scrolling each. Here they sit two or three to a row and
 * light up as they're tapped, which turns the start of logging a day into a
 * few seconds of tap-tap-tap rather than a hunt down a list.
 *
 * Everything writes through the same `set` as the full rows, so autosave,
 * undo and the offline queue don't know this grid exists. Scales and prayers
 * reuse `TrackerInput` outright — a "3/5 mood" must mean the same thing here
 * as everywhere else; only checks and streaks get bespoke whole-card targets,
 * because "one big button" *is* the point of them.
 */
export default function TapGrid({
  trackers,
  draft,
  set,
  date,
}: {
  trackers: Tracker[];
  draft: Record<string, Draft>;
  set: (id: string, patch: Partial<Draft>) => void;
  date: string;
}) {
  const card = "rounded-xl border card p-3 shadow-sm transition-colors";
  const name = (t: Tracker) => (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: seriesColor(t.color) }}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-sm font-medium">{t.name}</span>
    </span>
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {trackers.map((t) => {
        const dr = draft[t.id] ?? EMPTY;
        const type = t.type as TrackerType;
        const done = isLogged(type, dr);

        if (type === "check") {
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={dr.checked}
              onClick={() => set(t.id, { checked: !dr.checked })}
              className={`${card} text-left ${
                dr.checked
                  ? "border-green-700 bg-green-700/10"
                  : "border-edge hover:bg-surface-2"
              }`}
            >
              {name(t)}
              <span
                className={`mt-1.5 block text-xs font-medium ${
                  dr.checked
                    ? "text-green-700 dark:text-green-500"
                    : "text-muted"
                }`}
              >
                {dr.checked ? "✓ Done" : "Tap when done"}
              </span>
            </button>
          );
        }

        if (type === "streak") {
          return (
            <div
              key={t.id}
              className={`${card} ${
                dr.status === "clean"
                  ? "border-green-700 bg-green-700/10"
                  : dr.status === "slip"
                    ? "border-red-600 bg-red-600/10"
                    : "border-edge"
              }`}
            >
              {name(t)}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  aria-pressed={dr.status === "clean"}
                  onClick={() =>
                    set(t.id, { status: dr.status === "clean" ? null : "clean" })
                  }
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium ${
                    dr.status === "clean"
                      ? "border-green-700 bg-green-700 text-white"
                      : "border-edge text-secondary hover:bg-surface-2"
                  }`}
                >
                  ✓ Clean
                </button>
                <button
                  type="button"
                  aria-pressed={dr.status === "slip"}
                  onClick={() =>
                    set(t.id, { status: dr.status === "slip" ? null : "slip" })
                  }
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                    dr.status === "slip"
                      ? "border-red-600 bg-red-600 text-white"
                      : "border-edge text-secondary hover:bg-surface-2"
                  }`}
                >
                  Slipped
                </button>
              </div>
            </div>
          );
        }

        if (type === "scale") {
          return (
            <div
              key={t.id}
              className={`${card} ${
                done ? "border-accent/60 bg-accent/5" : "border-edge"
              }`}
            >
              {name(t)}
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      set(t.id, {
                        num: (parseFloat(dr.num) || 0) === n ? "" : String(n),
                      })
                    }
                    className={`h-9 flex-1 rounded-md border text-sm ${
                      (parseFloat(dr.num) || 0) === n
                        ? "border-accent bg-accent text-white"
                        : "border-edge text-secondary hover:bg-surface-2"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        // prayer — five named parts don't fit half a row, so it spans the grid
        // and reuses the shared control.
        return (
          <div
            key={t.id}
            className={`${card} col-span-full ${
              done ? "border-accent/60 bg-accent/5" : "border-edge"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {name(t)}
              <div className="ml-auto">
                <TrackerInput tracker={t} draft={dr} set={set} date={date} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
