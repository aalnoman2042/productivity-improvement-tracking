/**
 * The bookshelf: what you want to read, what you're in the middle of, and
 * what you've actually finished.
 *
 * A book is not a habit, which is why it isn't a tracker. A tracker asks the
 * same question every day and grades the answer; a book is one thing that
 * moves slowly, sits half-read for a fortnight and then ends. So it gets its
 * own shape — a shelf with three states and a page count — and the one number
 * the shelf exists to produce: how many you have actually read.
 *
 * Everything here is pure. The route validates with it, the page renders with
 * it, and the tests hold both to the same arithmetic.
 */
import type { BookComment } from "./bookComments";

export type BookStatus = "wishlist" | "reading" | "finished" | "dropped";

export const BOOK_STATUSES: {
  value: BookStatus;
  label: string;
  icon: string;
  /** What the empty shelf says, when there's nothing under this heading. */
  empty: string;
}[] = [
  {
    value: "reading",
    label: "Reading now",
    icon: "📖",
    empty: "Nothing on the go. Start something from the wishlist.",
  },
  {
    value: "wishlist",
    label: "Wishlist",
    icon: "🔖",
    empty: "Nothing on the list yet — add the next one before you forget it.",
  },
  {
    value: "finished",
    label: "Read",
    icon: "✅",
    empty: "The first finished book lands here.",
  },
  {
    value: "dropped",
    label: "Put down",
    icon: "💤",
    empty: "Nothing abandoned — yet.",
  },
];

export const MAX_BOOK_TITLE = 200;
export const MAX_BOOK_AUTHOR = 120;
export const MAX_BOOK_PAGES = 100_000;
export const MAX_BOOK_NOTE = 1000;

export type Book = {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  /** Total pages, when known — without it there's no bar to fill. */
  pages: number | null;
  /** Pages read so far. */
  pagesRead: number;
  rating: number | null;
  startedOn: string | null;
  finishedOn: string | null;
  note: string | null;
  /** What you made of it, as you went — oldest first. Never a number. */
  comments: BookComment[];
  createdAt: string;
};

export function isBookStatus(raw: unknown): raw is BookStatus {
  return (
    raw === "wishlist" || raw === "reading" || raw === "finished" || raw === "dropped"
  );
}

export function normalizeStatus(raw: unknown): BookStatus {
  return isBookStatus(raw) ? raw : "wishlist";
}

/** A page count, or null when it wasn't given — never a guess. */
export function parsePages(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_BOOK_PAGES) return null;
  return n;
}

export function parseRating(raw: unknown): number | null {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** Pages read, never negative and never past the end of the book. */
export function clampRead(raw: unknown, pages: number | null): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const capped = pages === null ? n : Math.min(n, pages);
  return Math.min(capped, MAX_BOOK_PAGES);
}

/**
 * How far in, 0–1 — or null when there's nothing honest to draw. A finished
 * book with no page count is still finished, so it reads as full.
 */
export function progressOf(book: Book): number | null {
  if (book.status === "finished") return 1;
  if (!book.pages || book.pages <= 0) return null;
  return Math.max(0, Math.min(1, book.pagesRead / book.pages));
}

export type BookStats = {
  finished: number;
  finishedThisYear: number;
  reading: number;
  wishlist: number;
  /** Pages in finished books, plus what's been read of the current ones. */
  pagesRead: number;
};

export function bookStats(books: Book[], today: string): BookStats {
  const year = today.slice(0, 4);
  let finished = 0;
  let finishedThisYear = 0;
  let reading = 0;
  let wishlist = 0;
  let pagesRead = 0;

  for (const b of books) {
    if (b.status === "finished") {
      finished++;
      if (b.finishedOn?.slice(0, 4) === year) finishedThisYear++;
      // A finished book counts whole; a page count nobody typed counts zero
      // rather than an invented average.
      pagesRead += b.pages ?? b.pagesRead;
      continue;
    }
    if (b.status === "reading") reading++;
    if (b.status === "wishlist") wishlist++;
    pagesRead += Math.min(b.pagesRead, b.pages ?? b.pagesRead);
  }

  return { finished, finishedThisYear, reading, wishlist, pagesRead };
}

/**
 * The pace of a book in progress, and what it implies about the end of it.
 *
 * Only offered once there's something to divide: a start date, pages on the
 * clock, and a total to run out of. `daysLeft` is deliberately rounded up —
 * "3 days" that turns out to be two is a nicer surprise than the reverse.
 */
export function readingPace(
  book: Book,
  today: string
): { perDay: number; daysLeft: number } | null {
  if (book.status !== "reading" || !book.startedOn || !book.pages) return null;
  if (book.pagesRead <= 0 || book.pagesRead >= book.pages) return null;

  const days = Math.max(1, daysApart(book.startedOn, today) + 1);
  const perDay = book.pagesRead / days;
  if (perDay <= 0) return null;

  return {
    perDay: Math.round(perDay * 10) / 10,
    daysLeft: Math.ceil((book.pages - book.pagesRead) / perDay),
  };
}

/** Whole days between two YYYY-MM-DD strings, never negative. */
function daysApart(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Shelf order, per section: the current reads by how recently they were
 * started, the wishlist newest-first (the book you just heard about is the
 * one you're thinking of), and the finished shelf by when you finished —
 * that one is a record, so it reads backwards through time.
 */
export function shelfOrder(books: Book[], status: BookStatus): Book[] {
  const shelf = books.filter((b) => b.status === status);
  const by = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");
  if (status === "finished" || status === "dropped") {
    return [...shelf].sort(
      (a, b) => by(a.finishedOn, b.finishedOn) || by(a.createdAt, b.createdAt)
    );
  }
  if (status === "reading") {
    return [...shelf].sort(
      (a, b) => by(a.startedOn, b.startedOn) || by(a.createdAt, b.createdAt)
    );
  }
  return [...shelf].sort((a, b) => by(a.createdAt, b.createdAt));
}

/**
 * What moving a book to another shelf does to its dates and its progress.
 *
 * The dates are the point: a "read" shelf without finish dates can't say how
 * many books this year, and asking someone to type the date they finished a
 * book they just closed is the kind of form-filling that makes a feature go
 * unused. So the shelf writes them, and only ever fills a blank — a date
 * already on record is history and stays put.
 */
export function afterStatusChange(
  book: Pick<Book, "status" | "pages" | "pagesRead" | "startedOn" | "finishedOn">,
  next: BookStatus,
  today: string
): Pick<Book, "status" | "pagesRead" | "startedOn" | "finishedOn"> {
  const base = {
    status: next,
    pagesRead: book.pagesRead,
    startedOn: book.startedOn,
    finishedOn: book.finishedOn,
  };

  if (next === "reading") {
    return { ...base, startedOn: book.startedOn ?? today, finishedOn: null };
  }
  if (next === "finished") {
    return {
      status: next,
      // Finishing fills the bar: the pages are read, whether or not you kept
      // the count up to date on the way.
      pagesRead: book.pages ?? book.pagesRead,
      startedOn: book.startedOn ?? today,
      finishedOn: book.finishedOn ?? today,
    };
  }
  if (next === "dropped") {
    return { ...base, finishedOn: null };
  }
  // Back on the wishlist is "I haven't started this" — so it hasn't.
  return { status: next, pagesRead: 0, startedOn: null, finishedOn: null };
}
