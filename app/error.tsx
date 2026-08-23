"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * When a screen breaks.
 *
 * Until this file existed, an unexpected error anywhere below the root layout
 * showed the framework's own error screen — a bare "Application error: a
 * client-side exception has occurred" on a white page, which tells the reader
 * nothing and offers them nothing. For an app someone opens at midnight to
 * log a day, that is the difference between a hiccup and "it's broken".
 *
 * The one thing worth saying here is the thing that is actually true: **your
 * log is safe**. Writes go through the offline queue in `lib/sync`, so
 * anything typed before the error is either already sent or still waiting on
 * the device to be sent — a crashed screen cannot lose a day.
 *
 * `unstable_retry()` re-fetches and re-renders this boundary's children,
 * which is the right first move: most errors here are a failed request, not
 * a broken page. (`reset()` also exists in this version and only clears the
 * error state without re-fetching — nearly never what you want.)
 *
 * One class of error is handled without asking, because retrying in place
 * cannot fix it: a **chunk that failed to load**. It happens minutes after a
 * deploy, when the page's HTML is new and one of the script files it wants
 * is momentarily unreachable — the service worker then answers with a 503
 * where JavaScript should be, and React throws. The page is not broken and
 * nothing is wrong with the data; the tab is simply holding half an old app.
 * A full reload fixes it every time, so this does one, once, guarded by a
 * flag in sessionStorage so a genuinely broken deploy can't put a tab into a
 * refresh loop.
 */

/** Did the app fail to fetch its own code? */
function isChunkError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(
      error.message
    )
  );
}

const RELOAD_FLAG = "pit_chunk_reload";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const chunk = isChunkError(error);

  useEffect(() => {
    // No error-reporting service here on purpose — this app sends nothing
    // anywhere. The console is where the owner looks, and the digest is what
    // matches it to a server log on Vercel.
    console.error("PIT screen error:", error);

    if (!chunk) return;
    let already = "1";
    try {
      already = sessionStorage.getItem(RELOAD_FLAG) ?? "";
      sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      // No sessionStorage (private mode, blocked storage) means no way to
      // remember having tried, and a reload loop is worse than this screen.
      return;
    }
    if (already) return;

    // No state to set: this tab is about to be replaced by a fresh one.
    window.location.reload();
  }, [error, chunk]);

  // Clear the flag on a screen that rendered fine, so the *next* deploy gets
  // its own single retry rather than inheriting this one's.
  useEffect(() => {
    if (chunk) return;
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* nothing to clear */
    }
  }, [chunk]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <div className="rounded-xl border border-edge card p-6 shadow-sm">
        <h1 className="text-lg font-bold tracking-tight">
          {chunk
            ? "Loading the latest version…"
            : "Something went wrong on this screen"}
        </h1>
        <p className="mt-2 text-sm text-secondary">
          {chunk
            ? "This tab was holding part of an older version of the app — which happens for a minute or two after an update. Reloading picks up the new one. Nothing you logged is affected."
            : "Nothing you logged is lost — anything saved is already on its way, or waiting on this device until it can be. Trying again usually works, since most of these are a request that didn't come back."}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() =>
              chunk ? window.location.reload() : unstable_retry()
            }
            className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            {chunk ? "Reload" : "Try again"}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
          >
            Back to today
          </Link>
        </div>

        {/* The digest is the only handle on what actually happened once this
            is running on Vercel — it matches this screen to a server log. */}
        {error.digest && (
          <p className="mt-4 border-t border-edge pt-3 text-xs text-muted">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
