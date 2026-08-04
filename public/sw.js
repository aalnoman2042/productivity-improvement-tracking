/**
 * Minimal service worker: makes the app installable, keeps it usable when the
 * connection drops, and receives the nightly reminder.
 *
 * The app shell is served from the cache first and refreshed in the
 * background, so opening PIT paints immediately instead of waiting on the
 * network for HTML and JavaScript it already has. Build assets under
 * /_next/static are content-hashed, so those can be cached outright.
 *
 * API calls are never cached here — the pages hold their own copy of the last
 * response and know when it's stale, which the service worker can't.
 */
const CACHE = "pit-v4";
const OFFLINE_FALLBACK = "/";

/** Hashed build output: the URL changes whenever the file does. */
const isImmutable = (url) => url.pathname.startsWith("/_next/static/");

/**
 * React Server Component payloads are tied to the running build, so a stale
 * one can't be handed to a newer client. Always fetch these.
 */
const isVersioned = (url, request) =>
  url.searchParams.has("_rsc") ||
  request.headers.get("RSC") === "1" ||
  request.headers.get("Next-Router-Prefetch") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/", "/dashboard", "/history", "/trackers"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/** Fetch, and quietly keep the cached copy up to date. */
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live data
  if (isVersioned(url, request)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve what we have now and fetch a fresh copy for next time. A
        // failure here is fine — the cached response has already gone out.
        const updating = fetchAndCache(request).catch(() => null);
        if (!isImmutable(url)) event.waitUntil(updating);
        return cached;
      }

      return fetchAndCache(request).catch(async () => {
        if (request.mode === "navigate") {
          const fallback = await caches.match(OFFLINE_FALLBACK);
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
      });
    })
  );
});

/* ------------------------- nightly reminder --------------------------- */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* not our payload — show the generic nudge below */
  }

  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "Log your day", {
      body: data.body || "Add today's trackers in PIT.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "pit-reminder",
      // Replace yesterday's unread nudge rather than stacking a new one,
      // but still buzz — a silent replacement is easy to sleep through.
      renotify: Boolean(data.tag),
      vibrate: [80, 40, 80],
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);

  // Reuse an open PIT window if there is one — nobody wants a third copy of
  // the app opening at midnight.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (new URL(client.url).origin === target.origin && "navigate" in client) {
            return client.navigate(target.href).then((c) => c && c.focus());
          }
        }
        return self.clients.openWindow(target.href);
      })
  );
});
