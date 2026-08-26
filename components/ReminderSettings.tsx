"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import InstallPrompt from "@/components/InstallPrompt";
import { prettyTime } from "@/lib/dates";
import { DEFAULT_REMINDER_TIME } from "@/lib/reminders";
import {
  cancelDailyReminder,
  dailyReminderPending,
  isNativeShell,
  requestNotificationPermission,
  scheduleDailyReminder,
  sendTestNotification,
} from "@/lib/native";
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
 * How a reminder can reach *this* device, which is not one question but two.
 *
 *  - `native`  the Android app. An Android WebView has no Push API at all —
 *              `PushManager` is simply not there — so nothing the server
 *              sends can arrive. The phone keeps the schedule itself instead.
 *  - `web`     a browser that can be pushed to.
 *  - `none`    a browser that cannot.
 *
 * Which of the three never changes within a page view, so it is a static
 * external value: no subscription, and the server snapshot is null — guessing
 * there would only earn a hydration mismatch.
 */
type Channel = "native" | "web" | "none";

const subscribeNever = () => () => {};
const readChannel = (): Channel => {
  if (isNativeShell()) return "native";
  const pushable =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  return pushable ? "web" : "none";
};
const channelUnknown = () => null;

export default function ReminderSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  // Held locally while it's being changed so the field doesn't jump back to
  // the server's answer between the keystroke and the round trip.
  const [time, setTime] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  // Decided after mount: the server has no idea what this device can do.
  const channel = useSyncExternalStore(subscribeNever, readChannel, channelUnknown);
  const native = channel === "native";

  const load = useCallback(async () => {
    const res = await fetch("/api/reminders");
    if (!res.ok) return;
    setStatus(await res.json());

    // "Is this device set up?" has a different answer on each platform. In
    // the app it means an alarm is armed on the phone; in a browser it means
    // a push subscription exists on the server.
    if (isNativeShell()) {
      setSubscribed(await dailyReminderPending());
      return;
    }
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

  /**
   * Switch reminders on for this account, and set this device up to receive
   * them — which means two different things on the two platforms, and it is
   * worth being clear about which part is shared.
   *
   * The *setting* is the account's and lives on the server: the hour, the
   * timezone, and whether PIT should be asking at all. Every device reads it.
   * The *delivery* is the device's own problem. A browser hands the server a
   * push subscription and waits to be told; the Android app is never told
   * anything, because nothing can tell it, so it writes the hour onto its own
   * alarm clock and asks itself.
   */
  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const chosenTime = time ?? status?.time ?? DEFAULT_REMINDER_TIME;

      if (native) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          throw new Error(
            "Android didn't grant permission to notify — allow notifications for PIT in Settings, then try again"
          );
        }
      } else {
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
      }

      const on = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          time: chosenTime,
          tzOffset: -new Date().getTimezoneOffset(),
        }),
      });
      if (!on.ok) throw new Error("Could not turn reminders on");

      // Armed only after the server has agreed, so a failed save can never
      // leave a phone buzzing about a setting that was never stored.
      if (native) await scheduleDailyReminder(chosenTime);

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

  /**
   * Stop the app asking. Every scheduled push ends here — the nightly ask,
   * the Sunday week in review and the three-day check-in all read this
   * switch — but the browser stays registered, so a message sent by hand can
   * still arrive. Off means "stop the schedule", and unregistering the
   * device below is what means "stop everything".
   *
   * It used to throw the subscription away too, which quietly made the two
   * the same thing: permission granted months ago was lost on a switch, and
   * getting it back needs the browser's own dialog.
   *
   * The Android app has no such distinction to draw. Nothing sent by hand can
   * reach it — that is a push, and there is no push here — so off simply
   * disarms the alarm, and there is no second, harder switch to offer.
   */
  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          tzOffset: -new Date().getTimezoneOffset(),
        }),
      });
      // `fetch` does not throw on a 4xx, and an expired session answers 401
      // here. Left unchecked, the phone would disarm its alarm, say so, and
      // then re-arm it on the next resume from a server that never agreed —
      // a reminder returning after being told it was off.
      if (!res.ok) throw new Error("Could not turn reminders off");
      if (native) {
        await cancelDailyReminder();
        setSubscribed(false);
      }
      setMsg({ kind: "ok", text: "Reminders are off — the app won't ask again" });
      await load();
    } catch (err) {
      setMsg({
        kind: "bad",
        text: err instanceof Error ? err.message : "Could not turn reminders off",
      });
    } finally {
      setBusy(false);
    }
  }

  /** The full stop: this browser receives nothing from PIT at all. */
  async function forget() {
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
      setSubscribed(false);
      setMsg({ kind: "ok", text: "This device won't receive anything from PIT" });
      await load();
    } catch {
      setMsg({ kind: "bad", text: "Could not unregister this device" });
    } finally {
      setBusy(false);
    }
  }

  /**
   * The hour is saved the moment it's picked — there is no Save button here,
   * and a time input that silently forgot what you chose would be worse than
   * no choice at all. The timezone rides along: a chosen hour is meaningless
   * without knowing whose clock it is on.
   *
   * On the phone the alarm has to be moved as well as the setting. Cancelling
   * first would be the obvious way; re-scheduling under the same id replaces
   * what is there, so the reminder never spends a moment un-armed.
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
    if (native && subscribed) await scheduleDailyReminder(next);
    setMsg({ kind: "ok", text: `Reminder moved to ${prettyTime(next)}` });
    await load();
  }

  /**
   * "Does this actually work" deserves an answer now rather than at eleven
   * tonight. In a browser the server sends a real push; on the phone there is
   * no server in the loop, so the phone schedules one a few seconds out —
   * which tests the same things that matter: permission, the channel, and
   * whether Android is willing to show it.
   */
  async function sendTest() {
    setBusy(true);
    setMsg(null);
    if (native) {
      try {
        await sendTestNotification();
        setMsg({ kind: "ok", text: "Sent — it should appear in a few seconds" });
      } catch {
        setMsg({ kind: "bad", text: "Android refused to schedule it" });
      }
      setBusy(false);
      return;
    }
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
  // VAPID keys are the server's side of push, and the phone never asks the
  // server to send it anything — so their absence stops a browser, not the app.
  const usable = native || Boolean(status?.available);

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

      {channel === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : channel === "none" ? (
        <p className="mt-3 text-sm text-muted">
          This browser can&apos;t receive notifications. Try Chrome on Android,
          or add PIT to your Home Screen on iPhone.
        </p>
      ) : status === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : !usable ? (
        <p className="mt-3 text-sm text-muted">
          Notifications aren&apos;t set up on this server yet — the owner needs
          to add the VAPID keys.
        </p>
      ) : (
        <>
          {/* What the app can and cannot do, said once, up front. The
              paragraph above promises three things; only the first of them
              can reach a phone that nothing is allowed to push to. */}
          {native && (
            <p className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5 text-xs text-secondary">
              In the Android app the daily ask is kept by the phone itself, on
              its own clock — it arrives with no signal and with PIT closed.
              The rest of the paragraph above travels by push, which Android&apos;s
              WebView cannot receive: the Sunday week in review and the
              three-day check-in reach you in a browser where reminders are on,
              not here.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={on ? disable : enable}
              disabled={busy}
              className={
                on
                  ? "rounded-lg border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
                  : "rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              }
            >
              {busy ? "Working…" : on ? "Turn reminders off" : "Turn on reminders"}
            </button>
            {on && (
              <>
                <button
                  onClick={sendTest}
                  disabled={busy}
                  className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
                >
                  Send a test
                </button>
                {/* The digest is a push from the server. In the app there is
                    nothing for it to arrive on, so the button is not offered
                    rather than offered and failing. */}
                {!native && (
                  <button
                    onClick={sendDigest}
                    disabled={busy}
                    className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
                  >
                    Send my week in review
                  </button>
                )}
              </>
            )}
          </div>

          {/* The hour, and the honest caveat about it: the schedule that
              delivers is polled every few minutes, so "23:00" means the first
              poll after 23:00, not the stroke of it. The phone is the
              exception — an alarm it set itself needs nothing to be awake. */}
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
              {native ? "your phone's clock" : "your time, within about 15 minutes"}
            </span>
          </div>

          {on && native && (
            <p className="mt-3 text-sm text-secondary">
              ✓ On — this phone will ask at {prettyTime(chosen)}, from its own
              alarm clock.
            </p>
          )}

          {on && !native && (
            <p className="mt-3 text-sm text-secondary">
              ✓ On — {status.devices}{" "}
              {status.devices === 1 ? "device is" : "devices are"} set up. Each
              phone or computer has to be turned on separately.
            </p>
          )}

          {/* The one thing that will actually stop this working, said plainly
              rather than discovered over a fortnight of silence. Android is
              free to refuse to wake a backgrounded app, and the phones most
              likely to refuse are the ones people own. */}
          {on && native && (
            <p className="mt-3 rounded-md border border-edge bg-surface-2 p-2.5 text-xs text-secondary">
              If it stops arriving, Android has put PIT to sleep rather than
              PIT having forgotten. Samsung and Xiaomi do this hardest. The fix
              is in their settings, not here: allow PIT to run unrestricted in
              the background — on Samsung, take it out of &ldquo;Sleeping
              apps&rdquo;; on Xiaomi, turn Autostart on.
            </p>
          )}

          {/* Off, but the browser is still registered — which is the whole
              point of the two being separate. Say so plainly, and put the
              full stop right beside it. */}
          {!on && !native && subscribed && (
            <p className="mt-3 text-sm text-secondary">
              This device is still registered, so a message sent by hand — the
              owner nudging you to log your day — can still reach it. The app
              itself won&apos;t ask.{" "}
              <button
                onClick={forget}
                disabled={busy}
                className="font-medium text-accent hover:underline disabled:opacity-40"
              >
                Unregister this device
              </button>
            </p>
          )}

          {status.enabled && !subscribed && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-500">
              Reminders are on for your account, but not on this device yet.
            </p>
          )}

          {/* On iOS this isn't advice, it's a prerequisite — push is only
              delivered to installed apps, so the toggle above cannot work
              until it's done. It renders nothing inside the Android app,
              which is already as installed as it gets. */}
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

          {/* Whether the server's schedule is alive is only this device's
              business when this device is waiting on it. The phone is not:
              its reminder is its own, and reporting a stalled cron beside it
              would be answering a question nobody here asked. */}
          {!native && status.schedule && (
            <ScheduleHealth schedule={status.schedule} label="The daily ask" />
          )}

          {/* The per-tracker times are a different schedule with a different
              failure: it can be perfectly healthy and silent, so it is only
              worth reporting once something actually depends on it. */}
          {!native && (status.timedTrackers ?? 0) > 0 && status.trackerSchedule && (
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
