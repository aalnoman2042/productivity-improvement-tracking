import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { cleanTask } from "@/lib/tasks";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Tick one, rename one, or throw one away.
 *
 * All three are POST — see the note in the parent route. A checkbox has to
 * work with no signal, and the offline queue only speaks POST, so REST
 * niceness loses to a tick that survives the tunnel on the way home.
 *
 * Body: `{ done: true|false }`, `{ text: "..." }`, or `{ remove: true }`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Bad body" }, { status: 400 });

  const d = await db();
  const _id = new ObjectId(id);

  if (body.remove === true) {
    const res = await d.collection("tasks").deleteOne({ _id, userId });
    // A queued delete that arrives twice, or after the row is already gone,
    // is a success: the task is not there, which is what was asked for.
    return NextResponse.json({ ok: true, removed: res.deletedCount });
  }

  const set: Record<string, unknown> = {};
  if (typeof body.done === "boolean") {
    set.done = body.done;
    // The one fact a checkbox destroys, kept in case it is ever worth
    // something — nothing reads it today.
    set.doneAt = body.done ? new Date() : null;
  }
  if ("text" in body) {
    const text = cleanTask(body.text);
    if (!text) {
      return NextResponse.json({ error: "Write the task first" }, { status: 400 });
    }
    set.text = text;
  }

  if (Object.keys(set).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const res = await d.collection("tasks").updateOne({ _id, userId }, { $set: set });
  if (res.matchedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
