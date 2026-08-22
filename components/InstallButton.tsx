"use client";

import { useState } from "react";
import { useInstall } from "@/lib/install";
import InstallSheet from "@/components/InstallSheet";

/** A tray-and-arrow, the near-universal shorthand for "put this on my device". */
function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/**
 * "Install", always within reach — unlike `InstallPrompt`, which is a one-off
 * offer that can be dismissed for good. Someone who waved the banner away, or
 * who only thought about it a week later, still needs a way in.
 *
 * One button, two behaviours, and the difference is not ours to choose: where
 * the browser gives us a prompt we replay it and the whole thing is one tap;
 * where it doesn't — every iPhone, and every in-app browser — the same tap
 * opens `InstallSheet`, which walks through the taps Apple insists on.
 *
 * `variant="nav"` is the compact header button, `variant="wide"` the
 * full-width one under the sign-in form, for the common case of installing
 * before there's even an account to log into.
 */
export default function InstallButton({
  variant = "nav",
}: {
  variant?: "nav" | "wide";
}) {
  const { installed, canPrompt, promptInstall } = useInstall();
  const [busy, setBusy] = useState(false);
  const [showHow, setShowHow] = useState(false);

  // Only being installed hides the button. It used to also hide when the
  // browser was neither Chrome-like (no prompt) nor detectably iOS — but a
  // detection miss then meant no button at all on the one platform that
  // needs the instructions most. Now detection only changes the wording.
  if (installed) return null;

  const click = async () => {
    // No prompt to replay: show the steps rather than a dead button.
    if (!canPrompt) {
      setShowHow(true);
      return;
    }
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  const label = busy ? "Installing…" : canPrompt ? "Install" : "Install app";

  const sheet = showHow ? <InstallSheet onClose={() => setShowHow(false)} /> : null;

  if (variant === "wide") {
    return (
      <div className="hide-installed w-full max-w-sm">
        <button
          onClick={click}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-accent/50 px-4 py-2.5 text-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40"
        >
          <DownloadIcon />
          <span>{label}</span>
        </button>
        <p className="mt-2 text-center text-xs text-secondary">
          Opens instantly from your home screen, works offline, and it&apos;s
          what lets reminders reach you.
        </p>
        {sheet}
      </div>
    );
  }

  return (
    <div className="hide-installed relative shrink-0">
      <button
        onClick={click}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md border border-accent/50 px-2.5 py-1.5 text-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 sm:px-3"
        title="Install PIT on this device"
      >
        <DownloadIcon />
        <span>{busy ? "…" : "Install"}</span>
      </button>
      {sheet}
    </div>
  );
}
