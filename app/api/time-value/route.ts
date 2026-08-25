import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { parseTimeValue } from "@/lib/timeValue";

/**
 * The price of an hour of your life.
 *
 * One number and a currency, kept on the user because it is a fact about the
 * person rather than about any tracker — the same reasoning that puts the
 * prayer-times location there. Nothing else in the app reads it, and while it
 * is unset the whole feature renders nothing at all.
 *
 * GET returns it. PATCH sets it, or clears it with `{ perMinute: null }` —
 * a price you can't take back off would be a decision, not a setting.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { timeValue: 1 } });

  return NextResponse.json({ value: parseTimeValue(user?.timeValue) });
}

export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const d = await dbReady();

  if (body?.perMinute === null) {
    await d
      .collection("users")
      .updateOne({ _id: userId }, { $set: { timeValue: null } });
    return NextResponse.json({ ok: true, value: null });
  }

  const value = parseTimeValue(body);
  if (!value) {
    return NextResponse.json(
      { error: "Give an hour a price — a number above zero" },
      { status: 400 }
    );
  }

  await d.collection("users").updateOne({ _id: userId }, { $set: { timeValue: value } });
  return NextResponse.json({ ok: true, value });
}
