import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { CATEGORIES } from "@/lib/trackers";
import { parseGoal } from "../route";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad body" }, { status: 400 });

  const set: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    set.name = body.name.trim().slice(0, 60);
  }
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    set.color = body.color;
  }
  if (typeof body.unit === "string") set.unit = body.unit.trim().slice(0, 12);
  if (CATEGORIES.some((c) => c.value === body.category)) {
    set.category = body.category;
  }
  if (typeof body.archived === "boolean") set.archived = body.archived;
  if ("goal" in body) set.goal = parseGoal(body.goal);

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const d = await db();
  const res = await d
    .collection("trackers")
    .updateOne({ _id: new ObjectId(id), userId }, { $set: set });
  if (res.matchedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const d = await db();
  const trackerId = new ObjectId(id);

  const logged = await d
    .collection("entries")
    .countDocuments({ userId, trackerId });
  if (logged > 0) {
    return NextResponse.json(
      { error: "This tracker has history. Archive it instead." },
      { status: 409 }
    );
  }
  const res = await d.collection("trackers").deleteOne({ _id: trackerId, userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
