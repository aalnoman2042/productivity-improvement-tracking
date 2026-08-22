import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { pushConfigured, sendToUser } from "@/lib/push";
import { prettyDate, prettyTime } from "@/lib/dates";
import { localDateStr, reminderTime } from "@/lib/reminders";

/**
 * Send yourself the reminder right now. Worth having: push either arrives on
 * a device or it doesn't, and finding that out at midnight is too late.
 */
export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Push isn't set up on this server" },
      { status: 503 }
    );
  }

  const d = await db();
  const [devices, user] = await Promise.all([
    d.collection("pushSubs").countDocuments({ userId }),
    d.collection("users").findOne({ _id: userId }, { projection: { reminder: 1 } }),
  ]);
  if (devices === 0) {
    return NextResponse.json(
      { error: "This browser isn't subscribed yet" },
      { status: 400 }
    );
  }

  const today = localDateStr(new Date(), Number(user?.reminder?.tzOffset ?? 0));
  const at = prettyTime(reminderTime(user?.reminder?.time));
  const { sent } = await sendToUser(userId, {
    title: "PIT reminder — this is a test",
    body: `The real one arrives at ${at}. Tap to log ${prettyDate(today)}.`,
    url: `/?date=${today}`,
    tag: "pit-test",
  });

  if (sent === 0) {
    return NextResponse.json(
      { error: "No device accepted the notification — try subscribing again" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sent });
}
