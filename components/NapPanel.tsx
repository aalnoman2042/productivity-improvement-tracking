"use client";

import { useState } from "react";
import { formatMinutes, prettyDate, prettyTime } from "@/lib/dates";
import { MAX_NAPS, napMinutes, type Nap } from "@/lib/draft";
import {
  clearTimer,
  clock,
  elapsedMinutes,
  kindOf,
  startTimer,
  startedAtClock,
  useNow,
  useRunning,
} from "@/lib/timer";

/** One tap each for the naps people actually take. */
const QUICK = [15, 20, 30, 45, 60];

/** Nothing longer than this from one tap or one typed number. */
const MAX_NAP_MINUTES = 600;

/**
 * Naps, folded away under the sleep row.
 *
 * A night is two clock times; an afternoon on the sofa is neither, and
 * making people bend one into the other is how naps end up unlogged. So the
 * row keeps its bedtime and wake time, and the rest of the day's sleep lives
 * behind this one small button: run a timer while you lie down, or add the
 * minutes afterwards.
 *
 * The minutes go into the *draft*, not straight to the server — a nap is
 * stored inside the night's entry, so the day's own autosave carries it.
 * (Which is why it can't use the stopwatch's increment route the way a time
 * tracker does: the next save recomputes sleep from the clock times, and
 * would wipe anything added behind the draft's back.)
 */
export default function NapPanel({
  trackerId,
  date,
  naps,
  onChange,
  big,
}: {
  trackerId: string;
  date: string;
  naps: Nap[];
  onChange: (naps: Nap[]) => void;
  big: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const running = useRunning();
  const isNap = kindOf(running) === "nap";
  // The nap being counted right now, on this row and on this day.
  const mine =
    isNap && running?.trackerId === trackerId && running.date === date;
  // A nap started on another day still belongs to that day — it can't be
  // stopped into the one on screen, so say where it is instead.
  const elsewhere = isNap && running?.trackerId === trackerId && !mine;
  const now = useNow(Boolean(mine));

  const total = napMinutes(naps);
  const full = naps.length >= MAX_NAPS;
  // A running nap is never hidden behind a closed panel — stopping it is the
  // one thing here you must always be able to reach.
  const show = open || Boolean(mine);

  function add(mins: number) {
    const m = Math.round(mins);
    if (!Number.isFinite(m) || m < 1 || full) return;
    onChange([...naps, { mins: Math.min(m, MAX_NAP_MINUTES), at: null }]);
  }

  function addTyped() {
    const m = parseInt(typed, 10);
    if (Number.isFinite(m) && m > 0) add(m);
    setTyped("");
  }

  function stop() {
    if (!running) return;
    const mins = elapsedMinutes(running.startedAt);
    clearTimer();
    if (full) return;
    onChange([
      ...naps,
      {
        mins: Math.min(mins, MAX_NAP_MINUTES),
        at: startedAtClock(running.startedAt),
      },
    ]);
  }

  const pill = big ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-xs";
  const small =
    "rounded-md border border-edge px-2 py-1.5 text-sm text-secondary hover:bg-background disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={show}
        className={`flex shrink-0 items-center gap-1 rounded-full border transition-colors ${pill} ${
          total > 0 || mine
            ? "border-accent text-accent"
            : "border-edge text-muted hover:border-accent hover:text-accent"
        }`}
        title="Naps — start a timer, or add the minutes"
      >
        <span aria-hidden>💤</span>
        {mine && running ? (
          <span className="tabular-nums">{clock(now - running.startedAt)}</span>
        ) : (
          <span>{total > 0 ? `Naps ${formatMinutes(total)}` : "Nap"}</span>
        )}
        <span aria-hidden className={show ? "rotate-180" : ""}>
          ▾
        </span>
      </button>

      {show && (
        <div className="w-full rounded-lg border border-edge bg-surface-2 p-2.5 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            {mine && running ? (
              <button
                type="button"
                onClick={stop}
                className="animate-pulse-ring flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-sm font-medium text-white tabular-nums hover:bg-red-700"
                title="Stop the nap and add these minutes"
              >
                <span className="h-2 w-2 rounded-xs bg-white" />
                Stop {clock(now - running.startedAt)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  startTimer({
                    trackerId,
                    date,
                    startedAt: Date.now(),
                    kind: "nap",
                  })
                }
                disabled={Boolean(running) || full}
                className="rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-background disabled:opacity-40"
                title={
                  running
                    ? "Another timer is running"
                    : full
                      ? "That is enough naps for one day"
                      : "Start a nap timer"
                }
              >
                ▶ Start nap
              </button>
            )}
            <span className="text-xs text-muted">or</span>
            {QUICK.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => add(m)}
                disabled={full}
                className={small}
              >
                +{m}m
              </button>
            ))}
            <span className="flex items-center gap-1">
              <input
                inputMode="numeric"
                value={typed}
                onChange={(e) =>
                  setTyped(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTyped();
                  }
                }}
                placeholder="min"
                aria-label="Nap minutes"
                className="w-14 rounded-md border border-edge bg-transparent px-2 py-1.5 text-right outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={addTyped}
                disabled={full || !typed}
                className={small}
              >
                Add
              </button>
            </span>
          </div>

          {elsewhere && running && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
              A nap timer is running on {prettyDate(running.date)} — open that
              day to stop it.
            </p>
          )}

          {naps.length > 0 && (
            <ul className="mt-2 flex flex-wrap items-center gap-1.5">
              {naps.map((n, i) => (
                <li key={`${i}-${n.mins}-${n.at ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => onChange(naps.filter((_, j) => j !== i))}
                    className="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs text-secondary hover:border-red-600 hover:text-red-600"
                    title="Remove this nap"
                  >
                    <span className="tabular-nums">{formatMinutes(n.mins)}</span>
                    {n.at && (
                      <span className="text-muted">from {prettyTime(n.at)}</span>
                    )}
                    <span aria-hidden>×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-xs text-muted">
            {total > 0
              ? `${formatMinutes(total)} of naps, counted in the day's sleep.`
              : "Naps count towards the day's sleep total."}
          </p>
        </div>
      )}
    </>
  );
}
