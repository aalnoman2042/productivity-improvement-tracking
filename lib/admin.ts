import { type ObjectId } from "mongodb";
import { db } from "./db";
import { currentUserId } from "./session";

/**
 * Who gets the admin overview. Add an email here and that account is an
 * admin everywhere at once — the doorway on the Account page, the /admin
 * page, and its API all read this one list.
 */
export const ADMIN_EMAILS = ["abdullahalnoman2042@gmail.com"];

export function isAdminEmail(email: unknown): boolean {
  return typeof email === "string" && ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * The signed-in user's id, but only when the account's email is in
 * ADMIN_EMAILS — null for everyone else. Admin routes gate on this the
 * same way data routes gate on `currentUserId`, so being an admin is
 * checked against the database on every request, never trusted from
 * the client.
 */
export async function currentAdminId(): Promise<ObjectId | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { email: 1 } });
  return user && isAdminEmail(user.email) ? userId : null;
}
