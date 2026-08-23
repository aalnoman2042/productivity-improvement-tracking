"use client";

/**
 * A screen that couldn't fetch what it is about.
 *
 * Distinct from `app/error.tsx`, which catches a page that *threw*: this is
 * the ordinary case of a request that didn't come back, on a screen that is
 * otherwise perfectly fine. It matters because `useCached` paints the last
 * copy first — so when there is no last copy, a failed load leaves a skeleton
 * that never resolves, and the app looks hung rather than offline.
 *
 * One component rather than three copies of the same markup, because the
 * three screens that need it were already drifting: the dashboard had it,
 * Status and History silently had nothing.
 */
export default function LoadError({
  message,
  onRetry,
  what = "this",
}: {
  message?: string | null;
  onRetry: () => void;
  /** What failed, for the sentence: "couldn't load your month". */
  what?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-edge p-8 text-center">
      <p className="text-sm font-medium">Couldn&apos;t load {what}</p>
      <p className="mt-1 text-sm text-secondary">
        {/* The server's own words when there are any — "Unauthorized" and
            "Failed to fetch" call for different responses from the reader. */}
        {message || "The request didn't come back. You may be offline."}
      </p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:bg-surface-2"
      >
        Try again
      </button>
    </div>
  );
}
