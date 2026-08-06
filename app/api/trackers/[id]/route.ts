import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { deletePhrase, normalizeCategory } from "@/lib/trackers";
import { parseGoal, parseHabit } from "@/lib/trackerDoc";

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
  if ("category" in body) {
    const category = normalizeCategory(body.category);
    if (category) set.category = category;
  }
  if (typeof body.archived === "boolean") set.archived = body.archived;
  if ("goal" in body) set.goal = parseGoal(body.goal);
  if ("habit" in body) set.habit = parseHabit(body.habit);

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

/** What deleting this tracker would actually cost — the numbers the confirmation is built from. */
export async function GET(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const d = await db();
  const trackerId = new ObjectId(id);
  const tracker = await d
    .collection("trackers")
    .findOne({ _id: trackerId, userId });
  if (!tracker) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await d
    .collection("entries")
    .find({ userId, trackerId }, { projection: { date: 1 } })
    .toArray();
  const dates = [...new Set(rows.map((r) => String(r.date)))].sort();

  return NextResponse.json({
    id,
    name: String(tracker.name),
    entries: rows.length,
    days: dates.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    phrase: dates.length > 0 ? deletePhrase(String(tracker.name)) : null,
  });
}

/**
 * Delete a tracker, and every day ever logged against it.
 *
 * This used to refuse outright as soon as there was any history, which left no
 * way at all to get rid of a tracker you'd actually used — so it now goes
 * through, but only on the same terms as deleting a date range: the caller has
 * to send back the entry count they were shown, and type the phrase. A count
 * that no longer matches means the data moved since they looked, and the
 * answer is to look again rather than to delete blind.
 *
 * `DELETE /api/trackers/:id?entries=N&confirm=delete+<name>`
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const params = new URL(req.url).searchParams;
  const d = await db();
  const trackerId = new ObjectId(id);

  const tracker = await d
    .collection("trackers")
    .findOne({ _id: trackerId, userId });
  if (!tracker) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await d
    .collection("entries")
    .countDocuments({ userId, trackerId });

  const claimed = Number(params.get("entries"));
  if (!Number.isInteger(claimed) || claimed !== entries) {
    return NextResponse.json(
      {
        error:
          "This tracker's history has changed since you checked it — take another look",
        entries,
      },
      { status: 409 }
    );
  }

  if (entries > 0) {
    const phrase = deletePhrase(String(tracker.name));
    const confirm = String(params.get("confirm") ?? "").trim().toLowerCase();
    if (confirm !== phrase) {
      return NextResponse.json(
        { error: `Type "${phrase}" to confirm`, phrase },
        { status: 400 }
      );
    }
  }

  // History first: a tracker left standing with no entries is a harmless
  // state, one whose entries outlive it is not.
  const wiped = await d
    .collection("entries")
    .deleteMany({ userId, trackerId });
  const res = await d.collection("trackers").deleteOne({ _id: trackerId, userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entries: wiped.deletedCount });
}
