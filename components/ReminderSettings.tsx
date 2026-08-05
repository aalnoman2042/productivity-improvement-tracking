"use client";

import { useCallback, useEffect, useState } from "react";
import InstallPrompt from "@/components/InstallPrompt";
import type { CronHealth } from "@/lib/cronLog";

type Status = {
  available: boolean;
  enabled: boolean;
  devices: number;
  schedule?: CronHealth;
};

/** "4 hours ago", "yesterday" — vague on purpose; the exact minute is noise. */
function ago(hours: number): string {
  if (hours < 1.5) return "in the last hour";
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "about a day ago" : `${days} days ago`;
}

/**
 * Whether the schedule behind the reminder is alive.
 *
 * The failure mode this exists for is silent: a cron that stops firing looks
 * exactly like a run of days you happened to log early. So the last run is
 * stated outright, and going quiet for more than a day is called out.
 */
function ScheduleHealth({ schedule }: { schedule: CronHealth }) {
  if (!schedule.everRan) {
    return (
      <p className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5 text-xs text-secondary">
        The nightly schedule hasn&apos;t run yet — no run has ever been
        recorded. If reminders never arrive, check the cron job in{" "}
        <code className="rounded bg-surface px-1">vercel.json</code> and that{" "}
        <code className="rounded bg-surface px-1">CRON_SECRET</code> is set.
      </p>
    );
  }

  const broken = schedule.overdue || !schedule.lastRunOk;
  const tone = broken
    ? "border-amber-600/40 text-amber-700 dark:text-amber-500"
    : "border-edge text-secondary";

  return (
    <p className={`mt-3 rounded-md border bg-surface-2 p-2.5 text-xs ${tone}`}>
      {broken ? "⚠ " : "✓ "}
      Schedule last ran{" "}
      <strong>{ago(schedule.hoursAgo ?? 0)}</strong>
      {schedule.lastRunOk
        ? schedule.notified !== null &&
          `, sending ${schedule.notified} ${schedule.notified === 1 ? "reminder" : "reminders"}`
        : ` and failed${schedule.lastError ? `: ${schedule.lastError}` : ""}`}
      .
      {schedule.overdue &&
        " That's more than a day — a daily job should have run again by now."}
      {schedule.recentFailures > 1 &&
        ` ${schedule.recentFailures} of the last 5 runs failed.`}
    </p>
  );
}

/**
 * The VAPID public key arrives as base64url; PushManager wants bytes. Backed
 * by an explicit ArrayBuffer so it satisfies `BufferSource` — a bare
 * `new Uint8Array(n)` could be over shared memory as far as the types know.
 */
function urlBase64ToUint8Array(base64: string) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export default function ReminderSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  // Decided after mount: the server has no idea what this browser can do,
  // and guessing would mean a hydration mismatch.
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setSupported(
      "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    );
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/reminders");
    if (!res.ok) return;
    setStatus(await res.json());

    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setSubscribed(Boolean(sub));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      if (!PUBLIC_KEY) throw new Error("Push isn't set up on this server");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(
          permission === "denied"
            ? "Notifications are blocked for this site — allow them in your browser settings, then try again"
            : "Notification permission wasn't granted"
        );
      }

      // The app registers this on load in production; do it here too so
      // switching reminders on works the first time, and in development.
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
        }));

      const res = await fetch("/api/reminders/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(JSON.parse(JSON.stringify(sub))),
      });
      if (!res.ok) throw new Error("Could not register this device");

      const on = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          tzOffset: -new Date().getTimezoneOffset(),
        }),
      });
      if (!on.ok) throw new Error("Could not turn reminders on");

      setSubscribed(true);
      setMsg({ kind: "ok", text: "Reminders are on for this device" });
      await load();
    } catch (err) {
      setMsg({
        kind: "bad",
        text: err instanceof Error ? err.message : "Could not turn reminders on",
      });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(
          `/api/reminders/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
          { method: "DELETE" }
        );
        await sub.unsubscribe();
      }
      await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          tzOffset: -new Date().getTimezoneOffset(),
        }),
      });
      setSubscribed(false);
      setMsg({ kind: "ok", text: "Reminders are off" });
      await load();
    } catch {
      setMsg({ kind: "bad", text: "Could not turn reminders off" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/reminders/test", { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setMsg(
      res.ok
        ? { kind: "ok", text: "Sent — it should appear in a moment" }
        : { kind: "bad", text: data?.error ?? "Could not send" }
    );
  }

  const on = Boolean(status?.enabled && subscribed);

  return (
    <section className="animate-rise-in rounded-lg border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">Nightly reminder</h2>
      <p className="mt-1 text-sm text-secondary">
        At midnight your time, PIT nudges you to fill in the day that just
        ended — and stays quiet on days you&apos;ve already logged. On Sunday
        nights it also sends your week in review: days logged, sleep, namaz
        and your streak.
      </p>

      {supported === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : !supported ? (
        <p className="mt-3 text-sm text-muted">
          This browser can&apos;t receive notifications. Try Chrome on Android,
          or add PIT to your Home Screen on iPhone.
        </p>
      ) : status === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : !status.available ? (
        <p className="mt-3 text-sm text-muted">
          Notifications aren&apos;t set up on this server yet — the owner needs
          to add the VAPID keys.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={on ? disable : enable}
              disabled={busy}
              className={
                on
                  ? "rounded-md border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
                  : "rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              }
            >
              {busy ? "Working…" : on ? "Turn off on this device" : "Turn on reminders"}
            </button>
            {on && (
              <button
                onClick={sendTest}
                disabled={busy}
                className="rounded-md border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
              >
                Send a test
              </button>
            )}
          </div>

          {on && (
            <p className="mt-3 text-sm text-secondary">
              ✓ On — {status.devices}{" "}
              {status.devices === 1 ? "device is" : "devices are"} set up. Each
              phone or computer has to be turned on separately.
            </p>
          )}

          {status.enabled && !subscribed && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-500">
              Reminders are on for your account, but not on this device yet.
            </p>
          )}

          {/* On iOS this isn't advice, it's a prerequisite — push is only
              delivered to installed apps, so the toggle above cannot work
              until it's done. */}
          {!on && <InstallPrompt variant="block" />}

          {msg && (
            <p
              className={`animate-fade-in mt-3 text-sm font-medium ${
                msg.kind === "ok"
                  ? "text-green-700 dark:text-green-500"
                  : "text-red-600"
              }`}
            >
              {msg.text}
            </p>
          )}

          {status.schedule && <ScheduleHealth schedule={status.schedule} />}
        </>
      )}
    </section>
  );
}
