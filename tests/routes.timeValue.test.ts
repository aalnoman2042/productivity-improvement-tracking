import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";
import { toDateStr, addDays } from "../lib/dates";

/**
 * Pricing an hour, and what the Stats page reads back.
 *
 * The route is where "every tracked minute" actually has to be true, so this
 * is the layer worth testing it at: the arithmetic is proven in
 * `timeValue.test.ts`, and here it is proven that the handler feeds it every
 * row it should and nothing it shouldn't.
 */

const USER = new ObjectId();
const STUDY = new ObjectId();
const SCROLL = new ObjectId();
const SLEEP = new ObjectId();
const WATER = new ObjectId();

let fake: FakeDb;

vi.mock("@/lib/session", () => ({ currentUserId: async () => USER }));
vi.mock("@/lib/db", () => ({ db: async () => fake, dbReady: async () => fake }));

const timeValue = await import("@/app/api/time-value/route");
const spend = await import("@/app/api/stats/spend/route");

const TODAY = toDateStr(new Date());

const setPrice = (body: unknown) =>
  timeValue.PATCH(
    new Request("http://localhost/api/time-value", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );

const read = (period = "week") =>
  spend.GET(
    new Request(`http://localhost/api/stats/spend?period=${period}&today=${TODAY}`)
  );

/** Minutes on a tracker, `back` days ago. */
const logged = (trackerId: ObjectId, value: number, back = 1) => ({
  userId: USER,
  trackerId,
  date: addDays(TODAY, -back),
  value,
});

beforeEach(() => {
  fake = new FakeDb({
    users: [{ _id: USER, name: "Owner" }],
    trackers: [
      { _id: STUDY, userId: USER, name: "Study", type: "duration", habit: "good", unit: "min", color: "#111111", category: "study", archived: false, order: 0 },
      { _id: SCROLL, userId: USER, name: "Screen time", type: "duration", habit: "bad", unit: "min", color: "#222222", category: "other", archived: false, order: 1 },
      { _id: SLEEP, userId: USER, name: "Sleep", type: "sleep", habit: "good", unit: "min", color: "#333333", category: "sleep", archived: false, order: 2 },
      { _id: WATER, userId: USER, name: "Water", type: "count", habit: "good", unit: "glasses", color: "#444444", category: "health", archived: false, order: 3 },
    ],
  });
});

describe("PATCH /api/time-value", () => {
  it("stores the price on the account", async () => {
    const res = await setPrice({ perMinute: 5, currency: "৳" });
    expect(res.status).toBe(200);
    expect(fake.rows("users")[0].timeValue).toEqual({ perMinute: 5, currency: "৳" });
  });

  it("refuses a price that isn't one", async () => {
    expect((await setPrice({ perMinute: 0 })).status).toBe(400);
    expect((await setPrice({ perMinute: "lots" })).status).toBe(400);
  });

  it("can be taken back off — a price is a setting, not a decision", async () => {
    await setPrice({ perMinute: 5, currency: "৳" });
    const res = await setPrice({ perMinute: null });
    expect(res.status).toBe(200);
    expect(fake.rows("users")[0].timeValue).toBeNull();
  });
});

describe("GET /api/stats/spend", () => {
  it("says nothing at all until a price exists", async () => {
    const body = await (await read()).json();
    expect(body).toEqual({ value: null });
  });

  it("prices every tracked minute, and splits it by the habit flag", async () => {
    await setPrice({ perMinute: 5, currency: "৳" });
    fake.collection("entries").rows.push(
      logged(STUDY, 120),
      logged(SCROLL, 180),
      logged(SLEEP, 420),
      // Not time, and so not priced: eight glasses of water is not 8 minutes.
      logged(WATER, 8)
    );

    const body = await (await read()).json();
    expect(body.window.tracked.minutes).toBe(720);
    expect(body.window.tracked.cost).toBe(3600);
    expect(body.window.burned.minutes).toBe(180);
    expect(body.window.invested.minutes).toBe(120);
    expect(body.window.slept.minutes).toBe(420);
  });

  it("keeps the window and the whole record apart", async () => {
    await setPrice({ perMinute: 5, currency: "৳" });
    fake.collection("entries").rows.push(
      logged(SCROLL, 60, 2),
      // Well outside a week — in the record, out of the window.
      logged(SCROLL, 600, 200)
    );

    const body = await (await read("week")).json();
    expect(body.window.burned.minutes).toBe(60);
    expect(body.allTime.burned.minutes).toBe(660);
    // And "since you started" is measured from the first day on record.
    expect(body.allTime.days).toBeGreaterThan(200);
  });

  it("insists on the reader's own today, and a period it knows", async () => {
    await setPrice({ perMinute: 5, currency: "৳" });
    expect(
      (await spend.GET(new Request("http://localhost/api/stats/spend"))).status
    ).toBe(400);
    expect((await read("fortnight")).status).toBe(400);
  });
});
