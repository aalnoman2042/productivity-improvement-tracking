import type { Document, ObjectId, WithId } from "mongodb";
import { db } from "./db";
import { currentUserId } from "./session";

/**
 * Who the AI is switched on for.
 *
 * The app itself is open: anyone can sign up, log their days, read their
 * charts, their score, their grades and their report card, and export the
 * lot. **None of that is gated**, because none of it costs anything to run —
 * it is arithmetic on your own numbers, and an app that withholds your own
 * numbers from you is not worth installing.
 *
 * The coach is different. It is the one feature with a bill attached: a
 * finite free-tier quota belonging to one key, shared by everybody at once
 * (see `lib/ai.ts` and the whole-app daily budget in `lib/rateLimit`). Two
 * thousand strangers cannot each have a daily read of a thousand-request
 * allowance, so it goes to people the owner invited — the invite code that
 * used to gate the whole app now gates only the expensive part of it.
 *
 * `invited` is stamped at signup and never changes here. Accounts that
 * predate the field were all created *with* a code, so an absent field reads
 * as invited — anything else would take the coach away from the people who
 * already had it.
 */
export function hasAI(user: WithId<Document> | null | undefined): boolean {
  if (!user) return false;
  return user.invited !== false;
}

/** What the app says instead, in one place so every screen says the same. */
export const AI_LOCKED =
  "AI analysis is for invited members. The free tier it runs on is one shared daily allowance, so it can't be open to everyone yet — everything else in PIT is yours, and none of it is behind this.";

/** The shape the coach routes return when it's off, so the UI can render it. */
export const aiLockedBody = { locked: true as const, error: AI_LOCKED };

/* -------------------------------- health --------------------------------- */

/**
 * Who the health page is switched on for.
 *
 * **Invited members, for the same reason the coach is.** The page detects
 * what your trackers mean by asking a model (`lib/roleAI.ts`), and that model
 * runs on the same shared free-tier allowance everything else here does. It
 * is asked once per change to your tracker list rather than once per visit,
 * which is cheap — but "cheap per person" and "open to everybody who can
 * reach a URL" are different claims, and only the first one is true.
 *
 * It is a **stage, not a policy.** When the page has been used enough to
 * trust, `HEALTH_OPEN=1` in the environment opens it to every account with no
 * deploy — the same switch `ADMIN_EMAILS` is, and for the same reason: the
 * day a test ends should not have to wait on a build. `CORTISOL_OPEN` is
 * still honoured because it is what is set in the environment today, and a
 * rename that silently closed the page would be a rename that broke it.
 *
 * The gate decides who may **see** the page. It has never decided whose data
 * is read: every route behind it reads the signed-in account's own days and
 * has no version that can be pointed anywhere else.
 */
export function healthOpenToAll(): boolean {
  return process.env.HEALTH_OPEN === "1" || process.env.CORTISOL_OPEN === "1";
}

/** Cosmetic use only — for the doorway on Account. The routes re-check. */
export function canSeeHealth(user: WithId<Document> | null | undefined): boolean {
  return healthOpenToAll() || hasAI(user);
}

export const HEALTH_LOCKED =
  "The health page is with invited members while it is being tested. It reads your trackers with the same shared AI allowance the coach runs on, so it cannot be open to everyone yet — everything else in PIT is yours, and none of it is behind this.";

/**
 * The signed-in user's id, but only when the health page is theirs to see.
 *
 * Checked against the database on every request, never trusted from the
 * client — the same shape `currentAdminId` has.
 */
export async function currentHealthUserId(): Promise<ObjectId | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  if (healthOpenToAll()) return userId;

  const d = await db();
  const user = await d
    .collection("users")
    .findOne({ _id: userId }, { projection: { invited: 1 } });
  return hasAI(user) ? userId : null;
}
