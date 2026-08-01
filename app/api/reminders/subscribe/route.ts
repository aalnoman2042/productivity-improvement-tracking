import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";

/**
 * Register this browser to receive reminders.
 * Body: the serialized PushSubscription — { endpoint, keys: { p256dh, auth } }.
 *
 * Keyed on the endpoint, so re-subscribing on the same browser refreshes the
 * row instead of piling up duplicates, and a shared device moves to whoever
 * is signed in now.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;

  if (
    typeof endpoint !== "string" ||
    !endpoint.startsWith("https://") ||
    endpoint.length > 1000 ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return NextResponse.json({ error: "Bad subscription" }, { status: 400 });
  }

  const label =
    typeof body?.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : null;

  const d = await db();
  await d.collection("pushSubs").updateOne(
    { endpoint },
    {
      $set: { userId, keys: { p256dh, auth }, label },
      $setOnInsert: { createdAt: new Date(), lastUsedAt: null },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true });
}

/** Stop sending to this browser. `?endpoint=…`, or all of them with `?all=1`. */
export async function DELETE(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const endpoint = params.get("endpoint");
  const all = params.get("all") === "1";

  if (!endpoint && !all) {
    return NextResponse.json({ error: "endpoint or all=1 required" }, { status: 400 });
  }

  const d = await db();
  const res = await d
    .collection("pushSubs")
    .deleteMany(all ? { userId } : { userId, endpoint: endpoint! });

  return NextResponse.json({ ok: true, removed: res.deletedCount });
}
