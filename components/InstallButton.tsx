"use client";

import { useEffect, useRef, useState } from "react";
import { useInstall } from "@/lib/install";
import { ShareIcon } from "@/components/InstallPrompt";

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

/** The install route, spelled out for the browsers that have no prompt. */
function Steps({ ios }: { ios: boolean }) {
  if (ios) {
    return (
      <>
        In Safari, tap <ShareIcon /> <strong>Share</strong>, then{" "}
        <strong>Add to Home Screen</strong>.
      </>
    );
  }
  // Anything else without a prompt: the wording differs per browser, but the
  // route is always the browser's own menu.
  return (
    <>
      Open your browser&apos;s menu and choose <strong>Install app</strong> or{" "}
      <strong>Add to Home Screen</strong>.
    </>
  );
}

/**
 * "Install", always within reach — unlike `InstallPrompt`, which is a one-off
 * offer that can be dismissed for good. Someone who waved the banner away, or
 * who only thought about it a week later, still needs a way in.
 *
 * `variant="nav"` is the compact header button; on iOS, where there is no
 * prompt to replay, it opens a popover with the Share-sheet steps instead.
 * `variant="wide"` is the full-width one under the sign-in form, for the
 * common case of installing before there's even an account to log into.
 *
 * Renders for every browser that isn't already running installed: a real
 * prompt where one exists, instructions everywhere else.
 */
export default function InstallButton({
  variant = "nav",
}: {
  variant?: "nav" | "wide";
}) {
  const { installed, canPrompt, needsManual, promptInstall } = useInstall();
  const [busy, setBusy] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // A popover over the header has to close the way one is expected to: click
  // away, or press Escape.
  useEffect(() => {
    if (!showHow || variant !== "nav") return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setShowHow(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHow(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showHow, variant]);

  // Only being installed hides the button. It used to also hide when the
  // browser was neither Chrome-like (no prompt) nor detectably iOS — but a
  // detection miss then meant no button at all on the one platform that
  // needs the instructions most. Now detection only changes the wording.
  if (installed) return null;

  const click = async () => {
    if (!canPrompt) {
      setShowHow((v) => !v);
      return;
    }
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  const label = busy ? "Installing…" : canPrompt ? "Install" : "Install app";

  if (variant === "wide") {
    return (
      <div className="hide-installed w-full max-w-sm">
        <button
          onClick={click}
          disabled={busy}
          aria-expanded={canPrompt ? undefined : showHow}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-accent/50 px-4 py-2.5 text-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40"
        >
          <DownloadIcon />
          <span>{label}</span>
        </button>
        <p className="mt-2 text-center text-xs text-secondary">
          {canPrompt ? (
            <>Opens instantly from your home screen and works offline.</>
          ) : showHow ? (
            <Steps ios={needsManual} />
          ) : (
            <>Add PIT to your home screen — tap for how.</>
          )}
        </p>
      </div>
    );
  }

  return (
    <div ref={wrap} className="hide-installed relative shrink-0">
      <button
        onClick={click}
        disabled={busy}
        aria-expanded={canPrompt ? undefined : showHow}
        className="flex items-center gap-1.5 rounded-md border border-accent/50 px-2.5 py-1.5 text-sm font-medium text-accent hover:bg-surface-2 disabled:opacity-40 sm:px-3"
        title="Install PIT on this device"
      >
        <DownloadIcon />
        <span>{busy ? "…" : "Install"}</span>
      </button>

      {showHow && (
        <div className="animate-fade-in absolute top-full right-0 z-30 mt-2 w-64 rounded-xl border border-edge card p-3 text-sm shadow-lg">
          <p className="font-medium">Add PIT to your Home Screen</p>
          <p className="mt-1 text-secondary">
            <Steps ios={needsManual} />
          </p>
          <button
            onClick={() => setShowHow(false)}
            className="mt-3 w-full rounded-md border border-edge px-3 py-1.5 text-sm text-secondary hover:bg-surface-2"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
