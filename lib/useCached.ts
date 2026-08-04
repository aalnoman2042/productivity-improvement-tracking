"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cacheSet, cacheSnapshot, flush, subscribeCache } from "./sync";

/**
 * When each key was last read from the server, shared across every component
 * using it — two screens reading the same key shouldn't both go and ask.
 */
const lastRead = new Map<string, number>();

/** Don't ask again this soon; a tab switch shouldn't mean a request. */
const DEDUPE_MS = 10_000;

/** How often an open, visible screen quietly checks for changes. */
const POLL_MS = 60_000;

export type Cached<T> = {
  data: T | null;
  /** Nothing to show yet — no cached copy and the first request is in flight. */
  loading: boolean;
  /** Something is on screen and a request is in flight behind it. */
  refreshing: boolean;
  /** What's on screen came from the last visit, not from this request. */
  stale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Overwrite what's on screen and in the cache, without a round trip. */
  update: (value: T) => void;
};

/**
 * Read an endpoint, but paint the copy from last time first.
 *
 * Waiting for the network before drawing anything is what made opening the app
 * feel slow: every screen was a spinner for as long as the round trip took.
 * Here the cached copy goes up immediately and the fresh one replaces it when
 * it lands — usually without a visible change, because most of the time
 * nothing has moved.
 *
 * The cache is the single source of truth for what's on screen: a response is
 * written to it and the subscription pushes it back out, so two screens
 * reading the same key can't disagree. Reading it through
 * `useSyncExternalStore` also keeps the server-rendered HTML and the first
 * client render in agreement — on the server the snapshot is simply null.
 *
 * The bookkeeping is stored *per key* rather than reset when the key changes,
 * so switching (dashboard periods, say) never shows one key's state against
 * another key's data.
 */
export function useCached<T>(path: string, key: string): Cached<T> {
  const data = useSyncExternalStore(
    subscribeCache,
    () => cacheSnapshot<T>(key),
    () => null
  );

  const [settledFor, setSettledFor] = useState<string | null>(null);
  const [freshFor, setFreshFor] = useState<string | null>(null);
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(
    null
  );

  // Bumped on every request, so a slow reply for an old key can't overwrite a
  // newer one.
  const token = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++token.current;
    setBusyFor(key);
    try {
      const res = await fetch(path);
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const fresh = (await res.json()) as T;
      if (id !== token.current) return;
      lastRead.set(key, Date.now());
      cacheSet(key, fresh); // pushes the new value out to every reader
      setFreshFor(key);
      setFailure(null);
    } catch {
      if (id !== token.current) return;
      // Offline, or the server stumbled. Whatever was cached stays on screen,
      // flagged as stale; only a screen with nothing to show reports an error.
      if (cacheSnapshot<T>(key) === null) {
        setFailure({ key, message: "Couldn't load — check your connection" });
      }
    } finally {
      if (id === token.current) {
        setBusyFor(null);
        setSettledFor(key);
      }
    }
  }, [path, key]);

  useEffect(() => {
    let cancelled = false;
    // Out of the effect's synchronous phase: marking the request in flight is
    // a state update, and doing it mid-effect would cascade a second render
    // before the browser has drawn the first.
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** Refresh, unless we asked very recently. */
  const revalidate = useCallback(() => {
    const since = Date.now() - (lastRead.get(key) ?? 0);
    if (since < DEDUPE_MS) return;
    void refresh();
  }, [refresh, key]);

  // Keep what's on screen live: check again when you come back to the tab,
  // when the connection returns, and quietly on a timer while you're looking
  // at it. That's what makes a change on your phone show up on your laptop
  // without a reload.
  useEffect(() => {
    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";

    const onWake = () => {
      if (visible()) revalidate();
    };

    const onOnline = () => {
      // Send anything typed while offline first, so the refresh that follows
      // reads back a server that already has it.
      void flush().then(() => refresh());
    };

    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onOnline);
    const timer = setInterval(onWake, POLL_MS);

    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [revalidate, refresh]);

  const update = useCallback(
    (value: T) => {
      cacheSet(key, value);
      setFreshFor(key);
    },
    [key]
  );

  return {
    data,
    loading: data === null && settledFor !== key,
    refreshing: busyFor === key,
    stale: data !== null && freshFor !== key,
    error: failure?.key === key ? failure.message : null,
    refresh,
    update,
  };
}

/**
 * A small preference kept in localStorage — read the same way, so it survives
 * a reload without the server and the client disagreeing on the first render.
 */
export function useStored<T>(key: string, fallback: T): [T, (value: T) => void] {
  const stored = useSyncExternalStore(
    subscribeCache,
    () => cacheSnapshot<T>(key),
    () => null
  );
  const set = useCallback((value: T) => cacheSet(key, value), [key]);
  return [stored ?? fallback, set];
}
