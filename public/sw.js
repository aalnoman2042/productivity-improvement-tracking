/**
 * Minimal service worker: makes the app installable, keeps it usable when the
 * connection drops, and receives the nightly reminder.
 *
 * Pages go to the network first, cache as the offline fallback: `/` serves a
 * different document signed in (the log) and signed out (the pitch), so a
 * cached copy from the other state must never paint on a refresh. The build
 * assets under /_next/static are content-hashed and served cache-first — they
 * are most of the payload, which keeps an online open fast anyway.
 *
 * API calls are never cached here — the pages hold their own copy of the last
 * response and know when it's stale, which the service worker can't.
 */
const CACHE = "pit-v7";
const OFFLINE_FALLBACK = "/";

/**
 * How long a navigation waits on the network before the cached copy steps
 * in. Long enough for any healthy connection to answer; short enough that a
 * connection that's up but going nowhere shows the app, not a white screen.
 */
const NAV_TIMEOUT_MS = 3500;

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
    // The four bottom-nav tabs, and the calendar behind Status. This list
    // drifted once already: it kept /history — which stopped being a tab —
    // and never gained /status, which took its slot. Offline, that meant the
    // most-read screen in the app was the one with nothing to fall back on.
    // If the nav changes, this changes with it (and CACHE gets a new name).
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["/", "/dashboard", "/status", "/trackers", "/history"])
      )
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

  // Navigations are network-first: the right page for the current sign-in
  // state, every time. The cached copy — always the last page this device
  // actually received — steps in when the network fails or dawdles past the
  // timeout; either way the fetch keeps running so the cache stays fresh.
  if (request.mode === "navigate") {
    const fromNet = fetchAndCache(request);
    event.waitUntil(fromNet.catch(() => null));
    event.respondWith(
      (async () => {
        const winner = await Promise.race([
          fromNet.catch(() => null),
          new Promise((resolve) =>
            setTimeout(() => resolve("timeout"), NAV_TIMEOUT_MS)
          ),
        ]);
        if (winner && winner !== "timeout") return winner;
        const cached = await caches.match(request);
        if (cached) return cached;
        // Nothing cached to fall back on — give the network its full time.
        return fromNet.catch(async () => {
          const fallback = await caches.match(OFFLINE_FALLBACK);
          return fallback || new Response("Offline", { status: 503 });
        });
      })()
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve what we have now and fetch a fresh copy for next time. A
        // failure here is fine — the cached response has already gone out.
        const updating = fetchAndCache(request).catch(() => null);
        if (!isImmutable(url)) event.waitUntil(updating);
        return cached;
      }

      return fetchAndCache(request).catch(
        () => new Response("Offline", { status: 503 })
      );
    })
  );
});

/* ------------------------ background sync ----------------------------- */

/**
 * The page mirrors its offline queue into IndexedDB (`pit-sync`/`jobs`) and
 * registers a "pit-flush" sync, because localStorage — where the queue really
 * lives — is invisible from here. When the browser decides the connection is
 * back, this replays the mirrored jobs and records what landed in `sent`;
 * the page folds that ledger back into its own queue on next open.
 *
 * Throwing on failure is deliberate: a rejected waitUntil is what tells the
 * browser to fire the sync again later.
 */
function openSyncDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("pit-sync", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("jobs")) {
        db.createObjectStore("jobs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sent")) {
        db.createObjectStore("sent", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbWrite(db, store, act) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    act(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushQueuedJobs() {
  const db = await openSyncDb();
  const jobs = (await idbAll(db, "jobs")).sort((a, b) => a.at - b.at);
  for (const job of jobs) {
    let res;
    try {
      res = await fetch(job.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job.body),
        credentials: "same-origin",
      });
    } catch (err) {
      db.close();
      throw err; // still offline — the browser will retry the sync
    }
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      // Delivered, or something the server will never take — either way it
      // leaves the queue. 4xx matches the in-page flush's behaviour.
      await idbWrite(db, "jobs", (s) => s.delete(job.id));
      await idbWrite(db, "sent", (s) => s.put({ id: job.id, at: Date.now() }));
    } else {
      db.close();
      throw new Error("server " + res.status); // 5xx — retry later
    }
  }
  db.close();
}

self.addEventListener("sync", (event) => {
  if (event.tag === "pit-flush") event.waitUntil(flushQueuedJobs());
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
