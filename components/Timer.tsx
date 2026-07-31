"use client";

import { useEffect, useState } from "react";

const KEY = "pit_timer";

type Running = { trackerId: string; date: string; startedAt: number };

function read(): Running | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Running) : null;
  } catch {
    return null;
  }
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
  const [running, setRunning] = useState<Running | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRunning(read());
    const sync = () => setRunning(read());
    window.addEventListener("storage", sync);
    window.addEventListener("pit-timer-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pit-timer-change", sync);
    };
  }, []);

  const mine = running?.trackerId === trackerId;

  useEffect(() => {
    if (!mine) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mine]);

  function broadcast() {
    window.dispatchEvent(new Event("pit-timer-change"));
  }

  function start() {
    const next: Running = { trackerId, date, startedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(next));
    setRunning(next);
    setNow(Date.now());
    broadcast();
  }

  async function stop() {
    if (!running || busy) return;
    setBusy(true);
    const elapsedMs = Date.now() - running.startedAt;
    const minutes = Math.max(1, Math.round(elapsedMs / 60000));
    localStorage.removeItem(KEY);
    setRunning(null);
    broadcast();
    try {
      await fetch("/api/entries/increment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackerId, date: running.date, minutes }),
      });
      onSaved();
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
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-sm font-medium text-white tabular-nums hover:bg-red-700 disabled:opacity-50"
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
      className="shrink-0 rounded-md border border-edge px-2.5 py-1.5 text-sm text-secondary hover:bg-background disabled:opacity-30"
      title={blocked ? "Another timer is running" : "Start timer"}
    >
      ▶ Timer
    </button>
  );
}
