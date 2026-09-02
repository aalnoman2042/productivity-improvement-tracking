import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentAdminId } from "@/lib/admin";
import { hasAI } from "@/lib/access";

/**
 * The admin overview: every account's name with the counts beside it — how
 * many trackers it has, how many distinct days it has logged, and how many
 * browsers it could receive a notification on. Deliberately nothing more: no
 * emails, no tracker names, no entry values. Counts say that tracking
 * happened, never what was tracked.
 *
 * The device count is what makes the nudge button honest. Whether the nightly
 * ask is switched on is a separate answer and is sent too, because those two
 * come apart constantly — a phone that granted permission months ago still
 * takes a message from someone whose reminders are off.
 *
 * **A page at a time, on purpose.** This route used to group *every* entry in
 * the database to count logged days: fine for five accounts, and a full scan
 * of millions of rows for two thousand. The counts are now scoped to the
 * accounts actually on screen (`$match` first, so each aggregation rides the
 * userId indexes), which keeps the page the same cost whether the app has ten
 * users or ten thousand.
 */

/** Accounts per request. Enough to read; small enough to stay index-bound. */
const PAGE = 50;
const MAX_PAGE = 200;

export async function GET(req: Request) {
  const adminId = await currentAdminId();
  // Non-admins get the same 404 a wrong URL would — the page's existence
  // is part of what's admin-only.
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = new URL(req.url).searchParams;
  const limit = Math.min(
    MAX_PAGE,
    Math.max(1, Math.round(Number(params.get("limit")) || PAGE))
  );
  const skip = Math.max(0, Math.round(Number(params.get("skip")) || 0));

  const d = await db();

  const [totalUsers, users] = await Promise.all([
    d.collection("users").countDocuments({}),
    d
      .collection("users")
      .find({}, { projection: { name: 1, createdAt: 1, reminder: 1, invited: 1 } })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
  ]);

  const ids = users.map((u) => u._id);

  const [trackerCounts, dayCounts, deviceCounts] = await Promise.all([
    d
      .collection("trackers")
      .aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: "$userId", n: { $sum: 1 } } },
      ])
      .toArray(),
    // Logged days = distinct dates with at least one entry, so ten entries
    // on one busy day still count as one day showing up.
    d
      .collection("entries")
      .aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: { u: "$userId", d: "$date" } } },
        { $group: { _id: "$_id.u", n: { $sum: 1 } } },
      ])
      .toArray(),
    d
      .collection("pushSubs")
      .aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: "$userId", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const trackersBy = new Map(trackerCounts.map((r) => [String(r._id), r.n as number]));
  const daysBy = new Map(dayCounts.map((r) => [String(r._id), r.n as number]));
  const devicesBy = new Map(deviceCounts.map((r) => [String(r._id), r.n as number]));

  return NextResponse.json({
    totalUsers,
    skip,
    limit,
    hasMore: skip + users.length < totalUsers,
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      joined: u.createdAt instanceof Date ? u.createdAt.toISOString().slice(0, 10) : null,
      trackers: trackersBy.get(String(u._id)) ?? 0,
      loggedDays: daysBy.get(String(u._id)) ?? 0,
      devices: devicesBy.get(String(u._id)) ?? 0,
      remindersOn: Boolean(u.reminder?.enabled),
      // Whether the paid-for parts — the AI coach, and the health page that
      // reads trackers with the same shared allowance — are switched on for
      // this account. Absent reads as invited (`lib/access.ts`), so the
      // toggle below shows what `hasAI` actually decides rather than what
      // the field literally holds.
      invited: hasAI(u),
    })),
  });
}

/**
 * Turn the invited flag on or off for one account.
 *
 * This is the only write in the admin surface, and it is deliberately the
 * narrowest one that could do the job: an id and a boolean, nothing else
 * readable or writable. The rest of `/admin` reports counts and sizes and
 * cannot reach a single day of anybody's log — that line does not move
 * because a toggle was added beside it.
 *
 * `invited` gates the features with a bill attached: the AI coach, and the
 * health page's tracker detection. Absent means invited, so switching
 * somebody off writes `false` explicitly rather than clearing the field —
 * clearing it would silently switch them back on.
 *
 * PATCH `{id, invited}`.
 */
export async function PATCH(req: Request) {
  const adminId = await currentAdminId();
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    invited?: unknown;
  } | null;

  const id = typeof body?.id === "string" ? body.id : "";
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "A user id is required" }, { status: 400 });
  }
  if (typeof body?.invited !== "boolean") {
    return NextResponse.json({ error: "invited must be true or false" }, { status: 400 });
  }

  const userId = new ObjectId(id);
  // An admin who switched themselves off would lose the coach and the health
  // page and keep the button that did it, which is a confusing place to be.
  if (userId.equals(adminId) && body.invited === false) {
    return NextResponse.json(
      { error: "You cannot switch your own premium access off from here" },
      { status: 400 }
    );
  }

  const d = await dbReady();
  const result = await d
    .collection("users")
    .updateOne({ _id: userId }, { $set: { invited: body.invited } });

  if (result.matchedCount === 0) {
    return NextResponse.json({ error: "No such account" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id, invited: body.invited });
}
