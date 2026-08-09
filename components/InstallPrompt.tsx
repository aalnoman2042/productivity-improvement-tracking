"use client";

import { useState } from "react";
import { useInstall } from "@/lib/install";
import { useStored } from "@/lib/useCached";

const DISMISSED_KEY = "install-dismissed";

/** The Share sheet, drawn rather than described — it's an icon, not a word. */
export function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline-block h-4 w-4 align-text-bottom"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/**
 * How to get PIT onto the home screen, said in the two places it matters.
 *
 * `variant="banner"` is the passing offer at the top of the daily log.
 * `variant="block"` is the one inside the reminder settings, where not being
 * installed is a hard blocker rather than a nicety — on iOS, push is only
 * delivered to installed apps, so there is no point turning reminders on
 * until this is done.
 */
export default function InstallPrompt({
  variant = "banner",
}: {
  variant?: "banner" | "block";
}) {
  const { installed, canPrompt, needsManual, promptInstall } = useInstall();
  const [dismissed, setDismissed] = useStored<boolean>(DISMISSED_KEY, false);
  const [busy, setBusy] = useState(false);

  // Nothing to say: already installed, or this browser can't do it at all.
  if (installed || (!canPrompt && !needsManual)) return null;
  // The banner is dismissible; the one blocking reminders is not.
  if (variant === "banner" && dismissed) return null;

  const install = async () => {
    setBusy(true);
    const ok = await promptInstall();
    setBusy(false);
    if (ok) setDismissed(true);
  };

  const steps = (
    <span>
      tap <ShareIcon /> <strong>Share</strong>, then{" "}
      <strong>Add to Home Screen</strong>
    </span>
  );

  if (variant === "block") {
    return (
      <div className="hide-installed mt-3 rounded-md border border-amber-600/40 bg-surface-2 p-3 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-500">
          {needsManual
            ? "Add PIT to your Home Screen first"
            : "Install PIT for reliable reminders"}
        </p>
        <p className="mt-1 text-secondary">
          {needsManual ? (
            <>
              iPhone only delivers notifications to installed apps, so reminders
              can&apos;t reach you until this is done — in Safari, {steps}. Then
              open PIT from the icon and come back here.
            </>
          ) : (
            <>
              Installed, PIT opens straight from your home screen and reminders
              keep arriving when the browser is closed.
            </>
          )}
        </p>
        {canPrompt && (
          <button
            onClick={install}
            disabled={busy}
            className="mt-3 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Installing…" : "Install PIT"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="hide-installed animate-rise-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 card p-3 shadow-sm">
      <span className="text-lg" aria-hidden="true">
        📲
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <strong className="font-medium">Add PIT to your home screen</strong>
        <span className="text-secondary">
          {" "}
          — it opens instantly, works offline, and it&apos;s what lets the
          nightly reminder reach you
          {needsManual ? <>. In Safari, {steps}.</> : "."}
        </span>
      </p>
      {canPrompt && (
        <button
          onClick={install}
          disabled={busy}
          className="shrink-0 rounded-lg bg-brand-gradient px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Installing…" : "Install"}
        </button>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
