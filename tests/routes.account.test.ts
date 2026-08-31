import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";
import { hashPassword } from "../lib/auth";

/**
 * The two things an account can be: deleted, and allowed the coach.
 *
 * Both are routes rather than arithmetic, so this is the layer that can
 * actually prove them. Deletion especially: it is the one irreversible
 * button in the app, and "did it take every collection with it?" is exactly
 * the question a unit test cannot answer.
 */

const USER = new ObjectId();
const OTHER = new ObjectId();
let fake: FakeDb;
let session: ObjectId | null = USER;

vi.mock("@/lib/session", () => ({ currentUserId: async () => session }));
vi.mock("@/lib/db", () => ({ db: async () => fake, dbReady: async () => fake }));

const del = await import("@/app/api/auth/delete/route");

const post = (body: unknown) =>
  del.POST(
    new Request("http://localhost/api/auth/delete", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

const PASSWORD = "correct horse battery";

beforeEach(() => {
  session = USER;
  fake = new FakeDb({
    users: [
      { _id: USER, email: "me@example.com", name: "Me", passwordHash: hashPassword(PASSWORD) },
      { _id: OTHER, email: "you@example.com", name: "You", passwordHash: hashPassword("other") },
    ],
    entries: [
      { userId: USER, date: "2026-08-01", value: 60 },
      { userId: USER, date: "2026-08-02", value: 30 },
      { userId: OTHER, date: "2026-08-01", value: 90 },
    ],
    trackers: [
      { _id: new ObjectId(), userId: USER, name: "Study" },
      { _id: new ObjectId(), userId: OTHER, name: "Study" },
    ],
    dayNotes: [{ userId: USER, date: "2026-08-01", text: "a good day" }],
    books: [{ userId: USER, title: "A book" }],
    tasks: [{ userId: USER, date: "2026-08-01", text: "a task" }],
    restDays: [{ userId: USER, date: "2026-08-03" }],
    challenges: [{ userId: USER, days: 30 }],
    aiReviews: [{ userId: USER, text: "a read" }],
    pushSubs: [{ userId: USER, endpoint: "https://push.example/1" }],
  });
});

describe("POST /api/auth/delete", () => {
  it("takes the account and every collection it owned", async () => {
    const res = await post({ password: PASSWORD, confirm: "delete my account" });
    expect(res.status).toBe(200);

    for (const name of [
      "entries",
      "trackers",
      "dayNotes",
      "books",
      "tasks",
      "restDays",
      "challenges",
      "aiReviews",
      "pushSubs",
    ]) {
      const mine = fake.rows(name).filter((r) => String(r.userId) === String(USER));
      expect(mine, `${name} still has rows for the deleted user`).toHaveLength(0);
    }
    expect(fake.rows("users").map((u) => String(u._id))).toEqual([String(OTHER)]);
  });

  it("leaves everybody else alone", async () => {
    await post({ password: PASSWORD, confirm: "delete my account" });
    expect(fake.rows("entries")).toHaveLength(1);
    expect(String(fake.rows("entries")[0].userId)).toBe(String(OTHER));
    expect(fake.rows("trackers")).toHaveLength(1);
  });

  it("refuses without the exact phrase", async () => {
    const res = await post({ password: PASSWORD, confirm: "delete" });
    expect(res.status).toBe(400);
    expect(fake.rows("users")).toHaveLength(2);
    expect(fake.rows("entries")).toHaveLength(3);
  });

  it("refuses without the password, however well the phrase is typed", async () => {
    // The session cookie proves the browser logged in once. It does not
    // prove who is holding the phone now.
    const res = await post({ password: "wrong", confirm: "delete my account" });
    expect(res.status).toBe(403);
    expect(fake.rows("users")).toHaveLength(2);
    expect(fake.rows("entries")).toHaveLength(3);
  });

  it("accepts the phrase however it was capitalised or spaced", async () => {
    const res = await post({
      password: PASSWORD,
      confirm: "  Delete My Account  ",
    });
    expect(res.status).toBe(200);
  });

  it("refuses a caller with no session at all", async () => {
    session = null;
    const res = await post({ password: PASSWORD, confirm: "delete my account" });
    expect(res.status).toBe(401);
    expect(fake.rows("users")).toHaveLength(2);
  });

  it("clears the session cookie, so the browser isn't left half signed in", async () => {
    const res = await post({ password: PASSWORD, confirm: "delete my account" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pit_session=");
    expect(cookie.toLowerCase()).toMatch(/max-age=0/);
  });
});
