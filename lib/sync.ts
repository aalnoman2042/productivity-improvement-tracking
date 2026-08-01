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
  announce();
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

function enqueue(path: string, body: unknown) {
  const jobs = getQueue();
  const job: Job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    body,
    at: Date.now(),
  };
  // A later save of the same day replaces the earlier one — no point
  // replaying a version you've already typed over.
  const replaceable =
    path === "/api/entries" &&
    typeof (body as { date?: unknown })?.date === "string";
  const next = replaceable
    ? jobs.filter(
        (j) =>
          !(
            j.path === "/api/entries" &&
            (j.body as { date?: string })?.date ===
              (body as { date?: string }).date
          )
      )
    : jobs;
  writeQueue([...next, job]);
}

/**
 * Forget any queued save for these days. Used after deleting a date range:
 * without this, a save typed while offline would replay afterwards and
 * bring the deleted day back.
 */
export function dropQueuedDays(dates: string[]) {
  if (dates.length === 0) return;
  const drop = new Set(dates);
  const jobs = getQueue();
  const kept = jobs.filter(
    (j) =>
      !(
        (j.path === "/api/entries" || j.path === "/api/entries/increment") &&
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
}

export function cacheRemove(key: string) {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
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
