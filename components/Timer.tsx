"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { post } from "@/lib/sync";

const KEY = "pit_timer";
const CHANGE = "pit-timer-change";

type Running = { trackerId: string; date: string; startedAt: number };

/**
 * The running timer as an external store: localStorage is the source of
 * truth (it survives refreshes and is shared across tabs), and the snapshot
 * is memoised against the raw text so an unchanged value keeps its identity
 * — which is what `useSyncExternalStore` needs to not re-render forever.
 */
let snap: { raw: string | null; value: Running | null } = {
  raw: null,
  value: null,
};

function readRunning(): Running | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw !== snap.raw) {
    let value: Running | null = null;
    try {
      value = raw ? (JSON.parse(raw) as Running) : null;
    } catch {
      value = null;
    }
    snap = { raw, value };
  }
  return snap.value;
}

const noRunning = () => null;

function subscribeRunning(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Stopwatch for a "time spent" tracker. The running state lives in
 * localStorage, so closing the tab or refreshing doesn't lose the session.
 * Stopping adds the elapsed minutes to that day's total.
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
  const running = useSyncExternalStore(subscribeRunning, readRunning, noRunning);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const mine = running?.trackerId === trackerId;

  useEffect(() => {
    if (!mine) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mine]);

  function broadcast() {
    window.dispatchEvent(new Event(CHANGE));
  }

  function start() {
    const next: Running = { trackerId, date, startedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(next));
    setNow(Date.now());
    broadcast();
  }

  async function stop() {
    if (!running || busy) return;
    setBusy(true);
    const elapsedMs = Date.now() - running.startedAt;
    const minutes = Math.max(1, Math.round(elapsedMs / 60000));
    localStorage.removeItem(KEY);
    broadcast();
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

  // Another tracker's timer is running — don't let two run at once.
  const blocked = Boolean(running) && !mine;

  return (
    <button
      type="button"
      onClick={start}
      disabled={blocked}
      className="shrink-0 rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-background disabled:opacity-40"
      title={blocked ? "Another timer is running" : "Start timer"}
    >
      ▶ Timer
    </button>
  );
}
