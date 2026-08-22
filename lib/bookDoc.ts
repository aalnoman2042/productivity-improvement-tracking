import type { Document, WithId } from "mongodb";
import {
  MAX_BOOK_AUTHOR,
  MAX_BOOK_NOTE,
  MAX_BOOK_TITLE,
  clampRead,
  normalizeStatus,
  parsePages,
  parseRating,
  type Book,
} from "./books";
import { cleanNote } from "./notes";

/**
 * Turning a stored book into the shape the client sees, and a request body
 * into something the database will accept.
 *
 * Lives outside the routes because a `route.ts` may only export request
 * handlers, and the list route, the single-book route and the backup import
 * all have to agree on what a book is.
 */

export function toBook(doc: WithId<Document>): Book {
  const pages = parsePages(doc.pages);
  return {
    id: String(doc._id),
    title: String(doc.title ?? ""),
    author: (doc.author as string | null) ?? null,
    status: normalizeStatus(doc.status),
    pages,
    pagesRead: clampRead(doc.pagesRead, pages),
    rating: parseRating(doc.rating),
    startedOn: (doc.startedOn as string | null) ?? null,
    finishedOn: (doc.finishedOn as string | null) ?? null,
    note: (doc.note as string | null) ?? null,
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date(0).toISOString(),
  };
}

export function parseTitle(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_BOOK_TITLE) : "";
}

export function parseAuthor(raw: unknown): string | null {
  return cleanNote(raw, MAX_BOOK_AUTHOR);
}

export function parseBookNote(raw: unknown): string | null {
  return cleanNote(raw, MAX_BOOK_NOTE);
}
