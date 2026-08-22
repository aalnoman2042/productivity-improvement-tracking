import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { pushConfigured } from "@/lib/push";
import { parseTimeOfDay, reminderTime } from "@/lib/reminders";
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
    // Old accounts have no time on record; they get the hour the reminder
    // always had, so nothing moves under anyone who never asked it to.
    time: reminderTime(user?.reminder?.time),
    devices,
    schedule,
  });
}

/**
 * Turn the reminder on or off, and say when it should arrive.
 * Body: { enabled?, time?, tzOffset } — `time` is a local "HH:MM", `tzOffset`
 * is minutes east of UTC (+360 for UTC+6). Together they are the whole
 * schedule: the clock the app watches, and where that clock is.
 *
 * Either field may come on its own — changing the hour must not require
 * re-stating that reminders are on.
 */
export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const enabled = body?.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const time = body?.time === undefined ? null : parseTimeOfDay(body.time);
  if (body?.time !== undefined && time === null) {
    return NextResponse.json(
      { error: "Pick a time of day, like 23:00" },
      { status: 400 }
    );
  }
  if (enabled === undefined && time === null) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  const tzOffset = Number(body?.tzOffset);
  if (!Number.isFinite(tzOffset) || tzOffset < -840 || tzOffset > 840) {
    return NextResponse.json({ error: "Bad timezone offset" }, { status: 400 });
  }

  const set: Record<string, unknown> = {
    "reminder.tzOffset": Math.round(tzOffset),
  };
  if (typeof enabled === "boolean") set["reminder.enabled"] = enabled;
  if (time) set["reminder.time"] = time;

  const d = await db();
  await d.collection("users").updateOne({ _id: userId }, { $set: set });

  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { reminder: 1 } });

  return NextResponse.json({
    ok: true,
    enabled: Boolean(user?.reminder?.enabled),
    time: reminderTime(user?.reminder?.time),
  });
}
