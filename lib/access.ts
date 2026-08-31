import type { Document, WithId } from "mongodb";

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
