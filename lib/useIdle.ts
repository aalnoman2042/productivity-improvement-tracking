"use client";

import { useEffect, useState } from "react";

/**
 * "Has the page finished the work the reader was waiting for?"
 *
 * The companion to `useNearViewport`. That one defers what is off-screen;
 * this defers what is *on* screen but secondary — a card at the top of a page
 * that answers a question nobody opened the page to ask.
 *
 * The case it was written for: the Trackers page exists to show your
 * trackers. The quiet-tracker check sits above that list, and if it fetches
 * on mount it competes with the list itself for the one connection a phone
 * has — so the thing you came for arrives later because of the thing you
 * didn't. Waiting for idle costs the secondary card a few hundred
 * milliseconds nobody is watching and costs the list nothing.
 *
 * `requestIdleCallback` is not in Safari before 17, hence the timeout — and
 * the timeout is also the ceiling on the idle callback itself, because a page
 * that never goes idle must still eventually show the card.
 */
export function useIdle(timeout = 1200): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (idle) return;
    type WithIdle = {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as unknown as WithIdle;

    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => setIdle(true), timeout);
    return () => clearTimeout(t);
  }, [idle, timeout]);

  return idle;
}
