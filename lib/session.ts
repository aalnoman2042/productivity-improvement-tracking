import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, readSession } from "./auth";

/**
 * The signed-in user's id for the current request, or null.
 * Every data route scopes its queries by this so accounts never see
 * each other's entries.
 */
export async function currentUserId(): Promise<ObjectId | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const uid = await readSession(token);
  if (!uid || !ObjectId.isValid(uid)) return null;
  return new ObjectId(uid);
}
