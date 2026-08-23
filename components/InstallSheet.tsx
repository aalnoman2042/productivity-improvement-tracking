"use client";

import { useEffect, useState } from "react";
import { useInstall, type InstallRoute } from "@/lib/install";
import { ShareIcon } from "@/components/InstallPrompt";

/**
 * The whole "put PIT on my home screen" conversation, in one sheet.
 *
 * On Android this is a single tap and the browser does it. On iPhone it
 * cannot be: Apple gives websites no install API at all, on purpose, and the
 * Share sheet is the only route there has ever been. So the honest fix isn't
 * a button that claims to do it — it's showing the three taps clearly enough
 * that nobody has to go looking, and naming the case that actually defeats
 * people, which is opening the link inside Facebook or Instagram's browser
 * where "Add to Home Screen" does not exist at all.
 *
 * It matters more than tidiness: on iOS, push notifications are delivered
 * *only* to installed web apps. Every reminder in this app depends on these
 * three taps happening.
 */

/** A step: its number, what to tap, and the icon that makes it findable. */
function Step({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent tabular-nums">
        {n}
      </span>
      <span className="min-w-0 flex-1 pt-0.5 text-sm">{children}</span>
    </li>
  );
}

/** The ⊞ that iOS shows beside "Add to Home Screen". */
function AddIcon() {
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
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function Instructions({ route }: { route: InstallRoute }) {
  if (route === "in-app") {
    return (
      <>
        <p className="text-sm text-secondary">
          You&apos;re reading this inside another app&apos;s browser (Facebook,
          Instagram, Messenger…), and those can&apos;t add anything to a home
          screen. One step first:
        </p>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Tap <strong>•••</strong> or the <strong>share</strong> icon in this
            browser&apos;s corner.
          </Step>
          <Step n={2}>
            Choose <strong>Open in browser</strong> — Safari on iPhone, Chrome
            on Android.
          </Step>
          <Step n={3}>Tap Install there, and this sheet will show you how.</Step>
        </ol>
      </>
    );
  }

  if (route === "ios-other") {
    return (
      <>
        <p className="text-sm text-secondary">
          This is Chrome (or another browser) on iPhone. It can make a
          shortcut, but iPhone only delivers notifications to apps added from{" "}
          <strong>Safari</strong> — so it&apos;s worth the one extra step.
        </p>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Tap <strong>•••</strong> → <strong>Open in Safari</strong>, or copy
            the link below.
          </Step>
          <Step n={2}>
            In Safari, tap <ShareIcon /> <strong>Share</strong> at the bottom.
          </Step>
          <Step n={3}>
            Scroll down, tap <AddIcon /> <strong>Add to Home Screen</strong>,
            then <strong>Add</strong>.
          </Step>
        </ol>
      </>
    );
  }

  if (route === "ios-safari") {
    return (
      <>
        <p className="text-sm text-secondary">
          Three taps. iPhone has no one-tap install for any website — Apple
          keeps that behind the Share sheet.
        </p>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Tap <ShareIcon /> <strong>Share</strong> — the square with an arrow,
            in the bar at the bottom of Safari.
          </Step>
          <Step n={2}>
            Scroll the list down to <AddIcon />{" "}
            <strong>Add to Home Screen</strong>.
          </Step>
          <Step n={3}>
            Tap <strong>Add</strong>. PIT appears on your home screen like any
            other app.
          </Step>
        </ol>
        <p className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5 text-xs text-secondary">
          This is also what switches reminders on: iPhone delivers
          notifications only to apps added this way.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-secondary">
        This browser installs from its own menu.
      </p>
      <ol className="mt-3 space-y-3">
        <Step n={1}>
          Open the browser menu — <strong>⋮</strong> or <strong>•••</strong>.
        </Step>
        <Step n={2}>
          Choose <strong>Install app</strong> or{" "}
          <strong>Add to Home Screen</strong>.
        </Step>
      </ol>
    </>
  );
}

export default function InstallSheet({ onClose }: { onClose: () => void }) {
  const { route } = useInstall();
  const [copied, setCopied] = useState(false);

  // A sheet closes the way a sheet is expected to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      // Clipboard blocked — the address bar is still there.
      setCopied(false);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add PIT to your home screen"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-rise-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-edge card p-5 shadow-lg sm:rounded-2xl"
      >
        <h2 className="text-lg font-bold tracking-tight">
          📲 Add PIT to your home screen
        </h2>
        <p className="mt-1 text-sm text-muted">
          It opens instantly, works with no signal, and it&apos;s what lets
          reminders reach you.
        </p>

        <div className="mt-4">
          <Instructions route={route} />
        </div>

        {/* The link is the way out of an in-app browser, and the way from
            Chrome to Safari — both journeys need it in the clipboard. */}
        {(route === "in-app" || route === "ios-other") && (
          <button
            onClick={copyLink}
            className="mt-4 w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
          >
            {copied ? "✓ Link copied — paste it in Safari" : "Copy the link"}
          </button>
        )}

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg bg-brand-gradient px-4 py-2.5 text-sm font-medium text-white hover:brightness-110"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
