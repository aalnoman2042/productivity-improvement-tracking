import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";

/**
 * The first route tests this project has ever had.
 *
 * Every bug that actually hurt here lived at this layer: the day log wiping
 * `entries.note` on every save, and a cron nobody was calling. Both passed
 * every unit test in `lib/`, because neither was arithmetic — they were about
 * what a *handler* does with a request.
 *
 * The database is a stand-in (`tests/helpers/fakeDb`) and the session is
 * mocked, so these run offline and in milliseconds, like everything else here.
 */

const USER = new ObjectId();
const STUDY = new ObjectId();
const SLEEP = new ObjectId();
const WATER = new ObjectId();

let fake: FakeDb;

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER,
}));

vi.mock("@/lib/db", () => ({
  db: async () => fake,
  dbReady: async () => fake,
}));

const { POST, GET } = await import("@/app/api/entries/route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/entries", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

/** Yesterday, so nothing here trips the "not yet lived" guard. */
const DAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  fake = new FakeDb({
    trackers: [
      { _id: STUDY, userId: USER, name: "Study", type: "duration" },
      { _id: SLEEP, userId: USER, name: "Sleep", type: "sleep" },
      { _id: WATER, userId: USER, name: "Water", type: "count" },
    ],
  });
});

describe("POST /api/entries", () => {
  it("writes a day", async () => {
    const res = await post({
      date: DAY,
      entries: [{ trackerId: String(WATER), value: 6 }],
    });
    expect(res.status).toBe(200);
    expect(fake.rows("entries")).toHaveLength(1);
    expect(fake.rows("entries")[0].value).toBe(6);
  });

  /**
   * The bug this test exists for: the day log sent no note, so the route
   * wrote `note: null` over whatever had been written — every save, silently.
   * It shipped for weeks and no `lib` test could have seen it.
   */
  it("writes the note it is given, and keeps it on the next save", async () => {
    await post({
      date: DAY,
      entries: [{ trackerId: String(WATER), value: 6, note: "with lemon" }],
    });
    expect(fake.rows("entries")[0].note).toBe("with lemon");

    await post({
      date: DAY,
      entries: [{ trackerId: String(WATER), value: 7, note: "with lemon" }],
    });
    expect(fake.rows("entries")[0].value).toBe(7);
    expect(fake.rows("entries")[0].note).toBe("with lemon");
  });

  it("clears the day when a value goes back to nothing", async () => {
    await post({ date: DAY, entries: [{ trackerId: String(WATER), value: 6 }] });
    await post({ date: DAY, entries: [{ trackerId: String(WATER), value: 0 }] });
    expect(fake.rows("entries")).toHaveLength(0);
  });

  it("but a slip is not nothing — it is a zero that stays", async () => {
    await post({
      date: DAY,
      entries: [
        {
          trackerId: String(WATER),
          value: 0,
          meta: { status: "slip" },
          note: "up until 3",
        },
      ],
    });
    expect(fake.rows("entries")).toHaveLength(1);
    expect(fake.rows("entries")[0].value).toBe(0);
  });

  /**
   * Invariant: **nothing stands between a person and their own record.**
   *
   * The app asks why a slip happened — the box opens with the tap, and the
   * daily page lists what is still unexplained. It must never *refuse* one.
   * This test exists because for one afternoon it did: a 400 here, a
   * blocked save on the daily page, and a Catch up that silently declined
   * to send the tap. Backfilling a month failed with no error and no clue.
   * A slip you couldn't put words to is still a slip that happened.
   */
  it("records a slip that doesn't say why", async () => {
    const res = await post({
      date: DAY,
      entries: [
        { trackerId: String(WATER), value: 0, meta: { status: "slip" } },
      ],
    });
    expect(res.status).toBe(200);
    expect(fake.rows("entries")).toHaveLength(1);
    expect((fake.rows("entries")[0].meta as { status: string }).status).toBe(
      "slip"
    );
    expect(fake.rows("entries")[0].note).toBe(null);
  });

  it("records a whole month of them, one after another", async () => {
    // The shape of the bug: backfilling day after day, every one refused.
    for (let d = 1; d <= 28; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      const res = await post({
        date,
        entries: [
          { trackerId: String(WATER), value: 0, meta: { status: "slip" } },
        ],
      });
      expect(res.status).toBe(200);
    }
    expect(fake.rows("entries")).toHaveLength(28);
  });

  it("keeps the reason when there is one", async () => {
    const res = await post({
      date: DAY,
      entries: [
        {
          trackerId: String(WATER),
          value: 0,
          meta: { status: "slip" },
          note: "up until 3",
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(fake.rows("entries")[0].note).toBe("up until 3");
  });

  /** Invariant 1: a day only has 24 hours, and the server is what enforces it. */
  it("refuses a day of more than 24 hours of logged time", async () => {
    const res = await post({
      date: DAY,
      entries: [
        { trackerId: String(STUDY), value: 800 },
        { trackerId: String(SLEEP), value: 700 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only has 24 hours/);
    expect(fake.rows("entries")).toHaveLength(0);
  });

  it("counts what is already stored towards that 24 hours", async () => {
    await post({ date: DAY, entries: [{ trackerId: String(SLEEP), value: 700 }] });
    const res = await post({
      date: DAY,
      entries: [{ trackerId: String(STUDY), value: 800 }],
    });
    expect(res.status).toBe(400);
  });

  /** Invariant 8: a day nobody has lived cannot be logged, even by hand. */
  it("refuses a day that hasn't happened", async () => {
    const far = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await post({
      date: far,
      entries: [{ trackerId: String(WATER), value: 1 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/hasn't happened/);
  });

  it("refuses a body that isn't one", async () => {
    expect((await post({ date: "yesterday", entries: [] })).status).toBe(400);
    expect((await post({ date: DAY, entries: "nope" })).status).toBe(400);
    expect(
      (await post({ date: DAY, entries: [{ trackerId: "not-an-id", value: 1 }] }))
        .status
    ).toBe(400);
    expect(
      (await post({ date: DAY, entries: [{ trackerId: String(WATER), value: -1 }] }))
        .status
    ).toBe(400);
  });
});

describe("GET /api/entries", () => {
  it("returns the day, with its notes and meta", async () => {
    await post({
      date: DAY,
      entries: [{ trackerId: String(WATER), value: 6, note: "with lemon" }],
    });
    const res = await GET(
      new Request(`http://localhost/api/entries?date=${DAY}`)
    );
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toEqual([
      { trackerId: String(WATER), value: 6, note: "with lemon", meta: null },
    ]);
  });

  it("insists on a real date", async () => {
    const res = await GET(new Request("http://localhost/api/entries?date=soon"));
    expect(res.status).toBe(400);
  });
});
