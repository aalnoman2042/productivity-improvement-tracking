"use client";

import { useState } from "react";

/**
 * Switch one account's premium access on or off.
 *
 * "Premium" here means the two features with a bill attached: the **AI
 * coach** and the **health page**, which reads what a person's trackers mean
 * with the same shared free-tier allowance. Everything else in PIT — the
 * log, the charts, the score, the grades, the export — is arithmetic on
 * somebody's own numbers and is not gated by this or by anything else.
 *
 * The flag is stored as `invited`, and an **absent** field reads as invited
 * (`lib/access.ts`) because every account that predates the field was created
 * with a code. So switching somebody off writes `false` explicitly rather
 * than clearing anything: clearing it would switch them straight back on.
 *
 * Optimistic, with a real undo on failure. The row is the only feedback there
 * is, and a toggle that flips back a second later is more honest than one
 * that stays put and quietly did nothing.
 */
export default function PremiumToggle({
  userId,
  name,
  invited,
  onChange,
}: {
  userId: string;
  name: string;
  invited: boolean;
  onChange: (invited: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !invited;
    setBusy(true);
    setError(null);
    // Flip first: the round trip is the only slow part and the answer is
    // nearly always yes.
    onChange(next);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, invited: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`);
    } catch (err) {
      onChange(invited);
      setError(err instanceof Error ? err.message : "Couldn't change it");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={invited}
        aria-label={`Premium access for ${name}`}
        onClick={() => void toggle()}
        disabled={busy}
        title={
          invited
            ? "AI coach and health page are on for this account"
            : "AI coach and health page are off for this account"
        }
        className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 ${
          invited
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-edge text-muted hover:bg-surface-2"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${
            invited ? "bg-accent" : "bg-surface-2 border border-edge"
          }`}
        >
          <span
            className={`block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
              invited ? "translate-x-3" : ""
            }`}
          />
        </span>
        {invited ? "Premium" : "Off"}
      </button>
      {error && (
        <span className="max-w-44 text-right text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
