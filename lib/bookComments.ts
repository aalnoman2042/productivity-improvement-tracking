import { isValidDateStr } from "./dates";
import { cleanNote } from "./notes";

/**
 * What you thought of a book, written down as you go.
 *
 * The shelf already had a single `note` field, and a single field is the
 * wrong shape for this: reading a book takes weeks, and the thing worth
 * keeping is what you made of chapter nine *at the time*, not one paragraph
 * rewritten until it's a review. So a book carries a list — each comment
 * stamped with the day it was written, in the order it was written, never
 * reordered and never edited in place.
 *
 * Like the shelf itself, none of this reaches a number: not the day score,
 * not a streak, not the report card, and **not the AI coach** — it is words
 * somebody wrote, which is the same rule the day's notes and the to-do list
 * live under (`gatherCoachFacts` sees tracker names and figures only).
 *
 * Pure. The route validates with it, the card renders with it, and the JSON
 * backup carries it back in through the same parser.
 */

export type BookComment = {
  id: string;
  text: string;
  /** The reader's own local day — books are stamped by the client's clock. */
  on: string;
};

/** A thought, not an essay. Longer than a tracker note, shorter than the day's. */
export const MAX_BOOK_COMMENT = 600;

/** Enough for a comment a week through a long book, twice over. */
export const MAX_BOOK_COMMENTS = 100;

export function cleanComment(raw: unknown): string | null {
  return cleanNote(raw, MAX_BOOK_COMMENT);
}

/** One stored comment, or null when it isn't one. */
function parseComment(raw: unknown): BookComment | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const text = cleanComment(c.text);
  const id = typeof c.id === "string" ? c.id : null;
  if (!text || !id) return null;
  return {
    id,
    text,
    // A comment whose date is unreadable is still the comment; losing the
    // words to protect a stamp would be the wrong trade.
    on: isValidDateStr(c.on) ? c.on : "",
  };
}

/** Whatever is on the document, made safe to render. */
export function parseComments(raw: unknown): BookComment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseComment)
    .filter((c): c is BookComment => c !== null)
    .slice(0, MAX_BOOK_COMMENTS);
}

/**
 * Add one, oldest first. Returns null when the book is full — a cap that
 * silently drops the comment somebody just typed is worse than a refusal
 * they can read.
 */
export function addComment(
  list: BookComment[],
  comment: BookComment
): BookComment[] | null {
  if (list.length >= MAX_BOOK_COMMENTS) return null;
  return [...list, comment];
}

export function removeComment(list: BookComment[], id: string): BookComment[] {
  return list.filter((c) => c.id !== id);
}
