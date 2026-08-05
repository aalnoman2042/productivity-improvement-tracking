import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { pushConfigured } from "@/lib/push";
import { REMINDER_JOB, cronHealth } from "@/lib/cronLog";

/**
 * Whether reminders are on, how many browsers would receive one — and whether
 * the schedule behind them is actually running. That last part matters
 * because a stopped cron announces itself by staying quiet.
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const [user, devices, schedule] = await Promise.all([
    d.collection("users").findOne({ _id: userId }, { projection: { reminder: 1 } }),
    d.collection("pushSubs").countDocuments({ userId }),
    cronHealth(REMINDER_JOB),
  ]);

  return NextResponse.json({
    available: pushConfigured(),
    enabled: Boolean(user?.reminder?.enabled),
    tzOffset: Number(user?.reminder?.tzOffset ?? 0),
    devices,
    schedule,
  });
}

/**
 * Turn the nightly reminder on or off.
 * Body: { enabled, tzOffset } — tzOffset is minutes east of UTC (+360 for
 * UTC+6). It doesn't set the delivery time; it decides which day the
 * reminder is about, so the 11 PM ask names the day that's wrapping up.
 */
export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const tzOffset = Number(body?.tzOffset);
  if (!Number.isFinite(tzOffset) || tzOffset < -840 || tzOffset > 840) {
    return NextResponse.json({ error: "Bad timezone offset" }, { status: 400 });
  }

  const d = await db();
  await d.collection("users").updateOne(
    { _id: userId },
    {
      $set: {
        "reminder.enabled": body.enabled,
        "reminder.tzOffset": Math.round(tzOffset),
      },
    }
  );

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
