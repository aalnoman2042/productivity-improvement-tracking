"use client";

import { useEffect } from "react";

/** Don't poke the server about reminders more often than this. */
const FLUSH_EVERY_MS = 10 * 60 * 1000;
const FLUSH_KEY = "pit_last_flush";

/**
 * Registers the service worker so PIT can be installed to a home screen —
 * and, while it's here, asks the server whether any reminder is owed.
 *
 * That second job exists because of an awkward fact: a reminder set for
 * 18:00 needs *something* to be awake at 18:00, and a Vercel Hobby
 * deployment can only run a cron once a day. A scheduler fixes it properly
 * (DEPLOY.md), but until one is running, opening the app is the only thing
 * that reliably happens — so opening the app is made to count. Throttled to
 * once every ten minutes, per device, and the endpoint only ever acts on the
 * account that called it.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const flush = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      let last = 0;
      try {
        last = Number(localStorage.getItem(FLUSH_KEY) ?? 0);
      } catch {
        /* storage blocked — poke anyway, it's cheap and idempotent */
      }
      if (Date.now() - last < FLUSH_EVERY_MS) return;
      try {
        localStorage.setItem(FLUSH_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      // Nothing on screen depends on the answer: this is a nudge to the
      // server, not a request for data.
      void fetch("/api/reminders/flush", { method: "POST" }).catch(() => {});
    };

    flush();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("online", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("online", flush);
    };
  }, []);

  return null;
}
