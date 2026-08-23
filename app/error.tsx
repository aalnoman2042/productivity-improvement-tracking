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
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // No error-reporting service here on purpose — this app sends nothing
    // anywhere. The console is where the owner looks, and the digest is what
    // matches it to a server log on Vercel.
    console.error("PIT screen error:", error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <div className="rounded-xl border border-edge card p-6 shadow-sm">
        <h1 className="text-lg font-bold tracking-tight">
          Something went wrong on this screen
        </h1>
        <p className="mt-2 text-sm text-secondary">
          Nothing you logged is lost — anything saved is already on its way, or
          waiting on this device until it can be. Trying again usually works,
          since most of these are a request that didn&apos;t come back.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => unstable_retry()}
            className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            Try again
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
