"use client";

import { useEffect, useState } from "react";
import { flush, onSyncChange, pendingCount } from "@/lib/sync";

/**
 * The little "waiting to send" indicator. Silent when everything is synced
 * and online — it only speaks up when there's something to say.
 *
 * Two things it has to get right beyond that. The tints are drawn from the
 * theme rather than from Tailwind's light palette: `bg-amber-100` with dark
 * text is a lamp on a dark screen, and this chip sits in the header of every
 * page. And it is a live region — "your last three changes are still on this
 * device" is exactly the kind of state that must not be visible only.
 */
export default function SyncStatus() {
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    const update = () => {
      setPending(pendingCount());
      setOnline(navigator.onLine);
    };
    update();

    const unsubscribe = onSyncChange(update);

    // Drain on load, whenever we come back online, and periodically while
    // anything is still waiting.
    const tryFlush = async () => {
      const before = pendingCount();
      const { sent } = await flush();
      if (sent > 0 && before > 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 2500);
      }
      update();
    };
    void tryFlush();

    window.addEventListener("online", tryFlush);
    const timer = setInterval(() => {
      if (pendingCount() > 0) void tryFlush();
    }, 20000);

    return () => {
      unsubscribe();
      window.removeEventListener("online", tryFlush);
      clearInterval(timer);
    };
  }, []);

  if (!online) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="animate-fade-in rounded-full border border-amber-600/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-500"
        title="You're offline — anything you save is kept on this device"
      >
        Offline{pending > 0 ? ` · ${pending}` : ""}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="animate-fade-in rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
        title={`${pending} change${pending > 1 ? "s" : ""} waiting to sync`}
      >
        <span className="mr-1 inline-block animate-spin-slow">◌</span>
        Syncing {pending}
      </span>
    );
  }

  if (justSynced) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="animate-fade-in rounded-full border border-green-700/40 bg-green-700/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-500"
      >
        ✓ Synced
      </span>
    );
  }

  return null;
}
