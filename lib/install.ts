"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { isNativeShell } from "@/lib/native";

/**
 * Whether PIT can be installed to the home screen, and how.
 *
 * This matters more than it looks. On iPhone, iOS delivers push notifications
 * **only** to installed web apps — so on that platform the nightly reminder
 * isn't a setting you switch on, it's a setting you can't reach until the app
 * has been added to the Home Screen. And Safari fires no install event and
 * offers no install API, so the only way through is to say so and describe the
 * Share sheet.
 *
 * Chrome and Edge do the opposite: they fire `beforeinstallprompt`, which can
 * be held onto and replayed from a button of our own.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * How this particular browser can be installed to — which decides what the
 * install sheet shows, because the four routes have nothing in common.
 *
 *  - `prompt`      Chrome-likes: one tap, we replay the browser's own dialog.
 *  - `ios-safari`  the Share sheet, and nothing else. There is no API.
 *  - `ios-other`   Chrome/Firefox/Edge on iPhone: their Add to Home Screen
 *                  makes a bookmark Apple won't deliver push to. Safari first.
 *  - `in-app`      opened inside Facebook, Instagram, Messenger... These
 *                  webviews have no install route at all, which is the real
 *                  reason "add it to your home screen" so often fails: the
 *                  person followed a link from a chat and never left it.
 *  - `menu`        anything else without a prompt — the browser's own menu.
 */
export type InstallRoute = "prompt" | "ios-safari" | "ios-other" | "in-app" | "menu";

export type InstallState = {
  /** Already running as an installed app — nothing to offer. */
  installed: boolean;
  /** The browser has offered us a prompt we can replay. */
  canPrompt: boolean;
  /** iOS Safari: no prompt exists, so instructions are the only route. */
  needsManual: boolean;
  /** Which set of instructions this browser needs. */
  route: InstallRoute;
  /** Show the prompt. Resolves true if they accepted. */
  promptInstall: () => Promise<boolean>;
};

/** The webviews people actually arrive in, from a link in a chat. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|WhatsApp|TikTok|MicroMessenger/i;

/** iOS browsers that are Safari underneath but not Safari on top. */
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//;

/**
 * Work out the route from a user-agent string. Pure and exported so the
 * unpleasant part — guessing a browser from a string that lies on purpose —
 * is tested against real user agents rather than reasoned about.
 */
export function detectRoute(ua: string, canPrompt: boolean): InstallRoute {
  // A real prompt beats every guess: if the browser offered one, take it.
  if (canPrompt) return "prompt";
  const ios = /iPad|iPhone|iPod/.test(ua);
  if (IN_APP.test(ua)) return "in-app";
  if (ios && IOS_OTHER.test(ua)) return "ios-other";
  if (ios) return "ios-safari";
  return "menu";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS's own, non-standard flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    // The Android APK. A plain WebView matches neither of the above — it is
    // not a browser in standalone mode, it is not a browser — so without
    // this the installed app spends its life offering to install itself.
    isNativeShell()
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * "Am I running installed?" is a browser fact the server cannot know, so it's
 * read through `useSyncExternalStore` rather than assigned from an effect:
 * the server snapshot is simply false, the client reads the real value on its
 * first render, and installing while the page is open updates it.
 */
function subscribeDisplayMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

const readStandalone = () => isStandalone();
const readNeedsManual = () => isIOS() && !isStandalone();
const serverFalse = () => false;

export function useInstall(): InstallState {
  const installed = useSyncExternalStore(
    subscribeDisplayMode,
    readStandalone,
    serverFalse
  );
  const needsManual = useSyncExternalStore(
    subscribeDisplayMode,
    readNeedsManual,
    serverFalse
  );

  // This one genuinely is event-driven: the browser hands us the prompt when
  // it decides we're eligible, which may be well after mount.
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the event rather than letting the browser show its own bar, so
      // the offer appears where it's relevant instead of over the page.
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    // Once installed the prompt is spent, and `installed` above has already
    // flipped through the media query.
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // A prompt can only be replayed once; the browser fires a fresh event if
    // they decline and become eligible again.
    setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  const canPrompt = deferred !== null;

  return {
    installed,
    canPrompt,
    needsManual: needsManual && !installed,
    route: detectRoute(
      typeof navigator === "undefined" ? "" : navigator.userAgent,
      canPrompt
    ),
    promptInstall,
  };
}
