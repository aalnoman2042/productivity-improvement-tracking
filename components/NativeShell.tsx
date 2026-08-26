"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  cancelDailyReminder,
  isNativeShell,
  nativeApp,
  nativeNotifications,
  scheduleDailyReminder,
} from "@/lib/native";
import { DEFAULT_REMINDER_TIME } from "@/lib/reminders";

/**
 * The three things the Android shell has to be told, and nowhere else to say
 * them. Renders nothing; it exists to hold listeners for as long as the app
 * is open. In a browser it does nothing at all and costs one string compare.
 *
 * It lives in the root layout rather than on a page because all three are
 * facts about the *app being open*, not about any screen in it.
 */
export default function NativeShell() {
  const router = useRouter();
  /** The last reminder time the server told us, so a resume with no signal
   *  can still re-arm the alarm rather than dropping it. */
  const knownTime = useRef<string | null>(null);

  /**
   * Back means back.
   *
   * Without a listener the shell decides for itself, and both of its answers
   * are wrong: with `@capacitor/app` absent, back kills the app from any
   * screen; with it present and nobody listening, back at the first screen
   * does *nothing at all*, which reads as a frozen app. So: go back through
   * history while there is history, and otherwise drop to the home screen
   * with the app still running — `minimizeApp`, not `exitApp`, because
   * leaving is not the same as quitting, and a killed app is one whose
   * alarms Android may not re-arm until it is opened again.
   */
  useEffect(() => {
    if (!isNativeShell()) return;
    const app = nativeApp();
    if (!app) return;

    let handle: { remove: () => Promise<void> } | null = null;
    let dropped = false;

    void app
      .addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void app.minimizeApp();
      })
      .then((h) => {
        if (dropped) void h.remove();
        else handle = h;
      });

    return () => {
      dropped = true;
      void handle?.remove();
    };
  }, []);

  /**
   * Keep the device's alarm in step with the account's setting.
   *
   * Two reasons this runs on every resume rather than once. The plugin's
   * `allowWhileIdle` exempts only the *next* occurrence from Doze, so an app
   * left unopened for a week is an app whose reminder drifts; re-scheduling
   * renews the exemption. And Android throws alarms away on a force-stop, a
   * storage clear, or a reboot before first unlock — the plugin repairs what
   * it can when it loads, but the setting still has to be re-asserted from
   * the one place that knows it.
   *
   * The fetch is allowed to fail. Offline, or signed out, the last known
   * hour is re-armed rather than lost — the wrong thing to do here would be
   * to conclude "no answer" means "no reminder".
   */
  useEffect(() => {
    if (!isNativeShell()) return;

    const reconcile = async () => {
      try {
        const res = await fetch("/api/reminders");
        if (res.ok) {
          const status = (await res.json()) as { enabled?: boolean; time?: string };
          if (!status.enabled) {
            knownTime.current = null;
            await cancelDailyReminder();
            return;
          }
          knownTime.current = status.time ?? DEFAULT_REMINDER_TIME;
        }
      } catch {
        /* No signal, or no session. Fall through to the last known hour. */
      }
      if (knownTime.current) await scheduleDailyReminder(knownTime.current);
    };

    void reconcile();

    const app = nativeApp();
    if (!app) return;

    let handle: { remove: () => Promise<void> } | null = null;
    let dropped = false;

    void app.addListener("resume", () => void reconcile()).then((h) => {
      if (dropped) void h.remove();
      else handle = h;
    });

    return () => {
      dropped = true;
      void handle?.remove();
    };
  }, []);

  /**
   * A tapped reminder should land on the thing it was asking about. The
   * notification carries the route it means; anything else is ignored rather
   * than guessed at, so a future notification cannot navigate somewhere this
   * code has never heard of.
   */
  useEffect(() => {
    if (!isNativeShell()) return;
    const plugin = nativeNotifications();
    if (!plugin) return;

    let handle: { remove: () => Promise<void> } | null = null;
    let dropped = false;

    void plugin
      .addListener("localNotificationActionPerformed", ({ notification }) => {
        const extra = notification.extra as { url?: unknown } | undefined;
        const url = typeof extra?.url === "string" ? extra.url : null;
        if (url && url.startsWith("/") && window.location.pathname !== url) {
          router.push(url);
        }
      })
      .then((h) => {
        if (dropped) void h.remove();
        else handle = h;
      });

    return () => {
      dropped = true;
      void handle?.remove();
    };
  }, [router]);

  return null;
}
