"use client";

import { useState } from "react";
import { toDateStr } from "@/lib/dates";
import { useCached } from "@/lib/useCached";
import { useNearViewport } from "@/lib/useNearViewport";
import type { CoachReview } from "@/lib/coach";

/**
 * Your weeks, kept.
 *
 * The coach card answers "how am I doing right now" and forgets — eight
 * hours later the last read is gone. This is the other half: one review per
 * finished week, written once and stored, so a year of them can be read back
 * like a diary the app wrote about you.
 *
 * It is a section of the Status page rather than a tab of its own, for the
 * reason the shelf taught: a tab is for something opened daily, and this is
 * opened when someone wants the long view.
 */

type Entry = {
  week: { start: string; end: string };
  title: string;
  review: CoachReview | null;
  text: string;
  digest: string[] | null;
  createdAt: string;
};

type Data = {
  reviews: Entry[];
  pending: { start: string; end: string; title: string } | null;
};

const STATE_LOOK: Record<string, string> = {
  thriving: "border-green-700/40 bg-green-700/10 text-green-700 dark:text-green-500",
  steady: "border-accent/40 bg-accent/10 text-accent",
  slipping: "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500",
  stalled: "border-red-600/40 bg-red-600/10 text-red-600",
};

function ReviewBody({ entry }: { entry: Entry }) {
  const r = entry.review;
  // A row written before the structured shape, or a generation that came
  // back malformed, still reads as what it is: prose.
  if (!r) return <p className="text-sm whitespace-pre-wrap">{entry.text}</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-secondary">{r.verdict}</p>

      {r.working.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            ✓ Held up
          </p>
          <ul className="mt-1 space-y-1">
            {r.working.map((p, i) => (
              <li key={i} className="text-sm">
                {p.point}
                {p.evidence && <span className="text-muted"> — {p.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.slipping.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            ⚠ Gave way
          </p>
          <ul className="mt-1 space-y-1">
            {r.slipping.map((p, i) => (
              <li key={i} className="text-sm">
                {p.point}
                {p.evidence && <span className="text-muted"> — {p.evidence}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
        <p className="text-sm font-medium">{r.fix.what}</p>
        <p className="mt-1.5 text-sm text-secondary">
          <span className="font-semibold text-accent">First step · </span>
          {r.fix.tonight}
        </p>
        {r.week && r.week.length > 0 && (
          <ol className="mt-2 space-y-1">
            {r.week.map((move, i) => (
              <li key={i} className="text-sm text-secondary">
                {i + 1}. {move}
              </li>
            ))}
          </ol>
        )}
      </div>

      {entry.digest && entry.digest.length > 0 && (
        <ul className="border-t border-edge pt-2">
          {entry.digest.map((line, i) => (
            <li key={i} className="text-xs text-muted">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The section sits at the very bottom of a long page, and asking the server
 * for a year of reviews the instant Status opens means that request shares
 * the connection with the ones painting the top of the screen. It waits
 * until it is nearly scrolled to — by which time it has usually already
 * arrived — so the reader never learns it was ever late.
 */
export default function WeeklyReviews() {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  return <div ref={ref}>{near ? <Reviews /> : null}</div>;
}

function Reviews() {
  // Read once, in an initializer: which week is over is the reader's clock,
  // and a date that changes under the cache key would refetch for ever.
  const [today] = useState(() => toDateStr(new Date()));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Through the cache like every other read on this page, so a stored week
  // is on screen before the network answers — and offline, it still is.
  const q = useCached<Data>(`/api/coach/weekly?today=${today}`, "weeklyReviews");
  const data = q.data;

  async function write() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coach/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't write that review — try again");
        return;
      }
      await q.refresh();
      if (body?.week?.end) setOpen(String(body.week.end));
    } finally {
      setBusy(false);
    }
  }

  // Nothing written and nothing to write means a new account: the card would
  // be explaining a feature that can't do anything yet.
  if (!data || (data.reviews.length === 0 && !data.pending)) return null;

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">📖 Weeks in review</h2>
      <p className="mt-1 text-sm text-secondary">
        One read per finished week, kept for good — so you can see what a
        month ago actually looked like, not just today.
      </p>

      {data.pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
          <span className="text-sm">
            <strong>{data.pending.title}</strong> is finished and unread.
          </span>
          <button
            onClick={write}
            disabled={busy}
            className="ml-auto shrink-0 rounded-md bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Reading the week…" : "Write it"}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {data.reviews.length > 0 && (
        <ul className="mt-3 space-y-2">
          {data.reviews.map((entry) => {
            const isOpen = open === entry.week.end;
            const state = entry.review?.state;
            return (
              <li
                key={entry.week.end}
                className="rounded-lg border border-edge bg-surface-2"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : entry.week.end)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 p-3 text-left"
                >
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                    {entry.title}
                  </span>
                  {state && (
                    <span
                      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATE_LOOK[state] ?? ""}`}
                    >
                      {state}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {entry.review?.headline ?? "Week in review"}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-edge p-3">
                    <ReviewBody entry={entry} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
