import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { FakeDb } from "./helpers/fakeDb";

/**
 * Who may open the health page, and who may change that.
 *
 * Both are access control, which is the one kind of logic a unit test cannot
 * prove: the question is not "does the arithmetic work" but "does the route
 * refuse". The page is behind `invited` because it reads tracker names with
 * the shared AI allowance, and the admin toggle is the only write in the
 * admin surface — so between them they are worth a route test of their own.
 *
 * The gate answers **404 rather than 403** to somebody it is not for, exactly
 * as the admin routes do: the existence of the endpoint is part of what is
 * gated, and a 403 tells you there is something there.
 */

const INVITED = new ObjectId();
const OUTSIDER = new ObjectId();
const ADMIN = new ObjectId();

let fake: FakeDb;
let session: ObjectId | null = INVITED;

vi.mock("@/lib/session", () => ({ currentUserId: async () => session }));
vi.mock("@/lib/db", () => ({ db: async () => fake, dbReady: async () => fake }));

const roles = await import("@/app/api/health/roles/route");
const users = await import("@/app/api/admin/users/route");
const { AI_MAX_AGE_DAYS, isDue } = await import("@/lib/roleStore");

const patchUser = (body: unknown) =>
  users.PATCH(
    new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  session = INVITED;
  process.env.ADMIN_EMAILS = "admin@example.com";
  delete process.env.HEALTH_OPEN;
  delete process.env.CORTISOL_OPEN;

  fake = new FakeDb({
    users: [
      { _id: INVITED, email: "in@example.com", name: "Invited", invited: true },
      { _id: OUTSIDER, email: "out@example.com", name: "Outsider", invited: false },
      { _id: ADMIN, email: "admin@example.com", name: "Admin", invited: true },
    ],
    trackers: [
      {
        _id: new ObjectId(),
        userId: INVITED,
        name: "Sleep",
        type: "sleep",
        unit: "min",
        category: "sleep",
        order: 0,
      },
      {
        _id: new ObjectId(),
        userId: INVITED,
        name: "Water",
        type: "count",
        unit: "glasses",
        category: "food",
        order: 1,
      },
    ],
    entries: [],
  });
});

describe("the health gate", () => {
  it("lets an invited member in", async () => {
    const res = await roles.GET();
    expect(res.status).toBe(200);
  });

  it("gives somebody outside the invite a 404, not a 403", async () => {
    session = OUTSIDER;
    const res = await roles.GET();
    expect(res.status).toBe(404);
  });

  it("refuses a signed-out request", async () => {
    session = null;
    expect((await roles.GET()).status).toBe(404);
  });

  it("reads an absent invited flag as invited, so nobody loses access to it", async () => {
    // Every account created before the field existed was created with a code.
    const legacy = new ObjectId();
    fake.rows("users").push({ _id: legacy, email: "old@example.com", name: "Old" });
    session = legacy;
    expect((await roles.GET()).status).toBe(200);
  });

  it("opens to everyone the moment the switch is set, with no deploy", async () => {
    session = OUTSIDER;
    expect((await roles.GET()).status).toBe(404);
    process.env.HEALTH_OPEN = "1";
    expect((await roles.GET()).status).toBe(200);
  });

  it("still honours the older CORTISOL_OPEN switch, which is what is set today", async () => {
    session = OUTSIDER;
    process.env.CORTISOL_OPEN = "1";
    expect((await roles.GET()).status).toBe(200);
  });
});

