import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker } from "@/lib/trackerDoc";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One tracker's whole story: every entry ever logged against it, oldest
 * first, with notes and meta intact. The detail page computes everything
 * else — totals, streaks, monthly shape — client-side, because all of it
 * is derivable from this one list and none of it is needed anywhere else.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const trackerId = new ObjectId(id);
  const d = await db();
  const [trackerDoc, rows] = await Promise.all([
    d.collection("trackers").findOne({ _id: trackerId, userId }),
    d
      .collection("entries")
      .find({ userId, trackerId })
      .sort({ date: 1 })
      .toArray(),
  ]);
  if (!trackerDoc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    tracker: toTracker(trackerDoc),
    entries: rows.map((r) => ({
      date: String(r.date),
      value: Number(r.value),
      note: (r.note as string | null | undefined) ?? null,
      meta: r.meta ?? null,
    })),
  });
}
