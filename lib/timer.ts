"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const KEY = "pit_timer";
const CHANGE = "pit-timer-change";

/**
 * What a running timer is counting. "duration" is the stopwatch on a time
 * tracker — its minutes go straight to the server when it stops. "nap" is
 * the one on a sleep row, and its minutes are handed back to the day being
 * typed, because a nap is stored *inside* the night's entry rather than
 * added to a total of its own.
 */
export type TimerKind = "duration" | "nap";

export type Running = {
  trackerId: string;
  date: string;
  startedAt: number;
  /** Absent on a timer started before naps existed — those were durations. */
  kind?: TimerKind;
};

/**
 * The running timer as an external store: localStorage is the source of
 * truth (it survives refreshes and is shared across tabs), and the snapshot
 * is memoised against the raw text so an unchanged value keeps its identity
 * — which is what `useSyncExternalStore` needs to not re-render forever.
 *
 * There is deliberately only one: two stopwatches counting the same hour is
 * how a day ends up with twenty-six of them in it.
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

function broadcast() {
  window.dispatchEvent(new Event(CHANGE));
}

/** The timer running right now, on any tracker — null when none is. */
export function useRunning(): Running | null {
  return useSyncExternalStore(subscribeRunning, readRunning, noRunning);
}

/** Older stored timers carry no kind; they were all stopwatches. */
export function kindOf(running: Running | null | undefined): TimerKind | null {
  return running ? running.kind ?? "duration" : null;
}

export function startTimer(next: Running): void {
  localStorage.setItem(KEY, JSON.stringify(next));
  broadcast();
}

export function clearTimer(): void {
  localStorage.removeItem(KEY);
  broadcast();
}

/**
 * A session's minutes. Never zero: a timer that ran at all recorded
 * something, and rounding a real minute away teaches you not to use it.
 */
export function elapsedMinutes(startedAt: number, now = Date.now()): number {
  return Math.max(1, Math.round((now - startedAt) / 60000));
}

/** "12:05" while it's under an hour, "1:02:05" after. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `Date.now()`, re-read every second while `active` — for the ticking face. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** The wall-clock time a timer began, as the "HH:MM" the day stores. */
export function startedAtClock(startedAt: number): string {
  const d = new Date(startedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
