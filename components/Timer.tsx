"use client";

import { useState } from "react";
import { post } from "@/lib/sync";
import {
  clearTimer,
  clock,
  elapsedMinutes,
  kindOf,
  startTimer,
  useNow,
  useRunning,
} from "@/lib/timer";

/**
 * Stopwatch for a "time spent" tracker. The running state lives on the
 * server (see `lib/timer`), so it survives a refresh, a closed tab and a
 * shut-down machine — and, the reason it is there rather than in this
 * browser, it can be stopped from the phone in your pocket instead of only
 * from whatever you happened to start it on. Stopping adds the elapsed
 * minutes to that day's total.
 */
export default function Timer({
  trackerId,
  date,
  onSaved,
}: {
  trackerId: string;
  date: string;
  onSaved: () => void;
}) {
  const running = useRunning();
  const [busy, setBusy] = useState(false);

  const mine =
    running?.trackerId === trackerId && kindOf(running) === "duration";
  const now = useNow(mine);

  async function stop() {
    if (!running || busy) return;
    setBusy(true);
    const minutes = elapsedMinutes(running.startedAt);
    clearTimer();
    try {
      // Queues itself if you're offline — the minutes are never lost.
      await post("/api/entries/increment", {
        trackerId,
        date: running.date,
        minutes,
      });
      onSaved();
    } catch (err) {
      // Network trouble queues itself and never lands here — this is the
      // server refusing outright (e.g. the day is already at 24 hours),
      // and losing the minutes silently would be worse than an ugly box.
      if (err instanceof Error && err.message) window.alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (mine && running) {
    return (
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className="animate-pulse-ring flex shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-sm font-medium text-white tabular-nums hover:bg-red-700 disabled:opacity-40"
        title="Stop and add this time"
      >
        <span className="h-2 w-2 rounded-xs bg-white" />
        {clock(now - running.startedAt)}
      </button>
    );
  }

  // Another timer is running — a stopwatch or a nap — and only one counts
  // an hour at a time.
  const blocked = Boolean(running) && !mine;

  return (
    <button
      type="button"
      onClick={() =>
        startTimer({ trackerId, date, startedAt: Date.now(), kind: "duration" })
      }
      disabled={blocked}
      className="shrink-0 rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-background disabled:opacity-40"
      title={blocked ? "Another timer is running" : "Start timer"}
    >
      ▶ Timer
    </button>
  );
}
