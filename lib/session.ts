import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, readSession } from "./auth";
import { db } from "./db";

/**
 * The signed-in user's id for the current request, or null.
 * Every data route scopes its queries by this so accounts never see
 * each other's entries.
 *
 * The token's password stamp is checked against the account here — in the
 * node runtime, where the database is reachable — rather than in the edge
 * proxy. A stolen or stale session outlives a password change only as far
 * as the page shell; every route that touches data lands here and refuses.
 */
export async function currentUserId(): Promise<ObjectId | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const session = await readSession(token);
  if (!session || !ObjectId.isValid(session.uid)) return null;

  const userId = new ObjectId(session.uid);
  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { passwordChangedAt: 1 } });
  if (!user) return null;

  const stamp =
    user.passwordChangedAt instanceof Date
      ? Math.floor(user.passwordChangedAt.getTime() / 1000)
      : 0;
  // A token minted before the password changed no longer speaks for the
  // account — that's the whole point of changing it.
  if (session.pwd !== stamp) return null;

  return userId;
}
