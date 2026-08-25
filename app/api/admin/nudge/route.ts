import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentAdminId } from "@/lib/admin";
import { pushConfigured, sendToUser } from "@/lib/push";
import { DEFAULT_NUDGE, cleanNudge, nudgePayload } from "@/lib/nudge";
import { localDateStr } from "@/lib/reminders";
import { ADMIN_NUDGE_JOB, recordRun } from "@/lib/cronLog";
import { hit, tooMany } from "@/lib/rateLimit";

/**
 * Put one message on one person's phone, now.
 *
 * Everything else this app pushes is a schedule: an hour someone chose, a
 * waqt the sun decides, a check-in after three quiet days. This is the one
 * that is sent by a hand, and it exists because the schedule has a switch —
 * somebody who turned the nightly ask off, or never had a reason to turn it
 * on, is unreachable by every other route in here.
 *
 * So the gate is **the permission their browser already granted**, not
 * `reminder.enabled`: `sendToUser` writes to whatever subscriptions exist,
 * and no subscription is the one refusal this route reports as such. What it
 * will not do is touch `reminder.lastSentFor` — a nudge at noon must not
 * mark tonight's ask as already sent (rule 10: the daily ask is owed).
 *
 * Names and counts only, like the rest of /admin. Nothing anybody logged is
 * read here, and the message travels in one direction.
 */
export async function POST(req: Request) {
  const adminId = await currentAdminId();
  // Same 404 a wrong URL gets — being an admin route is admin-only knowledge.
  if (!adminId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The ceiling is for a stuck loop, not for the sender: nobody types thirty
  // messages an hour, and a page that retries in one would be a phone buzzing
  // all afternoon in somebody else's pocket.
  const verdict = await hit("nudge", String(adminId));
  if (!verdict.ok) return tooMany(verdict, "nudges");

  if (!pushConfigured()) {
    return NextResponse.json(
      { error: "Push isn't set up on this server" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const id = String(body?.userId ?? "");
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Pick an account" }, { status: 400 });
  }
  const message = cleanNudge(body?.message) ?? DEFAULT_NUDGE;

  const d = await db();
  const target = new ObjectId(id);
  const [user, devices] = await Promise.all([
    d
      .collection("users")
      .findOne({ _id: target }, { projection: { name: 1, reminder: 1 } }),
    d.collection("pushSubs").countDocuments({ userId: target }),
  ]);
  if (!user) return NextResponse.json({ error: "No such account" }, { status: 404 });

  if (devices === 0) {
    return NextResponse.json(
      {
        error:
          "No device of theirs is subscribed — they have to allow notifications in the app first.",
      },
      { status: 400 }
    );
  }

  // Their clock, not the server's: the tap has to open the day they are
  // living, which past 6pm in Dhaka is already tomorrow in UTC terms.
  const today = localDateStr(new Date(), Number(user.reminder?.tzOffset ?? 0));
  const startedAt = new Date();
  const { sent } = await sendToUser(target, nudgePayload(message, today));

  // Filed beside the scheduled runs, so the health card shows a message sent
  // by hand the same way it shows one sent by a cron. A push nobody can
  // account for later is how "did they get it?" becomes unanswerable.
  await recordRun(ADMIN_NUDGE_JOB, startedAt, {
    ok: sent > 0,
    checked: 1,
    notified: sent,
    error: sent > 0 ? undefined : "no device accepted it",
  });

  if (sent === 0) {
    return NextResponse.json(
      { error: "No device accepted it — their subscription may have expired" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sent, name: user.name ?? null });
}
