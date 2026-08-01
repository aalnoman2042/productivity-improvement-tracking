/**
 * Minimal service worker: makes the app installable, keeps it usable when
 * the connection drops, and receives the nightly reminder. Pages and static
 * assets are served network-first with a cache fallback; API calls always go
 * to the network, because stale numbers would be worse than an error.
 */
const CACHE = "pit-v2";
const OFFLINE_FALLBACK = "/today";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["/", "/today", "/trackers"]))
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // always live data

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const fallback = await caches.match(OFFLINE_FALLBACK);
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
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

  const url = data.url || "/today";
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
  const target = new URL(event.notification.data?.url || "/today", self.location.origin);

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
