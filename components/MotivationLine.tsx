"use client";

import { useEffect, useSyncExternalStore } from "react";
import { BUNDLED, pick, type Line } from "@/lib/motivation";
import { cacheGet, cacheSet, cacheSnapshot, subscribeCache } from "@/lib/sync";

const POOL_KEY = "motivation-pool";
const FETCHED_KEY = "motivation-fetched-at";

/** Top the pool up at most once a day — these lines don't go stale quickly. */
const REFRESH_MS = 24 * 60 * 60_000;

type Pool = { lines: Line[] };

/**
 * The chosen line, memoised against the pool it came from.
 *
 * `useSyncExternalStore` requires a snapshot that returns the *same* value
 * until something actually changes — picking at random on every call would
 * spin the renderer forever. `cacheSnapshot` already hands back an identical
 * object while the stored text is unchanged, so that identity is what the
 * choice is keyed on: the line stays put until a new pool is fetched.
 */
let chosen: { from: unknown; line: Line } | null = null;

function currentLine(): Line {
  const pool = cacheSnapshot<Pool>(POOL_KEY);
  if (chosen && chosen.from === pool) return chosen.line;
  const lines = pool?.lines?.length ? pool.lines : BUNDLED;
  chosen = { from: pool, line: pick(lines, chosen?.line.text) };
  return chosen.line;
}

// The server has no pool and no randomness — it renders nothing here, and the
// line appears on hydration.
const noLine = () => null;

/**
 * The one line that never rotates, and a line to read under it.
 *
 * **Giving up is not in the blood.** That one is the owner's, it is fixed,
 * and it is set in the brand gradient because it is the only sentence in the
 * app that is not about the data — it is the reason the data exists. It
 * renders on the server too, so it is on screen from the very first frame of
 * a load rather than appearing on hydration like the quote below it.
 *
 * The rotating line below it deliberately never fetches on the way to showing
 * something. A skeleton is on screen for a few hundred milliseconds and a
 * quote API takes longer than that, so a line requested now would arrive
 * after the spinner had gone. The pool is filled in the background *after* a
 * page has settled and kept in `localStorage`; showing one is then just an
 * array lookup.
 *
 * Which means it works offline, and the first ever load — before anything has
 * been fetched — still gets a line, from the bundled set.
 */

/** Fixed, never rotated, never fetched. */
const CREED = "Giving up is not in the blood.";
export default function MotivationLine({
  className = "",
}: {
  className?: string;
}) {
  const line = useSyncExternalStore(subscribeCache, currentLine, noLine);

  // Refill afterwards, and only when this page isn't busy — the whole point
  // is that the network is never between you and the screen.
  useEffect(() => {
    const last = Number(cacheGet<number>(FETCHED_KEY) ?? 0);
    if (Date.now() - last < REFRESH_MS) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/motivation");
        if (!res.ok) return;
        const data = (await res.json()) as Pool;
        if (cancelled || !Array.isArray(data.lines) || data.lines.length === 0) return;
        cacheSet(POOL_KEY, { lines: data.lines });
        cacheSet(FETCHED_KEY, Date.now());
      } catch {
        // Offline or the route is unhappy. The pool we already have is fine.
      }
    };

    // `requestIdleCallback` where it exists, a timeout where it doesn't
    // (Safari) — either way, after the page that's loading has finished.
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle = idle
      ? idle(() => void run(), { timeout: 4000 })
      : window.setTimeout(() => void run(), 2000);

    return () => {
      cancelled = true;
      if (!idle) clearTimeout(handle);
    };
  }, []);

  return (
    // Decoration for a wait, not content. A screen reader announcing a quote
    // every time a page loads would be noise.
    <div className={`animate-fade-in text-center ${className}`} aria-hidden="true">
      <p className="text-brand-gradient text-base font-semibold tracking-tight">
        {CREED}
      </p>
      {/* The rotating line is null on the server and on the very first client
          render — the creed above carries the wait until it arrives. */}
      {line && (
        <p className="mt-1.5 text-sm text-muted">
          <span className="italic">{line.text}</span>
          {line.author && <span className="not-italic"> — {line.author}</span>}
        </p>
      )}
    </div>
  );
}
