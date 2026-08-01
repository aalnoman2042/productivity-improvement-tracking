/**
 * Web push — the nightly reminder's delivery route.
 *
 * Needs a VAPID key pair (`npm run vapid-keys`) in the environment. Without
 * one the app still runs; the reminder settings just say push isn't set up
 * rather than silently failing every night.
 *
 * A subscription belongs to a *browser*, not an account, and browsers throw
 * them away routinely — cleared site data, a reinstall, months of inactivity.
 * When a push service tells us an endpoint is gone we delete the row, which
 * is why sending goes through `sendToUser` rather than raw web-push.
 */
import { ObjectId } from "mongodb";
import webpush from "web-push";
import { db } from "./db";

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping the notification should land. */
  url: string;
  tag?: string;
};

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

let configured = false;

function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:pit@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

/** A push service saying "this endpoint is dead, stop sending to it". */
function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 404 || code === 410;
}

/**
 * Push to every device the user has subscribed. Returns how many actually
 * took it — 0 means they have no live subscriptions left, which the caller
 * can treat as "reminders aren't reaching this person".
 */
export async function sendToUser(
  userId: ObjectId,
  payload: PushPayload
): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  configure();

  const d = await db();
  const subs = await d.collection("pushSubs").find({ userId }).toArray();
  const body = JSON.stringify(payload);

  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(s.endpoint),
            keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) },
          },
          body
        );
        sent++;
      } catch (err) {
        if (isGone(err)) dead.push(String(s.endpoint));
        // Anything else (a 5xx from the push service, a timeout) is worth
        // keeping the subscription for — tomorrow's attempt may well work.
      }
    })
  );

  if (dead.length > 0) {
    await d.collection("pushSubs").deleteMany({ endpoint: { $in: dead } });
  }
  if (sent > 0) {
    await d
      .collection("pushSubs")
      .updateMany(
        { userId, endpoint: { $nin: dead } },
        { $set: { lastUsedAt: new Date() } }
      );
  }

  return { sent, removed: dead.length };
}
