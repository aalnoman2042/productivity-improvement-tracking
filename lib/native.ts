"use client";

import { useSyncExternalStore } from "react";

/**
 * Talking to the Android shell, from a page that Vercel served.
 *
 * PIT runs in two places now: a browser tab, and a WebView inside an APK that
 * points at the same URL (`capacitor.config.ts`). Most of the app cannot tell
 * and should not care. The handful of places that must — the install prompt
 * has nothing to offer inside an installed app, and Web Push does not exist
 * in an Android WebView at all — ask here.
 *
 * **Nothing Capacitor is bundled.** The shell injects its bridge into the page
 * before any of our JavaScript runs, and it generates a JS proxy for every
 * native plugin it has, so `window.Capacitor.Plugins.LocalNotifications` is
 * simply there. Importing `@capacitor/core` would work too and would come
 * with types, but it would also put Capacitor in the bundle of every browser
 * visitor who will never have a bridge to talk to. The types below are the
 * price of that: hand-written, covering only what this app actually calls.
 */

/**
 * The marker appended to the WebView's user agent by `android.appendUserAgent`.
 *
 * Detection rides on the user agent rather than on `window.Capacitor` because
 * the user agent is on the *request*, so the server sees it too — which is
 * what lets the document stamp itself before the first paint instead of
 * flickering into place after hydration.
 */
export const NATIVE_UA_MARKER = "PITApp";

/** Where the daily reminder lives on the device. */
const REMINDER_ID = 1_000_001;
const TEST_ID = 1_000_002;
const CHANNEL_ID = "pit-daily-reminder";

type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";

type LocalNotificationsBridge = {
  checkPermissions(): Promise<{ display: PermissionState }>;
  requestPermissions(): Promise<{ display: PermissionState }>;
  createChannel(channel: {
    id: string;
    name: string;
    description?: string;
    importance?: 1 | 2 | 3 | 4 | 5;
    visibility?: -1 | 0 | 1;
    vibration?: boolean;
  }): Promise<void>;
  schedule(options: {
    notifications: {
      id: number;
      title: string;
      body: string;
      channelId?: string;
      smallIcon?: string;
      autoCancel?: boolean;
      extra?: unknown;
      schedule?: {
        on?: { hour?: number; minute?: number; second?: number };
        at?: Date;
        allowWhileIdle?: boolean;
      };
    }[];
  }): Promise<{ notifications: { id: number }[] }>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
};

type PluginHandle = { remove: () => Promise<void> };

type AppBridge = {
  addListener(
    event: "backButton",
    fn: (e: { canGoBack: boolean }) => void
  ): Promise<PluginHandle>;
  addListener(event: "resume", fn: () => void): Promise<PluginHandle>;
  exitApp(): Promise<void>;
  minimizeApp(): Promise<void>;
};

type NotificationsBridgeWithTap = LocalNotificationsBridge & {
  addListener(
    event: "localNotificationActionPerformed",
    fn: (e: { actionId: string; notification: { extra?: unknown } }) => void
  ): Promise<PluginHandle>;
};

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: {
    LocalNotifications?: NotificationsBridgeWithTap;
    App?: AppBridge;
  };
};

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/** Running inside the APK. False in every browser, including an installed PWA. */
export function isNativeShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.includes(NATIVE_UA_MARKER);
}

/**
 * The same question as a hook.
 *
 * Which platform this is never changes within a page view, so there is
 * nothing to subscribe to. The server snapshot is `null` rather than `false`:
 * the server genuinely does not know at render time, and a component that
 * needs to say something different in each case would rather say "loading"
 * once than assert the wrong one and correct itself.
 */
const subscribeNever = () => () => {};
const readNative = () => isNativeShell();
const nativeUnknown = () => null;

export function useNativeShell(): boolean | null {
  return useSyncExternalStore(subscribeNever, readNative, nativeUnknown);
}

/** The plugin, or null if we are not in the shell (or the bridge is missing). */
export function nativeNotifications(): NotificationsBridgeWithTap | null {
  return capacitor()?.Plugins?.LocalNotifications ?? null;
}

