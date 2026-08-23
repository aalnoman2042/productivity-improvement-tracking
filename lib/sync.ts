/**
 * Offline-first writes, WhatsApp style.
 *
 * Saving while offline (or on a flaky connection) parks the request in a
 * local queue and reports success. The queue is replayed in order as soon as
 * the connection comes back, so nothing you type is ever lost.
 *
 * Reads are cached too, so opening the app with no signal still shows your
 * trackers and the day you last looked at.
 */

const QUEUE_KEY = "pit_sync_queue";
const CACHE_PREFIX = "pit_cache:";
const CHANGE_EVENT = "pit-sync-change";
const CACHE_EVENT = "pit-cache-change";

export type Job = { id: string; path: string; body: unknown; at: number };
export type PostResult = "sent" | "queued";

const isBrowser = () => typeof window !== "undefined";

/* ------------------------------- queue -------------------------------- */

export function getQueue(): Job[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as Job[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(jobs: Job[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs));
  } catch {
    /* storage full or blocked — nothing useful to do */
  }
  // Mirror into IndexedDB — the one store the service worker can also read —
  // and ask for a background sync, so the queue drains even if this tab is
  // closed before the connection returns.
  void mirrorQueue(jobs);
  if (jobs.length > 0) void requestBackgroundFlush();
  announce();
}

/* --------------------- background sync (via the SW) -------------------- */

/**
 * The service worker can't read localStorage, so the queue is mirrored into
 * IndexedDB for it: `jobs` is the queue as this page last knew it, `sent` is
 * where the worker records what it managed to deliver. On the next flush the
 * page folds `sent` back in, so a job is never sent twice on purpose — and a
 * duplicate is harmless anyway, since replaying a day's values is idempotent.
 *
 * Browsers without Background Sync (iOS) skip all of this: the queue still
 * drains whenever a tab is open, exactly as before.
 */
const IDB_NAME = "pit-sync";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no idb"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
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

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function mirrorQueue(jobs: Job[]): Promise<void> {
  try {
    const db = await openIdb();
    const tx = db.transaction("jobs", "readwrite");
    const store = tx.objectStore("jobs");
    store.clear();
    for (const job of jobs) store.put(job);
    await txDone(tx);
    db.close();
  } catch {
    /* no IndexedDB — background flushing just won't happen */
  }
}

async function requestBackgroundFlush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (
      reg as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      }
    )?.sync;
    await sync?.register("pit-flush");
  } catch {
    /* unsupported or denied — the in-page flush still runs */
  }
}

/**
 * Fold in whatever the service worker delivered while no tab was open:
 * drop those jobs from the local queue, then clear the worker's ledger.
 */
async function reconcileSent(): Promise<void> {
  try {
    const db = await openIdb();
    const read = db.transaction("sent", "readonly");
    const ids: string[] = await new Promise((resolve, reject) => {
      const req = read.objectStore("sent").getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error);
    });
    if (ids.length > 0) {
      const done = new Set(ids);
      writeQueue(getQueue().filter((j) => !done.has(j.id)));
      const clear = db.transaction("sent", "readwrite");
      clear.objectStore("sent").clear();
      await txDone(clear);
    }
    db.close();
  } catch {
    /* nothing to reconcile */
  }
}

export function pendingCount(): number {
  return getQueue().length;
}

function announce() {
  if (isBrowser()) window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Fires whenever the queue or the connection state changes. */
export function onSyncChange(handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}

type DayEntry = { trackerId: string; [k: string]: unknown };
type DayBody = { date?: unknown; entries?: unknown };

/**
 * Fold two queued saves of the same day into one. Saves are partial — each
 * carries only the trackers that changed — so a plain "later replaces
 * earlier" would drop rows the first save had and the second didn't. Merged
 * by trackerId instead, later values winning.
 */
export function mergeDayEntries(earlier: unknown, later: unknown): DayEntry[] {
  const byId = new Map<string, DayEntry>();
  for (const list of [earlier, later]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (e && typeof e.trackerId === "string") byId.set(e.trackerId, e);
    }
  }
  return [...byId.values()];
}

function enqueue(path: string, body: unknown) {
  const jobs = getQueue();
  const job: Job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    body,
    at: Date.now(),
  };
  const mergeable =
    path === "/api/entries" && typeof (body as DayBody)?.date === "string";
  let next = jobs;
  if (mergeable) {
    const date = (body as DayBody).date;
    const prior = jobs.find(
      (j) => j.path === "/api/entries" && (j.body as DayBody)?.date === date
    );
    if (prior) {
      job.body = {
        date,
        entries: mergeDayEntries(
          (prior.body as DayBody).entries,
          (body as DayBody).entries
        ),
      };
      next = jobs.filter((j) => j !== prior);
    }
  }
  writeQueue([...next, job]);
}

