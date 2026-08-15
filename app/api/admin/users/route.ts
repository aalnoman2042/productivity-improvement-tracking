import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentAdminId } from "@/lib/admin";

/**
 * The admin overview: every account's name with two counts beside it — how
 * many trackers it has and how many distinct days it has logged. Deliberately
 * nothing more: no emails, no tracker names, no entry values. Counts say that
 * tracking happened, never what was tracked.
 */
export async function GET() {
  const adminId = await currentAdminId();
  // Non-admins get the same 404 a wrong URL would — the page's existence
  // is part of what's admin-only.
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = await db();

  const [users, trackerCounts, dayCounts] = await Promise.all([
    d
      .collection("users")
      .find({}, { projection: { name: 1, createdAt: 1 } })
      .sort({ createdAt: 1 })
      .toArray(),
    d
      .collection("trackers")
      .aggregate([{ $group: { _id: "$userId", n: { $sum: 1 } } }])
      .toArray(),
    // Logged days = distinct dates with at least one entry, so ten entries
    // on one busy day still count as one day showing up.
    d
      .collection("entries")
      .aggregate([
        { $group: { _id: { u: "$userId", d: "$date" } } },
        { $group: { _id: "$_id.u", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const trackersBy = new Map(trackerCounts.map((r) => [String(r._id), r.n as number]));
  const daysBy = new Map(dayCounts.map((r) => [String(r._id), r.n as number]));

  return NextResponse.json({
    totalUsers: users.length,
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      joined: u.createdAt instanceof Date ? u.createdAt.toISOString().slice(0, 10) : null,
      trackers: trackersBy.get(String(u._id)) ?? 0,
      loggedDays: daysBy.get(String(u._id)) ?? 0,
    })),
  });
}
