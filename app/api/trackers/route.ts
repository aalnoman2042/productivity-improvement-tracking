import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { toTracker, parseGoal, parseHabit, parseTarget } from "@/lib/trackerDoc";
import { parseReminderMode, parseReminderTimes } from "@/lib/trackerReminders";
import { parsePlace } from "@/lib/prayerTimes";
import { TEMPLATE_PACKS, TRACKER_TYPES, normalizeCategory } from "@/lib/trackers";

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
  // Creating a tracker is the one write that can hit a validator older than
  // the code — a `prayer` or `streak` type is rejected until the collection's
  // rules have caught up — so this one waits for the sync.
  const d = await dbReady();

  // { pack: "essentials" | "deen" } adds a ready-made set. Trackers whose
  // name you already have are skipped, so adding a pack twice is harmless.
  // ({ template: true } is the original spelling of the essentials pack.)
  const packId = body?.template === true ? "essentials" : body?.pack;
  if (typeof packId === "string") {
    const pack = TEMPLATE_PACKS.find((p) => p.id === packId);
    if (!pack) return NextResponse.json({ error: "Unknown pack" }, { status: 400 });

    const mine = await d
      .collection("trackers")
      .find({ userId }, { projection: { name: 1 } })
      .toArray();
    const taken = new Set(mine.map((t) => String(t.name).toLowerCase()));

    const docs = pack.items
      .filter((t) => !taken.has(t.name.toLowerCase()))
      .map((t, i) => ({
        userId,
        name: t.name,
        type: t.type,
        unit: t.unit,
        color: t.color,
        category: t.category,
        goal: t.goal,
        habit: t.habit ?? "good",
        archived: false,
        order: mine.length + i,
        createdAt: new Date(),
      }));

    if (docs.length > 0) await d.collection("trackers").insertMany(docs);
    return NextResponse.json(
      { ok: true, added: docs.length, skipped: pack.items.length - docs.length },
      { status: 201 }
    );
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
    target: parseTarget(body?.target),
    habit: parseHabit(body?.habit),
    reminder: (() => {
      const times = parseReminderTimes(body?.reminder);
      if (!times) return null;
      return { times, mode: parseReminderMode(body?.reminderMode), lastSentFor: null };
    })(),
    archived: false,
    order,
    createdAt: new Date(),
  });

  // A reminder time means nothing without knowing where the user's clock is
  // — and a *prayer* time means nothing without knowing where they are. Both
  // live on the user, because both schedules read the same fields.
  const tzOffset = Number(body?.tzOffset);
  const userSet: Record<string, unknown> = {};
  if (body?.reminder && Number.isFinite(tzOffset) && Math.abs(tzOffset) <= 840) {
    userSet["reminder.tzOffset"] = tzOffset;
  }
  const place = parsePlace(body?.place);
  if (place) userSet["reminder.place"] = place;
  if (Object.keys(userSet).length > 0) {
    await d.collection("users").updateOne({ _id: userId }, { $set: userSet });
  }

  const doc = await d.collection("trackers").findOne({ _id: res.insertedId });
  return NextResponse.json(doc ? toTracker(doc) : { ok: true }, { status: 201 });
}
