import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";
import { addDays, toDateStr } from "../lib/dates";

/**
 * The rest-day and catch-up routes, at the layer where they can actually be
 * wrong: what they write, what they refuse, and what they count.
 */

const USER = new ObjectId();
const WATER = new ObjectId();

let fake: FakeDb;

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER,
}));

vi.mock("@/lib/db", () => ({
  db: async () => fake,
  dbReady: async () => fake,
}));

const rest = await import("@/app/api/rest/route");
const catchup = await import("@/app/api/catchup/route");

const TODAY = toDateStr(new Date());
const YESTERDAY = addDays(TODAY, -1);

const setRest = (body: unknown) =>
  rest.POST(
    new Request("http://localhost/api/rest", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  fake = new FakeDb({
    trackers: [{ _id: WATER, userId: USER, name: "Water", type: "count", archived: false }],
  });
});

describe("POST /api/rest", () => {
  it("marks a day off, with the reason if one was given", async () => {
    const res = await setRest({ date: YESTERDAY, rest: true, reason: "travelling" });
    expect(res.status).toBe(200);
    const rows = fake.rows("restDays");
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe(YESTERDAY);
    expect(rows[0].reason).toBe("travelling");
  });

  it("writes no entry — a rest day is a flag, never a log", async () => {
    await setRest({ date: YESTERDAY, rest: true });
    expect(fake.rows("entries")).toHaveLength(0);
  });

  it("marks the same day once, however many times it is asked", async () => {
    await setRest({ date: YESTERDAY, rest: true });
    await setRest({ date: YESTERDAY, rest: true, reason: "ill" });
    expect(fake.rows("restDays")).toHaveLength(1);
    expect(fake.rows("restDays")[0].reason).toBe("ill");
  });

  it("takes the mark back off", async () => {
    await setRest({ date: YESTERDAY, rest: true });
    const res = await setRest({ date: YESTERDAY, rest: false });
    expect(res.status).toBe(200);
    expect(fake.rows("restDays")).toHaveLength(0);
  });

  it("refuses a day nobody has lived — the same guard the log has", async () => {
    const res = await setRest({ date: addDays(TODAY, 5), rest: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/hasn't happened/);
    expect(fake.rows("restDays")).toHaveLength(0);
  });

  it("insists on a real date", async () => {
    expect((await setRest({ date: "sunday", rest: true })).status).toBe(400);
  });
});

describe("GET /api/rest", () => {
  it("returns the flags in a window, and nothing outside it", async () => {
    await setRest({ date: YESTERDAY, rest: true, reason: "off" });
    await setRest({ date: addDays(TODAY, -20), rest: true });

    const res = await rest.GET(
      new Request(
        `http://localhost/api/rest?from=${addDays(TODAY, -7)}&to=${TODAY}`
      )
    );
    const body = await res.json();
    expect(body.days).toEqual([{ date: YESTERDAY, reason: "off" }]);
  });

  it("wants both ends of the window", async () => {
    const res = await rest.GET(new Request("http://localhost/api/rest?from=2026-01-01"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/catchup", () => {
  const ask = () =>
    catchup.GET(new Request(`http://localhost/api/catchup?today=${TODAY}&back=7`));

  it("never counts today — the day is still being lived", async () => {
    const body = await (await ask()).json();
    expect(body.days).toHaveLength(7);
    expect(body.days.map((d: { date: string }) => d.date)).not.toContain(TODAY);
    expect(body.days[body.days.length - 1].date).toBe(YESTERDAY);
  });

  it("counts a day with anything on it as logged", async () => {
    fake.collection("entries").rows.push({
      userId: USER,
      trackerId: WATER,
      date: YESTERDAY,
      value: 3,
    });
    const body = await (await ask()).json();
    const day = body.days.find((d: { date: string }) => d.date === YESTERDAY);
    expect(day.logged).toBe(1);
    expect(day.rest).toBe(false);
  });

  it("marks a day that was taken off, so it is not a hole", async () => {
    await setRest({ date: YESTERDAY, rest: true });
    const body = await (await ask()).json();
    const day = body.days.find((d: { date: string }) => d.date === YESTERDAY);
    expect(day.logged).toBe(0);
    expect(day.rest).toBe(true);
  });

  it("says how many trackers there are to log at all", async () => {
    const body = await (await ask()).json();
    expect(body.trackers).toBe(1);
  });

  it("insists on the reader's own today", async () => {
    const res = await catchup.GET(new Request("http://localhost/api/catchup"));
    expect(res.status).toBe(400);
  });
});