/** Every write that is *about one day* and could resurrect a deleted one. */
const DAY_WRITES = [
  "/api/entries",
  "/api/entries/increment",
  "/api/notes",
  // Adding a task carries its date, so a queued one could bring back a day
  // that was deleted while offline. (Ticking and removing a task address it
  // by id at /api/tasks/<id> and carry no date, so they can't resurrect a
  // day — the row they refer to is already gone with it.)
  "/api/tasks",
];

/**
 * Forget any queued save for these days. Used after deleting a date range:
 * without this, a save typed while offline would replay afterwards and
 * bring the deleted day back — a note typed on a phone with no signal counts
 * too, since the day it belonged to is gone.
 */
export function dropQueuedDays(dates: string[]) {
  if (dates.length === 0) return;
  const drop = new Set(dates);
  const jobs = getQueue();
  const kept = jobs.filter(
    (j) =>
      !(
        DAY_WRITES.includes(j.path) &&
        drop.has(String((j.body as { date?: string })?.date))
      )
  );
  if (kept.length !== jobs.length) writeQueue(kept);
}

/* ------------------------------- writes ------------------------------- */

class PermanentError extends Error {}

async function send(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Post now if we can, otherwise queue it. Throws only when the server
 * rejects the data itself (a 4xx), which queueing would never fix.
 */
export async function post(path: string, body: unknown): Promise<PostResult> {
  if (isBrowser() && navigator.onLine) {
    try {
      const res = await send(path, body);
      if (res.ok) {
        void flush(); // good connection — drain anything waiting
        return "sent";
      }
      if (res.status === 401) {
        window.location.assign("/login");
        throw new PermanentError("Signed out");
      }
      if (res.status >= 400 && res.status < 500) {
        const data = await res.json().catch(() => null);
        throw new PermanentError(data?.error ?? "Could not save");
      }
      // 5xx — server trouble, worth retrying later
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      // network failure — fall through and queue
    }
  }
  enqueue(path, body);
  return "queued";
}

let flushing = false;

/** Replay queued writes in order. Stops at the first network failure. */
export async function flush(): Promise<{ sent: number; remaining: number }> {
  if (!isBrowser() || flushing || !navigator.onLine) {
    return { sent: 0, remaining: pendingCount() };
  }
  flushing = true;
  let sent = 0;
  try {
    // First credit anything the service worker already delivered while no
    // tab was open, so it isn't sent a second time here.
    await reconcileSent();
    let jobs = getQueue();
    while (jobs.length > 0) {
      const job = jobs[0];
      let drop = false;
      try {
        const res = await send(job.path, job.body);
        if (res.ok) {
          drop = true;
          sent++;
        } else if (res.status >= 400 && res.status < 500) {
          drop = true; // the server will never accept it; don't block the rest
        } else {
          break; // 5xx — try again later
        }
      } catch {
        break; // still offline
      }
      if (drop) {
        jobs = jobs.slice(1);
        writeQueue(jobs);
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, remaining: pendingCount() };
}

/* -------------------------- cached reads ------------------------------ */

export function cacheSet(key: string, value: unknown) {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CACHE_EVENT));
}

/**
 * Drop every cached read at once. For the moments the server's data changes
 * out from under the cache wholesale — restoring a backup — where patching
 * keys one by one would inevitably miss some.
 */
export function cacheClearAll() {
  if (!isBrowser()) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CACHE_EVENT));
}

export function cacheRemove(key: string) {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CACHE_EVENT));
}

/**
 * The cache as a store components can subscribe to.
 *
 * Parsed values are memoised against the raw text they came from, so a
 * component that re-reads an unchanged key gets the *same object* back and
 * doesn't re-render. That's what makes this safe for useSyncExternalStore.
 */
const snapshots = new Map<string, { raw: string | null; value: unknown }>();

export function cacheSnapshot<T>(key: string): T | null {
  if (!isBrowser()) return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
  const memo = snapshots.get(key);
  if (memo && memo.raw === raw) return memo.value as T | null;

  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    value = null;
  }
  snapshots.set(key, { raw, value });
  return value as T | null;
}

/** Fires when any cached key is written — including from another tab. */
export function subscribeCache(handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(CACHE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CACHE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function cacheGet<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** GET that falls back to the last cached copy when the network is down. */
export async function getCached<T>(
  path: string,
  key: string
): Promise<{ data: T | null; stale: boolean }> {
  try {
    const res = await fetch(path);
    if (res.status === 401) {
      window.location.assign("/login");
      return { data: null, stale: false };
    }
    if (res.ok) {
      const data = (await res.json()) as T;
      cacheSet(key, data);
      return { data, stale: false };
    }
  } catch {
    /* offline */
  }
  return { data: cacheGet<T>(key), stale: true };
}
