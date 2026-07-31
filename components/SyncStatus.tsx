"use client";

import { useEffect, useState } from "react";
import { flush, onSyncChange, pendingCount } from "@/lib/sync";

/**
 * The little "waiting to send" indicator. Silent when everything is synced
 * and online — it only speaks up when there's something to say.
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
        className="animate-fade-in rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800"
        title="You're offline — anything you save is kept on this device"
      >
        Offline{pending > 0 ? ` · ${pending}` : ""}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span
        className="animate-fade-in rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-accent"
        title={`${pending} change${pending > 1 ? "s" : ""} waiting to sync`}
      >
        <span className="mr-1 inline-block animate-spin-slow">◌</span>
        Syncing {pending}
      </span>
    );
  }

  if (justSynced) {
    return (
      <span className="animate-fade-in rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
        ✓ Synced
      </span>
    );
  }

  return null;
}