export function nativeApp(): AppBridge | null {
  return capacitor()?.Plugins?.App ?? null;
}

/** "23:00" to { hour: 23, minute: 0 }. Null for anything that isn't a time. */
function parseHHMM(time: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Android needs a channel before it will show anything, and a channel's
 * settings are frozen the first time it is created — importance, sound and
 * vibration can never be changed afterwards, only replaced by a channel with
 * a new id. So this asks for what it wants once, under an id of PIT's own,
 * rather than trying to reshape the plugin's shared "default" channel.
 *
 * If the id on a notification names a channel that does not exist, Android
 * drops the notification silently. That is the failure this guards.
 */
async function ensureChannel(plugin: LocalNotificationsBridge): Promise<void> {
  await plugin.createChannel({
    id: CHANNEL_ID,
    name: "Daily reminder",
    description: "The once-a-day ask about how your day went",
    importance: 4,
    visibility: 1,
    vibration: true,
  });
}

/**
 * Put the daily ask on the device's own clock.
 *
 * `on: { hour, minute }` is the only schedule shape that means "every day at
 * this wall-clock time". The alternatives look right and are not: `repeats`
 * with an `at` computes its interval as the gap between now and `at`, and
 * `every: "day"` fires 24 hours after the call with no way to anchor the
 * hour, using an inexact alarm that Doze can push around by hours. `on`
 * recomputes against the device's calendar at every fire, so it follows both
 * daylight saving and a flight across timezones without being told.
 *
 * `allowWhileIdle` exempts the *next* occurrence from Doze, not all of them —
 * which is why this is called again every time the app is resumed rather than
 * only when the setting changes.
 */
export async function scheduleDailyReminder(time: string): Promise<void> {
  const plugin = nativeNotifications();
  const at = parseHHMM(time);
  if (!plugin || !at) return;

  await ensureChannel(plugin);
  await plugin.schedule({
    notifications: [
      {
        id: REMINDER_ID,
        title: "How did today go?",
        body: "Put it on record while it is still fresh.",
        channelId: CHANNEL_ID,
        autoCancel: true,
        extra: { url: "/" },
        schedule: {
          on: { hour: at.hour, minute: at.minute, second: 0 },
          allowWhileIdle: true,
        },
      },
    ],
  });
}

/** Stop the device asking. Leaves anything already on screen alone. */
export async function cancelDailyReminder(): Promise<void> {
  await nativeNotifications()?.cancel({ notifications: [{ id: REMINDER_ID }] });
}

/**
 * Whether an alarm is actually armed.
 *
 * Read with a pinch of salt: the plugin answers from its own records rather
 * than from Android's alarm table, so it can report a reminder that the OS
 * has since thrown away. It re-arms anything missing when the app next
 * launches, which is what makes the two agree again.
 */
export async function dailyReminderPending(): Promise<boolean> {
  const pending = await nativeNotifications()?.getPending();
  return Boolean(pending?.notifications.some((n) => n.id === REMINDER_ID));
}

/** Ask for permission to notify. Android 13+ shows a dialog; older grants it. */
export async function requestNotificationPermission(): Promise<boolean> {
  const plugin = nativeNotifications();
  if (!plugin) return false;
  const current = await plugin.checkPermissions();
  const status =
    current.display === "granted" ? current : await plugin.requestPermissions();
  return status.display === "granted";
}

/** A notification a few seconds out, so "does this work" has an answer now. */
export async function sendTestNotification(): Promise<void> {
  const plugin = nativeNotifications();
  if (!plugin) return;
  await ensureChannel(plugin);
  await plugin.schedule({
    notifications: [
      {
        id: TEST_ID,
        title: "PIT reminder — this is a test",
        body: "The real one arrives at the hour you chose.",
        channelId: CHANNEL_ID,
        autoCancel: true,
        extra: { url: "/" },
        schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
      },
    ],
  });
}
