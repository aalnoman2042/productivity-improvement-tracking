import { type ObjectId } from "mongodb";
import { db } from "./db";
import { currentUserId } from "./session";

/**
 * Who gets the admin overview — the doorway on the Account page, the /admin
 * page and its API all read this one answer.
 *
 * **Prefer the environment variable.** This file is committed to a public
 * repository, so an address written here is a published address; one set as
 * `ADMIN_EMAILS` in Vercel is not. The variable takes a comma-separated
 * list and replaces this default entirely, which also means an admin can be
 * added or removed without a deploy.
 */
const FALLBACK_ADMIN_EMAILS = ["abdullahalnoman2042@gmail.com"];

export function adminEmails(): string[] {
  const configured = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : FALLBACK_ADMIN_EMAILS;
}

/** Kept for anything that imports the list; reads the same answer. */
export const ADMIN_EMAILS = FALLBACK_ADMIN_EMAILS;

export function isAdminEmail(email: unknown): boolean {
  return (
    typeof email === "string" && adminEmails().includes(email.toLowerCase())
  );
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
