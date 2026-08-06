import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Giving up (or finishing and clearing away) a challenge deletes only the
 * challenge itself. The tracker it watched and every day logged against it
 * stay exactly where they were — which is why this needs no typed-back
 * confirmation the way deleting a tracker does.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const d = await db();
  const res = await d
    .collection("challenges")
    .deleteOne({ _id: new ObjectId(id), userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
