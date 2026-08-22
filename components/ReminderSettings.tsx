"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import InstallPrompt from "@/components/InstallPrompt";
import { prettyTime } from "@/lib/dates";
import { DEFAULT_REMINDER_TIME } from "@/lib/reminders";
import type { CronHealth } from "@/lib/cronLog";

type Status = {
  available: boolean;
  enabled: boolean;
  /** The local time the ask should arrive, "HH:MM". */
  time: string;
  devices: number;
  schedule?: CronHealth;
  /** The polled per-tracker schedule, and whether anything needs it. */
  trackerSchedule?: CronHealth;
  timedTrackers?: number;
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
function ScheduleHealth({
  schedule,
  label = "Schedule",
  path = "/api/cron/reminders",
}: {
  schedule: CronHealth;
  label?: string;
  path?: string;
}) {
  if (!schedule.everRan) {
    return (
      <p className="mt-3 rounded-md border border-amber-600/40 bg-surface-2 p-2.5 text-xs text-amber-700 dark:text-amber-500">
        ⚠ {label} has never run. A time you choose only arrives if something
        is awake to notice it — check that a scheduler is polling{" "}
        <code className="rounded bg-surface px-1">{path}</code> (the GitHub
        Action in the repo does this) and that{" "}
        <code className="rounded bg-surface px-1">CRON_SECRET</code> is set.
        Until then, opening PIT sends anything that is already due.
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
      {label} last ran{" "}
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

/**
 * What this browser can do never changes within a page view, so it's a
 * static external value: no subscription, and the server snapshot is null —
 * guessing there would only earn a hydration mismatch.
 */
const subscribeNever = () => () => {};
const readSupport = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
const supportUnknown = () => null;

export default function ReminderSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  // Held locally while it's being changed so the field doesn't jump back to
  // the server's answer between the keystroke and the round trip.
  const [time, setTime] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  // Decided after mount: the server has no idea what this browser can do.
  const supported = useSyncExternalStore(
    subscribeNever,
    readSupport,
    supportUnknown
  );

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
    // Deferred a microtask: every setState in `load` happens after a network
    // round trip anyway, and the boundary makes that plain to the lint rule.
    void Promise.resolve().then(load);
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
          time: time ?? status?.time ?? DEFAULT_REMINDER_TIME,
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

  /**
   * The hour is saved the moment it's picked — there is no Save button here,
   * and a time input that silently forgot what you chose would be worse than
   * no choice at all. The timezone rides along: a chosen hour is meaningless
   * without knowing whose clock it is on.
   */
  async function saveTime(next: string) {
    setTime(next);
    setMsg(null);
    const res = await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time: next,
        tzOffset: -new Date().getTimezoneOffset(),
      }),
    });
    if (!res.ok) {
      setMsg({ kind: "bad", text: "Could not save that time" });
      return;
    }
    setMsg({ kind: "ok", text: `Reminder moved to ${prettyTime(next)}` });
    await load();
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

  async function sendDigest() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/reminders/digest", { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    setMsg(
      res.ok
        ? {
            kind: "ok",
            text: "Sent — your last 7 days, as the Sunday push will look",
          }
        : { kind: "bad", text: data?.error ?? "Could not send" }
    );
  }

  const on = Boolean(status?.enabled && subscribed);
  // What the field shows: what's being typed, else what the server holds,
  // else the hour this reminder has always kept.
  const chosen = time ?? status?.time ?? DEFAULT_REMINDER_TIME;

  return (
    <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">Daily reminder</h2>
      <p className="mt-1 text-sm text-secondary">
        Once a day at {prettyTime(chosen)}, PIT asks how your day went — so you
        can put it on record while it&apos;s still fresh. When something is
        riding on the day it says so instead: a challenge on its last day, a
        milestone you just crossed, a logging run about to break. On Sunday
        nights it also sends your week in review: days logged, sleep, namaz and
        your streak. Go quiet for three days and it checks in on its own —
        that one doesn&apos;t wait to be asked for.
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
                  : "rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              }
            >
              {busy ? "Working…" : on ? "Turn off on this device" : "Turn on reminders"}
            </button>
            {on && (
              <>
                <button
                  onClick={sendTest}
                  disabled={busy}
                  className="rounded-md border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
                >
                  Send a test
                </button>
                <button
                  onClick={sendDigest}
                  disabled={busy}
                  className="rounded-md border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
                >
                  Send my week in review
                </button>
              </>
            )}
          </div>

          {/* The hour, and the honest caveat about it: the schedule that
              delivers is polled every few minutes, so "23:00" means the first
              poll after 23:00, not the stroke of it. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-edge pt-4">
            <label htmlFor="reminder-time" className="text-sm font-medium">
              Ask me at
            </label>
            <input
              id="reminder-time"
              type="time"
              value={chosen}
              onChange={(e) => e.target.value && void saveTime(e.target.value)}
              className="rounded-md border border-edge bg-transparent px-3 py-1.5 text-sm tabular-nums outline-none focus:border-accent"
            />
            <span className="text-xs text-muted">
              your time, within about 15 minutes
            </span>
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

          {status.schedule && (
            <ScheduleHealth schedule={status.schedule} label="The daily ask" />
          )}

          {/* The per-tracker times are a different schedule with a different
              failure: it can be perfectly healthy and silent, so it is only
              worth reporting once something actually depends on it. */}
          {(status.timedTrackers ?? 0) > 0 && status.trackerSchedule && (
            <ScheduleHealth
              schedule={status.trackerSchedule}
              label="Tracker reminders"
              path="/api/cron/tracker-reminders"
            />
          )}
        </>
      )}
    </section>
  );
}
