/// <reference types="@capacitor/local-notifications" />
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android shell.
 *
 * PIT is server-rendered — API routes, a Mongo session, a document that
 * differs signed in and signed out — so there is no static bundle to put
 * inside an app. `server.url` turns that constraint into the feature: the APK
 * carries no copy of PIT at all, it opens the live site. A push to `main`
 * deploys to Vercel and is on the phone at the next launch, with nothing to
 * reinstall. The APK is only ever rebuilt when something *native* changes —
 * the name, the icon, a permission, a plugin, this file.
 *
 * Worth knowing before relying on it: Capacitor documents `server.url` as
 * "not intended for use in production". It is the mechanism live-reload is
 * built on and it is fully supported in the code, but it is not a blessed
 * configuration, so a major upgrade could move it. Pin the versions.
 */
const config: CapacitorConfig = {
  // Half of the app's identity, and the half that cannot change. Android
  // treats a different applicationId as a different app: it would install
  // beside the old one rather than over it, and the old one's data would be
  // stranded. Chosen once, on 2026-08-26, and never again.
  appId: "app.protrackive.pit",
  appName: "PIT",

  // Capacitor insists on a web directory even when it will never serve from
  // it. `cap add android` silently skips its sync step if this is missing —
  // a warning, a green build, and an APK with nothing in it — so it exists,
  // and `error.html` inside it is the one screen the app truly carries.
  webDir: "capacitor/www",

  // What shows while the remote page is still on its way. PIT's own light
  // background, so the launch reads as a pause rather than a white flash.
  backgroundColor: "#f3f4f6",

  server: {
    // A bare origin. A path or fragment here has broken `getPlatform()` in
    // the past; `appStartPath` is the supported way to land somewhere else.
    url: "https://protrackive.vercel.app",
    androidScheme: "https",
    cleartext: false,
    // The trade this makes: `errorPath` catches any main-frame failure,
    // which includes an HTTP 404 from Next.js, so a bad deep link shows
    // this page instead of PIT's own not-found. That is the lesser harm —
    // a blank white WebView with no signal is both commoner and worse, and
    // the page is written to be honest about not knowing which it hit.
    errorPath: "error.html",
  },

  android: {
    // How the web app knows it is running inside the shell. Appended to the
    // WebView's own user agent with a single space, so it is readable from
    // `navigator.userAgent` *and* from the server on every request — which
    // is what lets the page stamp itself before it paints. `lib/native.ts`
    // is the only thing that should read it.
    appendUserAgent: "PITApp/1",
    backgroundColor: "#f3f4f6",
    // PIT ships its own service worker and it knows more about what is
    // stale than Capacitor's request router does. Left at the default,
    // Capacitor intercepts the worker's fetches and the offline layer
    // stops being the thing that decides.
    resolveServiceWorkerRequests: false,
    allowMixedContent: false,
    useLegacyBridge: false,
    // `webContentsDebuggingEnabled` is deliberately absent. Left alone it
    // follows the build: DevTools can attach to a debug APK and cannot attach
    // to the release one people install. Setting it either way would break one
    // of those two.
  },

  plugins: {
    // Android 15 and 16 draw every app edge to edge and offer no way out,
    // so the insets have to reach the page. This publishes them as CSS
    // custom properties, which `globals.css` reads with `env()` as the
    // fallback for browsers that never needed the help.
    SystemBars: { insetsHandling: "css", style: "DEFAULT" },
    App: { disableBackButtonHandler: false },
    LocalNotifications: {
      // A status-bar icon is masked to a silhouette by Android, so it has
      // to be drawn as one. Without this the reminder arrives under the
      // generic system "i".
      smallIcon: "ic_stat_pit",
      iconColor: "#1c5cab",
    },
  },
};

export default config;
