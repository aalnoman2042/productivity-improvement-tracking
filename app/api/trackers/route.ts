import { NextResponse } from "next/server";
import { type WithId, type Document } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import {
  TEMPLATES,
  TRACKER_TYPES,
  normalizeCategory,
  type Goal,
} from "@/lib/trackers";

export function toTracker(doc: WithId<Document>) {
  return {
    id: String(doc._id),
    name: doc.name as string,
    type: doc.type as string,
    unit: doc.unit as string,
    color: doc.color as string,
    category: doc.category as string,
    goal: (doc.goal ?? null) as Goal,
    archived: Boolean(doc.archived),
    order: Number(doc.order ?? 0),
  };
}

/** Validate an incoming goal object; returns null for "no goal". */
export function parseGoal(raw: unknown): Goal {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const target = Number(g.target);
  if (!Number.isFinite(target) || target <= 0) return null;
  const period = g.period === "week" ? "week" : "day";
  const direction = g.direction === "max" ? "max" : "min";
  return { target, period, direction };
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const docs = await d
    .collection("trackers")
    .find({ userId })
    .sort({ order: 1, createdAt: 1 })
    .toArray();
  return NextResponse.json(docs.map(toTracker));
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const d = await db();

  // { template: true } seeds the starter set on a fresh account.
  if (body?.template === true) {
    const count = await d.collection("trackers").countDocuments({ userId });
    const docs = TEMPLATES.map((t, i) => ({
      userId,
      name: t.name,
      type: t.type,
      unit: t.unit,
      color: t.color,
      category: t.category,
      goal: t.goal,
      archived: false,
      order: count + i,
      createdAt: new Date(),
    }));
    await d.collection("trackers").insertMany(docs);
    return NextResponse.json({ ok: true, added: docs.length }, { status: 201 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = TRACKER_TYPES.find((t) => t.value === body?.type)?.value;
  const category = normalizeCategory(body?.category);
  const color = typeof body?.color === "string" ? body.color : "";
  const unit = typeof body?.unit === "string" ? body.unit.trim().slice(0, 12) : "";

  if (!name || name.length > 60) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!type) return NextResponse.json({ error: "Pick a type" }, { status: 400 });
  if (!category) {
    return NextResponse.json(
      { error: "Pick or type a category" },
      { status: 400 }
    );
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return NextResponse.json({ error: "Invalid color" }, { status: 400 });
  }

  const order = await d.collection("trackers").countDocuments({ userId });
  const res = await d.collection("trackers").insertOne({
    userId,
    name,
    type,
    unit,
    color,
    category,
    goal: parseGoal(body?.goal),
    archived: false,
    order,
    createdAt: new Date(),
  });

  const doc = await d.collection("trackers").findOne({ _id: res.insertedId });
  return NextResponse.json(doc ? toTracker(doc) : { ok: true }, { status: 201 });
}
