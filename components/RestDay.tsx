"use client";

import { useEffect, useState } from "react";
import { MAX_REST_REASON } from "@/lib/rest";

/**
 * "I meant to take today off."
 *
 * The one control in this app that records *nothing* and changes no number.
 * Days logged, the score, the goals and the grades all read exactly the same
 * after it as before — what it changes is only whether a run is allowed to
 * step over the gap (`lib/rest`).
 *
 * It exists because the alternative is worse. An app that cannot tell a
 * planned Sunday from the week you gave up will scold you for the Sunday,
 * and the way people answer that is by logging something they didn't do.
 * A rest day is the honest version of the same relief: the day stays empty
 * and says so.
 *
 * Deliberately quiet in the interface — a small line under the date, not a
 * button competing with logging. Taking days off should be possible, not
 * encouraged.
 */
export default function RestDay({ date }: { date: string }) {
  const [rest, setRest] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    // Deferred a microtask: the answer for a new date is only known after a
    // round trip anyway, and this keeps every setState out of the effect
    // body itself — the rule the React Compiler enforces here.
    void Promise.resolve().then(() => {
      if (!live) return;
      setRest(null);
      setAsking(false);
    });
    fetch(`/api/rest?from=${date}&to=${date}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { days: { date: string; reason: string | null }[] }) => {
        if (!live) return;
        const row = body.days.find((r) => r.date === date) ?? null;
        setRest(Boolean(row));
        setReason(row?.reason ?? null);
      })
      // A flag that can't be read is not worth an error on the log page —
      // the day itself still works, which is what this screen is for.
      .catch(() => live && setRest(false));
    return () => {
      live = false;
    };
  }, [date]);

  async function save(next: boolean, why?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, rest: next, reason: why ?? null }),
      });
      if (!res.ok) return;
      setRest(next);
      setReason(next ? (why?.trim() || null) : null);
      setAsking(false);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  // Nothing at all until the answer is known: a control that flips from off
  // to on a moment after the page paints invites a tap on the wrong state.
  if (rest === null) return null;

  if (!rest) {
    return asking ? (
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_REST_REASON}
          placeholder="Why? (optional — travel, illness, a day off)"
          aria-label="Why this day is off"
          className="min-w-48 flex-1 rounded-md border border-edge bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(true, draft)}
          className="rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          Mark it off
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-md text-xs font-medium text-muted hover:text-secondary hover:underline"
      >
        🌙 Taking this day off?
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-edge bg-surface-2 px-3 py-2">
      <span className="text-sm font-medium">🌙 A day off, on purpose</span>
      {reason && <span className="min-w-0 text-sm text-secondary">— {reason}</span>}
      <span className="text-xs text-muted">
        Counts for nothing; breaks nothing.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void save(false)}
        className="ml-auto rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-40"
      >
        Undo
      </button>
    </div>
  );
}
