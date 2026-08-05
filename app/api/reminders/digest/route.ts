import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { pushConfigured, sendToUser } from "@/lib/push";
import { localDateStr } from "@/lib/reminders";
import { buildDigest } from "@/lib/digest";

/**
 * Send yourself the week in review right now, over your last seven days —
 * so what the Sunday push will look like isn't a surprise you wait a week
 * to see.
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
  const digest = await buildDigest(d, userId, today);
  if (!digest) {
    return NextResponse.json(
      { error: "Nothing logged in the last 7 days — log a few days first" },
      { status: 400 }
    );
  }

  const { sent } = await sendToUser(userId, {
    ...digest,
    url: "/status",
    tag: "pit-digest-test",
  });

  if (sent === 0) {
    return NextResponse.json(
      { error: "No device accepted the notification — try subscribing again" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sent });
}
