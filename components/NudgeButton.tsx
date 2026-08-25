"use client";

import { useState } from "react";

/**
 * Send one person the message in the box above, right now.
 *
 * The button is only as honest as the device count behind it: push either
 * reaches a browser that granted permission or it reaches nothing at all, and
 * an admin tapping into silence would have no way to tell which happened. So
 * an account with no subscription says so *before* the tap, and a send that
 * the push service refuses says so after it.
 *
 * Whether their nightly reminder is switched on has nothing to do with it —
 * that switch is about the schedule, and this is a message sent by hand.
 */
export default function NudgeButton({
  userId,
  name,
  message,
  devices,
}: {
  userId: string;
  name: string;
  message: string;
  devices: number;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const reachable = devices > 0;
  const busy = state === "sending";

  async function send() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/admin/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Failed (${res.status})`);
      setState("sent");
      // Long enough to read, short enough that the row is ready for the next
      // one — a button stuck on "sent" hides whether the second tap worked.
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Couldn't send it");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={send}
        disabled={!reachable || busy}
        aria-label={`Send ${name} a notification`}
        title={
          reachable
            ? `${devices} device${devices === 1 ? "" : "s"} subscribed`
            : "No device of theirs has allowed notifications"
        }
        className="rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-secondary hover:bg-surface-2 disabled:opacity-40"
      >
        {state === "sent" ? "✓ Sent" : busy ? "Sending…" : "🔔 Nudge"}
      </button>
      {!reachable && (
        <span className="text-xs text-muted">no device</span>
      )}
      {error && (
        <span className="max-w-44 text-right text-xs text-red-600">{error}</span>
      )}
    </div>
  );
}
