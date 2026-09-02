import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";
import { addDays, toDateStr } from "../lib/dates";

/**
 * The running timer, at the layer where the whole feature is either true or
 * a lie: whether one device can see and end what another one started.
 *
 * The rules worth a test are the ones that only bite across devices and a
 * bad connection — a start that spent the night in the offline queue must
 * not displace the timer running now, and a stop replayed just as late must
 * not take down one begun since.
 */

const USER = new ObjectId();
const STUDY = new ObjectId();
const SLEEP = new ObjectId();
const STRANGER = new ObjectId();

let fake: FakeDb;

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER,
}));

vi.mock("@/lib/db", () => ({
  db: async () => fake,
  dbReady: async () => fake,
}));

const timer = await import("@/app/api/timer/route");

const TODAY = toDateStr(new Date());
const YESTERDAY = addDays(TODAY, -1);

const write = (body: unknown) =>
  timer.POST(
    new Request("http://localhost/api/timer", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

const read = async () => (await timer.GET()).json();

/** A stopwatch begun `minutesAgo` minutes ago, the way a client sends one. */
const start = (minutesAgo: number, over = {}) => ({
  trackerId: String(STUDY),
  date: TODAY,
  startedAt: Date.now() - minutesAgo * 60_000,
  kind: "duration",
  ...over,
});

beforeEach(() => {
  fake = new FakeDb({
    trackers: [
      { _id: STUDY, userId: USER, name: "Study", type: "duration", archived: false },
      { _id: SLEEP, userId: USER, name: "Sleep", type: "sleep", archived: false },
      { _id: STRANGER, userId: new ObjectId(), name: "Theirs", type: "duration" },
    ],
  });
});

describe("POST /api/timer — starting", () => {
  it("records the timer so another device can find it", async () => {
    const begun = start(10);
    const res = await write(begun);
    expect(res.status).toBe(200);

    const { running } = await read();
    expect(running).toEqual({
      trackerId: String(STUDY),
      date: TODAY,
      startedAt: begun.startedAt,
      kind: "duration",
    });
  });

  it("keeps one row per person, however many starts arrive", async () => {
    await write(start(30));
    await write(start(2, { trackerId: String(SLEEP), kind: "nap" }));
    expect(fake.rows("timers")).toHaveLength(1);
    expect((await read()).running.kind).toBe("nap");
  });

  it("stores real BSON types, not whatever JSON arrived", async () => {
    await write(start(5));
    const row = fake.rows("timers")[0];
    expect(row.trackerId).toBeInstanceOf(ObjectId);
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("refuses a tracker belonging to somebody else", async () => {
    const res = await write(start(5, { trackerId: String(STRANGER) }));
    expect(res.status).toBe(404);
    expect(fake.rows("timers")).toHaveLength(0);
  });

  it("refuses a day nobody has lived — the guard the log itself has", async () => {
    const res = await write(start(5, { date: addDays(TODAY, 2) }));
    expect(res.status).toBe(400);
    expect(fake.rows("timers")).toHaveLength(0);
  });

  it("refuses a start in the future, which is a broken clock talking", async () => {
    const res = await write({ ...start(0), startedAt: Date.now() + 60 * 60_000 });
    expect(res.status).toBe(400);
    expect(fake.rows("timers")).toHaveLength(0);
  });

  it("keeps a timer started yesterday — a nap is stopped on its own day", async () => {
    const res = await write(
      start(600, { trackerId: String(SLEEP), date: YESTERDAY, kind: "nap" })
    );
    expect(res.status).toBe(200);
    expect((await read()).running.date).toBe(YESTERDAY);
  });
});

describe("POST /api/timer — a start delivered late", () => {
  it("does not displace the timer running now", async () => {
    const now = start(1);
    await write(now);

    // Begun on a phone with no signal an hour ago, flushed only now.
    const stale = start(60);
    const res = await write(stale);
    expect(res.status).toBe(200);

    const { running } = await read();
    expect(running.startedAt).toBe(now.startedAt);
    expect(fake.rows("timers")).toHaveLength(1);
  });

  it("does replace an older one — the newer timer is the real one", async () => {
    await write(start(60));
    const fresh = start(1);
    await write(fresh);
    expect((await read()).running.startedAt).toBe(fresh.startedAt);
  });
});

describe("POST /api/timer — stopping", () => {
  it("ends the timer for every device at once", async () => {
    const begun = start(20);
    await write(begun);

    const res = await write({ stop: true, startedAt: begun.startedAt });
    expect(res.status).toBe(200);
    expect((await res.json()).running).toBeNull();
    expect((await read()).running).toBeNull();
  });

  it("stops whatever is running when the stop names nothing", async () => {
    await write(start(20));
    await write({ stop: true, startedAt: null });
    expect((await read()).running).toBeNull();
  });

  it("names the timer it was pressed on, so a late stop spares a new one", async () => {
    const old = start(120);
    await write(old);

    // Stopped on the phone while it was offline; meanwhile a new timer was
    // started on the laptop, and only then does the stop get through.
    const fresh = start(1);
    await write(fresh);
    await write({ stop: true, startedAt: old.startedAt });

    expect((await read()).running.startedAt).toBe(fresh.startedAt);
  });
});

describe("GET /api/timer", () => {
  it("says null when nothing is running, which is an answer, not a gap", async () => {
    expect((await read()).running).toBeNull();
  });
});
