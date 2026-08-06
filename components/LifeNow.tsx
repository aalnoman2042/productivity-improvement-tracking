"use client";

import { useEffect, useState } from "react";
import { prettyDate, toDateStr } from "@/lib/dates";
import { useCached } from "@/lib/useCached";
import { COACH_COOLDOWN_MS, type CoachReview } from "@/lib/coach";

type Stored = {
  review: CoachReview | null;
  text: string;
  today: string | null;
  createdAt: string;
} | null;

/**
 * 🧠 Life right now — the AI coach's read of the whole picture.
 *
 * Strictly on demand, once every 8 hours: the page only ever *reads* the
 * last stored analysis (free, instant, works offline); the AI runs when the
 * button is pressed and the server allows it. Only numbers and tracker
 * names are sent — no notes.
 */
export default function LifeNow() {
  const q = useCached<Stored>("/api/coach", "aiReview");
  const stored = q.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A clock the countdown can read *purely* — same pattern as the timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The countdown the server will enforce anyway, shown up front.
  const waitMs = stored
    ? new Date(stored.createdAt).getTime() + COACH_COOLDOWN_MS - now
    : 0;
  const coolingDown = waitMs > 0;
  const waitLabel = (() => {
    const h = Math.floor(waitMs / 3_600_000);
    const m = Math.ceil((waitMs % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  async function analyze() {
    if (busy || coolingDown) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today: toDateStr(new Date()) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not analyze");
      q.update(data as Stored);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to run the analysis"
      );
    } finally {
      setBusy(false);
    }
  }

  const review = stored?.review ?? null;

  return (
    <section className="rounded-lg border border-accent/40 card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">🧠 Life right now</h2>
          <p className="mt-0.5 text-sm text-secondary">
            {stored
              ? `The coach's read of your data${stored.today ? `, as of ${prettyDate(stored.today)}` : ""}.`
              : "An honest AI read of your whole record — what's working, what's slipping, what to fix first."}
          </p>
          <p className="mt-1 text-xs text-muted">
            We use a personal AI model to monitor your lifestyle — it only ever
            sees your numbers and tracker names, never your notes.
          </p>
        </div>
        <button
          onClick={analyze}
          disabled={busy || coolingDown}
          title={coolingDown ? "The coach reads your life once every 8 hours" : undefined}
          className="shrink-0 rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy
            ? "Reading your life…"
            : coolingDown
              ? `Next read in ${waitLabel}`
              : stored
                ? "Analyze again"
                : "Analyze my life"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {review ? (
        <div className="mt-4 space-y-4">
          {/* The whole read, in a line */}
          <blockquote className="border-l-4 border-accent pl-3">
            <p className="text-base font-semibold leading-snug">
              {review.headline}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-secondary">
              {review.verdict}
            </p>
          </blockquote>

          <div className="grid gap-3 sm:grid-cols-2">
            {review.working.length > 0 && (
              <div className="rounded-md border border-green-700/40 bg-green-700/5 p-3">
                <h3 className="text-sm font-semibold text-green-700 dark:text-green-500">
                  ✓ Working
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {review.working.map((p, i) => (
                    <li key={i} className="text-sm">
                      <p>{p.point}</p>
                      {p.evidence && (
                        <p className="mt-0.5 text-xs tabular-nums text-muted">
                          {p.evidence}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review.slipping.length > 0 && (
              <div className="rounded-md border border-amber-600/40 bg-amber-600/5 p-3">
                <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-500">
                  ⚠ Slipping
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {review.slipping.map((p, i) => (
                    <li key={i} className="text-sm">
                      <p>{p.point}</p>
                      {p.evidence && (
                        <p className="mt-0.5 text-xs tabular-nums text-muted">
                          {p.evidence}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-md border border-accent/50 bg-accent/5 p-3">
            <h3 className="text-sm font-semibold text-accent">🎯 Fix first</h3>
            <p className="mt-1 text-sm">{review.fix.what}</p>
            <p className="mt-1.5 text-sm text-secondary">
              <span className="font-medium text-foreground">Tonight: </span>
              {review.fix.tonight}
            </p>
          </div>
        </div>
      ) : (
        stored?.text && (
          // An older plain-text review (or one the parser couldn't read).
          <div className="mt-3 space-y-3 border-t border-edge pt-3">
            {stored.text
              .split(/\n+/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((paragraph, i) => (
                <p key={i} className="text-sm leading-relaxed text-secondary">
                  {paragraph}
                </p>
              ))}
          </div>
        )
      )}
    </section>
  );
}
