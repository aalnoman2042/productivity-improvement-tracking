"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { flush, getQueue, post } from "./sync";

const KEY = "pit_timer";
const CHANGE = "pit-timer-change";
const PATH = "/api/timer";

/** How often an open, visible screen re-asks whose timer is running. */
const PULL_MS = 20_000;

/** Focus and visibilitychange fire together on a wake; that is one ask. */
const DEDUPE_MS = 3_000;

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
 * The one running timer.
 *
 * **The server holds it** (`/api/timer`); localStorage is this device's copy.
 * That is the whole point of the split. A timer that lived only in the
 * browser it was started in was a timer you could not stop from anywhere
 * else: shut the laptop and it kept counting, out of reach of the phone in
 * your pocket, until the machine came back hours later still ticking.
 *
 * Now the phone asks the server what is running and is handed the laptop's
 * timer. Stopping it there stops it everywhere.
 *
 * localStorage stays for the two jobs it is still the right tool for:
 * painting the clock immediately on load rather than after a round trip, and
 * keeping a timer running through a tunnel with no signal. It is the cache,
 * not the truth — when the server is reachable the server wins, **including
 * when it says nothing is running**. That last part is what takes a stopped
 * timer off the laptop's screen.
 *
 * Reading it is a `useSyncExternalStore` over a snapshot memoised against the
 * raw text, so an unchanged value keeps its identity — which is what that
 * hook needs to not re-render forever.
 *
 * There is deliberately only one, here and in the unique index on the
 * collection: two stopwatches counting the same hour is how a day ends up
 * with twenty-six of them in it.
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

/** Older stored timers carry no kind; they were all stopwatches. */
export function kindOf(running: Running | null | undefined): TimerKind | null {
  return running ? running.kind ?? "duration" : null;
}

/** One field order, so an unchanged timer is recognisably unchanged. */
function normalise(r: Running): Running {
  return {
    trackerId: r.trackerId,
    date: r.date,
    startedAt: r.startedAt,
    kind: kindOf(r) ?? "duration",
  };
}

/** Write this device's copy, and tell the screen only if something moved. */
function writeLocal(next: Running | null): void {
  const raw = next === null ? null : JSON.stringify(next);
  try {
    if (localStorage.getItem(KEY) === raw) return;
    if (raw === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, raw);
  } catch {
    return;
  }
  broadcast();
}

/* --------------------------- the server's copy ------------------------- */

/**
 * Bumped by every start and stop pressed here, and again once the server has
 * been told. An answer that crossed one of those was written by a server
 * that had not heard yet, so it is dropped rather than allowed to undo the
 * press that overtook it.
 */
let acts = 0;
let lastPullAt = 0;

/** A start or a stop typed with no signal is still on its way. */
function queued(): boolean {
  return getQueue().some((j) => j.path === PATH);
}

function fromServer(value: unknown): Running | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<Running>;
  if (typeof r.trackerId !== "string" || typeof r.date !== "string") return null;
  if (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt)) return null;
  return normalise(r as Running);
}

async function pull(): Promise<void> {
  lastPullAt = Date.now();
  // Anything queued is newer than what the server can currently say.
  if (queued()) return;
  const seen = acts;
  try {
    const res = await fetch(PATH, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { running?: unknown };
    // Start or stop was pressed on this device while we were asking.
    if (acts !== seen || queued()) return;
    writeLocal(fromServer(data.running));
  } catch {
    /* offline — this device's copy stands, and keeps counting */
  }
}

/** Ask again, unless we asked a moment ago. */
function revalidate(): void {
  if (Date.now() - lastPullAt < DEDUPE_MS) return;
  void pull();
}

async function push(body: unknown): Promise<void> {
  let refused = false;
  try {
    // Queues itself when there is no signal, and is replayed in order — so a
    // start and the stop that follows it arrive the right way round.
    await post(PATH, body);
  } catch {
    refused = true;
  }
  // The server has been told now; a reply still in flight has not.
  acts++;
  if (refused) {
    // A 4xx — the tracker was deleted on another device, say. The server
    // will never hold this timer, and a clock ticking here that no other
    // device can see is the exact thing this file exists to end.
    await pull();
  }
}

/* ------------------------- one poller, not two ------------------------- */

let watchers = 0;
let release: (() => void) | null = null;

/**
 * The daily page mounts a stopwatch per time tracker and a nap panel per
 * sleep row, and every one of them reads this store — so the listeners and
 * the interval are counted, not per component. Otherwise a page of trackers
 * is a page of pollers all asking the same question.
 */
function attach(): () => void {
  watchers += 1;
  if (watchers === 1) {
    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";
    const onWake = () => {
      if (visible()) revalidate();
    };
    const onOnline = () => {
      // Deliver what was typed offline first, so the answer that follows is
      // read from a server that already knows about it.
      void flush().then(() => pull());
    };

    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onOnline);
    const id = setInterval(onWake, PULL_MS);

    release = () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onOnline);
      clearInterval(id);
    };
    void pull();
  }
  return () => {
    watchers -= 1;
    if (watchers === 0) {
      release?.();
      release = null;
    }
  };
}

/* -------------------------------- hooks -------------------------------- */

/** The timer running right now, on any tracker — null when none is. */
export function useRunning(): Running | null {
  const running = useSyncExternalStore(subscribeRunning, readRunning, noRunning);
  useEffect(attach, []);
  return running;
}

export function startTimer(next: Running): void {
  const running = normalise(next);
  writeLocal(running);
  acts++;
  void push(running);
}

export function clearTimer(): void {
  // Read it before dropping it: a stop names the timer it was pressed on, so
  // one that has to wait for signal can only ever remove that same timer and
  // never a fresh one begun in the meantime.
  const was = readRunning();
  writeLocal(null);
  acts++;
  void push({ stop: true, startedAt: was?.startedAt ?? null });
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