describe("what the roles route reports", () => {
  it("matches the trackers by name with no AI having run", async () => {
    const body = await (await roles.GET()).json();
    expect(body.never).toBe(true);
    expect(body.stale).toBe(false);
    // The keyword rules alone find both of these, which is the point of
    // having them: the page works with no key and no network.
    const found = body.assignments.map((a: { role: string }) => a.role).sort();
    expect(found).toEqual(["sleep", "water"]);
    expect(body.coverage).toBeGreaterThan(0);
  });

  it("names what is missing so the page can ask for it", async () => {
    const body = await (await roles.GET()).json();
    const missing = body.missing.map((m: { role: string }) => m.role);
    expect(missing).toContain("exercise");
    expect(missing).not.toContain("sleep");
  });

  it("refuses an override that would put a rating where a volume belongs", async () => {
    const water = fake.rows("trackers").find((t) => t.name === "Water");
    const res = await roles.PATCH(
      new Request("http://localhost/api/health/roles", {
        method: "PATCH",
        body: JSON.stringify({ trackerId: String(water?._id), role: "mood" }),
      })
    );
    // "mood" reads 1-5 scales; a count of glasses is not one.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("can't fill");
  });

  it("refuses an override naming a role that does not exist", async () => {
    const water = fake.rows("trackers").find((t) => t.name === "Water");
    const res = await roles.PATCH(
      new Request("http://localhost/api/health/roles", {
        method: "PATCH",
        body: JSON.stringify({ trackerId: String(water?._id), role: "telepathy" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("refuses an override for a tracker that is not yours", async () => {
    const res = await roles.PATCH(
      new Request("http://localhost/api/health/roles", {
        method: "PATCH",
        body: JSON.stringify({ trackerId: String(new ObjectId()), role: "water" }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("the admin premium toggle", () => {
  beforeEach(() => {
    session = ADMIN;
  });

  it("switches an account off by writing false, never by clearing the field", async () => {
    // Absent reads as invited, so clearing it would switch them back on.
    const res = await patchUser({ id: String(INVITED), invited: false });
    expect(res.status).toBe(200);
    const row = fake.rows("users").find((u) => String(u._id) === String(INVITED));
    expect(row?.invited).toBe(false);
  });

  it("actually closes the health page for the account it switched off", async () => {
    await patchUser({ id: String(INVITED), invited: false });
    session = INVITED;
    expect((await roles.GET()).status).toBe(404);
  });

  it("switches one back on", async () => {
    await patchUser({ id: String(OUTSIDER), invited: true });
    session = OUTSIDER;
    expect((await roles.GET()).status).toBe(200);
  });

  it("will not let an admin switch their own access off", async () => {
    const res = await patchUser({ id: String(ADMIN), invited: false });
    expect(res.status).toBe(400);
    const row = fake.rows("users").find((u) => String(u._id) === String(ADMIN));
    expect(row?.invited).toBe(true);
  });

  it("is admin-only, and answers a non-admin with a 404", async () => {
    session = INVITED;
    expect((await patchUser({ id: String(OUTSIDER), invited: true })).status).toBe(404);
  });

  it("refuses anything that is not a boolean", async () => {
    expect((await patchUser({ id: String(INVITED), invited: "yes" })).status).toBe(400);
    expect((await patchUser({ id: "not-an-id", invited: true })).status).toBe(400);
  });

  it("says so when the account does not exist", async () => {
    expect((await patchUser({ id: String(new ObjectId()), invited: true })).status).toBe(
      404
    );
  });
});

describe("when the AI re-reads the tracker names by itself", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-09-02T12:00:00Z");
  const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();

  it("is due when it has never run", () => {
    expect(isDue(null, false, now).due).toBe(true);
    expect(isDue(null, false, now).ageDays).toBeNull();
  });

  it("is not due again the same day", () => {
    const { due, ageDays } = isDue(daysAgo(1), false, now);
    expect(due).toBe(false);
    expect(ageDays).toBeCloseTo(1, 5);
  });

  it("falls due once the answer ages out", () => {
    expect(isDue(daysAgo(AI_MAX_AGE_DAYS - 0.1), false, now).due).toBe(false);
    expect(isDue(daysAgo(AI_MAX_AGE_DAYS), false, now).due).toBe(true);
    expect(isDue(daysAgo(30), false, now).due).toBe(true);
  });

  it("falls due immediately when the tracker list changed, however fresh it is", () => {
    // A rename is exactly the case worth re-reading for, and waiting a week
    // to notice it would mean a week of the wrong tracker feeding a number.
    expect(isDue(daysAgo(0), true, now).due).toBe(true);
  });

  it("treats an unreadable timestamp as never having run", () => {
    // Rather than as NaN days old, which compares false against everything
    // and would wedge the refresh off permanently.
    expect(isDue("not a date", false, now).due).toBe(true);
    expect(isDue("not a date", false, now).ageDays).toBeNull();
  });
});

describe("the automatic read never takes the panel down", () => {
  it("serves the rule-matched map with no AI key configured", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await roles.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // It was due — nothing has ever run for this account — and it could not
    // run. The map still arrives, matched by name.
    expect(body.refreshed).toBe(false);
    expect(body.assignments.map((a: { role: string }) => a.role).sort()).toEqual([
      "sleep",
      "water",
    ]);
    expect(body.aiConfigured).toBe(false);
  });

  it("reports how old the answer is so the panel can say so", async () => {
    const body = await (await roles.GET()).json();
    // Never run, so there is no age to report — and null is not zero.
    expect(body.ageDays).toBeNull();
    expect(body.never).toBe(true);
  });

  it("still refuses somebody outside the invite, before spending anything", async () => {
    session = OUTSIDER;
    expect((await roles.GET()).status).toBe(404);
  });
});
