import { beforeEach, describe, expect, it } from "vitest";
import { dropQueuedDays, getQueue, mergeDayEntries, post } from "../lib/sync";

/**
 * The queue logic runs in a browser; these tests hand it just enough of one.
 * `navigator.onLine` is pinned to false so every `post` goes straight to the
 * queue — which is the path being tested.
 */
const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
  },
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    location: { assign() {} },
  },
});

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { onLine: false },
});

beforeEach(() => storage.clear());

describe("post while offline", () => {
  it("queues instead of sending", async () => {
    const result = await post("/api/entries", {
      date: "2026-08-05",
      entries: [{ trackerId: "a", value: 1 }],
    });
    expect(result).toBe("queued");
    expect(getQueue()).toHaveLength(1);
  });

  it("merges two saves of the same day by tracker, later winning", async () => {
    await post("/api/entries", {
      date: "2026-08-05",
      entries: [
        { trackerId: "a", value: 1 },
        { trackerId: "b", value: 2 },
      ],
    });
    await post("/api/entries", {
      date: "2026-08-05",
      entries: [{ trackerId: "b", value: 9 }],
    });

    const queue = getQueue();
    expect(queue).toHaveLength(1);
    const entries = (queue[0].body as { entries: { trackerId: string; value: number }[] })
      .entries;
    // Partial saves: "a" from the first save must survive the second.
    expect(entries).toContainEqual({ trackerId: "a", value: 1 });
    expect(entries).toContainEqual({ trackerId: "b", value: 9 });
    expect(entries).toHaveLength(2);
  });

  it("keeps different days as separate jobs, in order", async () => {
    await post("/api/entries", { date: "2026-08-04", entries: [] });
    await post("/api/entries", { date: "2026-08-05", entries: [] });
    expect(getQueue().map((j) => (j.body as { date: string }).date)).toEqual([
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("never merges across paths", async () => {
    await post("/api/entries", { date: "2026-08-05", entries: [] });
    await post("/api/entries/increment", {
      date: "2026-08-05",
      trackerId: "a",
      minutes: 5,
    });
    expect(getQueue()).toHaveLength(2);
  });
});

describe("dropQueuedDays", () => {
  it("forgets queued saves for deleted days — including timer increments", async () => {
    await post("/api/entries", { date: "2026-08-04", entries: [] });
    await post("/api/entries", { date: "2026-08-05", entries: [] });
    await post("/api/entries/increment", {
      date: "2026-08-04",
      trackerId: "a",
      minutes: 5,
    });

    dropQueuedDays(["2026-08-04"]);
    expect(getQueue().map((j) => (j.body as { date: string }).date)).toEqual([
      "2026-08-05",
    ]);
  });
});

describe("mergeDayEntries", () => {
  it("is later-wins by trackerId", () => {
    const merged = mergeDayEntries(
      [
        { trackerId: "a", value: 1 },
        { trackerId: "b", value: 2 },
      ],
      [{ trackerId: "a", value: 7 }]
    );
    expect(merged).toContainEqual({ trackerId: "a", value: 7 });
    expect(merged).toContainEqual({ trackerId: "b", value: 2 });
    expect(merged).toHaveLength(2);
  });

  it("tolerates garbage", () => {
    expect(mergeDayEntries(null, undefined)).toEqual([]);
    expect(mergeDayEntries([{ nope: 1 }], [{ trackerId: "a", value: 1 }])).toEqual([
      { trackerId: "a", value: 1 },
    ]);
  });
});
