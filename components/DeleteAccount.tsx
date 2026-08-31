"use client";

import { useState } from "react";

/**
 * The way out.
 *
 * Every app should have one, it should be findable, and it should be hard to
 * do by accident and impossible to do by mis-tap. So: a closed card that has
 * to be opened, then the current password, then the exact phrase typed out.
 * Three deliberate acts, and the last of them makes you write the sentence.
 *
 * It is also honest about what happens, which is the part most apps fudge.
 * There is no thirty-day grace period here — a grace period means the data
 * was not deleted — so the card says the word *permanently*, lists what goes,
 * and points at the export button sitting directly above it. Somebody who
 * wanted a backup and did not get one has been failed by the copy, not by
 * the button.
 */

const PHRASE = "delete my account";

export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = confirm.trim().toLowerCase() === PHRASE && password.length > 0;

  async function destroy() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not delete the account");
      // Everything local belonged to an account that no longer exists —
      // cached reads, queued writes, preferences. A hard reload to the
      // signed-out page is the only state left that makes sense.
      try {
        localStorage.clear();
      } catch {
        /* a private window, or storage switched off. Nothing to clear. */
      }
      window.location.assign("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the account");
      setBusy(false);
    }
  }

  return (
    <section className="animate-rise-in rounded-xl border border-red-600/40 card p-4 shadow-sm">
      <h2 className="font-semibold text-red-600">Delete this account</h2>
      <p className="mt-1 text-sm text-secondary">
        Permanently removes your account and{" "}
        <strong className="text-foreground">everything in it</strong> — every
        logged day, note, tracker, task, book, challenge and rest day. It
        cannot be undone, and there is no copy kept anywhere afterwards.{" "}
        <strong className="text-foreground">Export your data first</strong> if
        you might ever want it back.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-lg border border-red-600/50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-600/5"
        >
          Delete my account…
        </button>
      ) : (
        <div className="mt-4 space-y-3 border-t border-edge pt-4">
          <label className="block">
            <span className="text-sm font-medium">Your password</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">
              Type <span className="font-mono text-red-600">{PHRASE}</span>
            </span>
            <input
              value={confirm}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={PHRASE}
              aria-label={`Type ${PHRASE} to confirm`}
              className="mt-1 w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          {error && (
            <p className="rounded-md border border-red-600/40 bg-red-600/5 p-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void destroy()}
              disabled={!ready || busy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
            >
              {busy ? "Deleting…" : "Delete everything, permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirm("");
                setError("");
              }}
              disabled={busy}
              className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
            >
              Keep my account
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
