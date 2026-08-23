"use client";

import { useMemo, useState } from "react";
import { useCached } from "@/lib/useCached";
import { prettyDate, toDateStr } from "@/lib/dates";
import {
  BOOK_STATUSES,
  MAX_BOOK_AUTHOR,
  MAX_BOOK_TITLE,
  bookStats,
  progressOf,
  readingPace,
  shelfOrder,
  type Book,
  type BookStatus,
} from "@/lib/books";

/**
 * The bookshelf, living behind a button on the Trackers page.
 *
 * A book is not a habit — it asks its question once and then goes quiet for a
 * fortnight — so it isn't a tracker type, and none of this touches a day's
 * score, streaks or the coach. But it is the same kind of thing to *manage*
 * as a tracker or a challenge: something you set up once and act on for weeks
 * afterwards. So it lives on the Trackers page rather than claiming a tab of
 * its own — but *behind a button*, on a view of its own, because that page is
 * already long and a shelf of forty books at the foot of it helps nobody.
 * `standalone` is that view: the page owns the heading, so this doesn't.
 *
 * Three shelves and one tap between them. Nothing asks for a date: starting a
 * book stamps today, finishing it stamps today, and `afterStatusChange` in
 * lib/books owns those rules so the page and the tests can't disagree.
 */

const field =
  "w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm outline-none focus:border-accent";

/** How many finished books show before the shelf offers to unfold. */
const SHELF_PREVIEW = 5;

/** The bar, and the honest blank where a page count was never typed. */
function Progress({ book }: { book: Book }) {
  const pct = progressOf(book);
  if (pct === null) return null;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div
        className="bg-brand-gradient h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.round(pct * 100)}%` }}
      />
    </div>
  );
}

function Stars({
  rating,
  onRate,
}: {
  rating: number | null;
  onRate: (n: number | null) => void;
}) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          // Tapping the star you already gave takes the rating back off —
          // there's no other way to undo a mis-tap on a five-button control.
          onClick={() => onRate(rating === n ? null : n)}
          aria-label={`${n} out of 5`}
          className={`px-0.5 text-base leading-none transition-transform hover:scale-110 ${
            (rating ?? 0) >= n ? "text-amber-500" : "text-muted"
          }`}
        >
          {(rating ?? 0) >= n ? "★" : "☆"}
        </button>
      ))}
    </span>
  );
}

export default function Books({ standalone = false }: { standalone?: boolean }) {
  const today = toDateStr(new Date());
  const q = useCached<Book[]>("/api/books", "books");
  const books = useMemo(() => q.data ?? [], [q.data]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [shelf, setShelf] = useState<BookStatus>("wishlist");
  const [unfolded, setUnfolded] = useState<string[]>([]);

  const stats = useMemo(() => bookStats(books, today), [books, today]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/books/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, today }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not save that");
        return;
      }
      const book = data as Book;
      q.update(books.map((b) => (b.id === book.id ? book : b)));
    } catch {
      setError("Could not reach the server — books need a connection");
    } finally {
      setBusy(false);
    }
  }

  async function remove(book: Book) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Could not remove that book");
        return;
      }
      q.update(books.filter((b) => b.id !== book.id));
    } catch {
      setError("Could not reach the server — books need a connection");
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          author,
          pages: pages || null,
          status: shelf,
          today,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not add that book");
        return;
      }
      q.update([data as Book, ...books]);
      setTitle("");
      setAuthor("");
      setPages("");
      setAdding(false);
    } catch {
      setError("Could not reach the server — books need a connection");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form
      onSubmit={add}
      className="animate-rise-in space-y-3 rounded-xl border border-edge card p-4 shadow-sm"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_BOOK_TITLE}
        placeholder="Title"
        aria-label="Title"
        className={field}
      />
      <div className="flex flex-wrap gap-3">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={MAX_BOOK_AUTHOR}
          placeholder="Author (optional)"
          aria-label="Author"
          className={`${field} min-w-40 flex-1`}
        />
        <input
          value={pages}
          onChange={(e) => setPages(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
          inputMode="numeric"
          placeholder="Pages"
          aria-label="Total pages"
          className={`${field} w-24 shrink-0`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-secondary">Put it on:</span>
        {(["wishlist", "reading", "finished"] as BookStatus[]).map((s) => {
          const meta = BOOK_STATUSES.find((b) => b.value === s)!;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setShelf(s)}
              className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                shelf === s
                  ? "border-accent bg-accent text-white"
                  : "border-edge text-secondary hover:bg-surface-2"
              }`}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-lg bg-brand-gradient px-5 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          Add book
        </button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="animate-fade-in text-sm font-medium text-red-600">{error}</p>
      )}
    </form>
  );

  // Nothing on the shelf yet: an invitation, not an empty grid of headings.
  if (books.length === 0) {
    return adding ? (
      <section className="space-y-3">
        {!standalone && (
          <h2 className="text-sm font-semibold text-secondary">📚 Books</h2>
        )}
        {form}
      </section>
    ) : (
      <section className="rounded-lg border border-dashed border-edge p-5 text-center">
        <p className="font-medium">📚 A shelf for what you read</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          Not a habit and not a tracker — a wishlist, whatever you&apos;re in
          the middle of, and the count of what you actually finished.
        </p>
        <button
          onClick={() => setAdding(true)}
          className="mt-3 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Add a book
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {!standalone && (
          <h2 className="text-sm font-semibold text-secondary">📚 Books</h2>
        )}
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="ml-auto rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-2"
          >
            + Add a book
          </button>
        )}
      </div>

      {/* The number the shelf exists for, first — the rest is bookkeeping. */}
      <p className="text-sm text-secondary">
        <strong className="tabular-nums text-foreground">{stats.finished}</strong>{" "}
        {stats.finished === 1 ? "book" : "books"} read
        {stats.finishedThisYear > 0 && (
          <>
            , <strong className="tabular-nums">{stats.finishedThisYear}</strong> in{" "}
            {today.slice(0, 4)}
          </>
        )}
        {stats.reading > 0 && <> · {stats.reading} on the go</>}
        {stats.wishlist > 0 && <> · {stats.wishlist} on the wishlist</>}
        {stats.pagesRead > 0 && (
          <> · {stats.pagesRead.toLocaleString()} pages</>
        )}
      </p>

      {adding && form}
      {error && !adding && (
        <p className="animate-fade-in text-sm font-medium text-red-600">{error}</p>
      )}

      {BOOK_STATUSES.map((section) => {
        const shelfBooks = shelfOrder(books, section.value);
        if (shelfBooks.length === 0) return null;
        const open = unfolded.includes(section.value);
        // A finished shelf grows for years; showing all of it inside another
        // page would bury everything under it.
        const shown =
          open || shelfBooks.length <= SHELF_PREVIEW
            ? shelfBooks
            : shelfBooks.slice(0, SHELF_PREVIEW);

        return (
          <div key={section.value} className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <span>
                {section.icon} {section.label}
              </span>
              <span className="tabular-nums">({shelfBooks.length})</span>
            </div>
            <ul className="space-y-2">
              {shown.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  today={today}
                  busy={busy}
                  onPatch={patch}
                  onRemove={remove}
                />
              ))}
            </ul>
            {shelfBooks.length > shown.length && (
              <button
                onClick={() => setUnfolded((ids) => [...ids, section.value])}
                className="text-xs font-medium text-accent hover:underline"
              >
                Show all {shelfBooks.length}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * One book, and only the moves that make sense for the shelf it's on. A book
 * on the wishlist has no progress to type and a finished one has no progress
 * to change — showing either would be a form asking a question nobody has.
 */
function BookCard({
  book,
  today,
  busy,
  onPatch,
  onRemove,
}: {
  book: Book;
  today: string;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRemove: (book: Book) => Promise<void>;
}) {
  const [read, setRead] = useState(String(book.pagesRead || ""));
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [pages, setPages] = useState(book.pages ? String(book.pages) : "");

  const pace = readingPace(book, today);
  const small =
    "rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-2 disabled:opacity-40";

  return (
    <li className="rounded-xl border border-edge card p-3 shadow-sm">
      {editing ? (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_BOOK_TITLE}
            aria-label="Title"
            className={field}
          />
          <div className="flex flex-wrap gap-2">
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={MAX_BOOK_AUTHOR}
              placeholder="Author"
              aria-label="Author"
              className={`${field} min-w-40 flex-1`}
            />
            <input
              value={pages}
              onChange={(e) => setPages(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
              inputMode="numeric"
              placeholder="Pages"
              aria-label="Total pages"
              className={`${field} w-24 shrink-0`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={async () => {
                await onPatch(book.id, { title, author, pages: pages || null });
                setEditing(false);
              }}
              className="rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={small}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 font-medium">{book.title}</span>
            {book.author && (
              <span className="min-w-0 truncate text-sm text-muted">
                {book.author}
              </span>
            )}
            {book.status === "finished" && (
              <span className="ml-auto">
                <Stars
                  rating={book.rating}
                  onRate={(n) => void onPatch(book.id, { rating: n })}
                />
              </span>
            )}
          </div>

          <Progress book={book} />

          <div className="mt-1.5 text-xs text-muted">
            {book.status === "reading" && book.pages && (
              <span className="tabular-nums">
                {book.pagesRead} of {book.pages} pages
                {pace && ` · about ${pace.perDay}/day, ${pace.daysLeft} to go`}
              </span>
            )}
            {book.status === "reading" && !book.pages && (
              <span>
                {book.startedOn
                  ? `Started ${prettyDate(book.startedOn)}`
                  : "In progress"}
                {" · add a page count to see a bar"}
              </span>
            )}
            {book.status === "finished" && book.finishedOn && (
              <span>Finished {prettyDate(book.finishedOn)}</span>
            )}
            {book.status === "dropped" && <span>Put down, not forgotten</span>}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {book.status === "reading" && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-secondary">
                  On page
                  <input
                    value={read}
                    onChange={(e) =>
                      setRead(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))
                    }
                    onBlur={() => {
                      const n = Number(read || 0);
                      if (n !== book.pagesRead) {
                        void onPatch(book.id, { pagesRead: n });
                      }
                    }}
                    inputMode="numeric"
                    aria-label={`Pages read of ${book.title}`}
                    className="w-16 rounded-md border border-edge bg-transparent px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPatch(book.id, { status: "finished" })}
                  className="rounded-md border border-green-700 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-700/10 disabled:opacity-40 dark:text-green-500"
                >
                  ✓ Finished
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPatch(book.id, { status: "dropped" })}
                  className={small}
                >
                  Put down
                </button>
              </>
            )}

            {book.status === "wishlist" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPatch(book.id, { status: "reading" })}
                className="rounded-md border border-accent px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-40"
              >
                📖 Start reading
              </button>
            )}

            {(book.status === "finished" || book.status === "dropped") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onPatch(book.id, { status: "reading" })}
                className={small}
              >
                {book.status === "finished" ? "Read it again" : "Pick it back up"}
              </button>
            )}

            <button type="button" onClick={() => setEditing(true)} className={small}>
              Edit
            </button>

            {/* Two taps, not a typed phrase: a book is a line on a shelf, not
                a year of entries. */}
            {confirming ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onRemove(book)}
                  className="rounded-md border border-red-600 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-600/10 disabled:opacity-40"
                >
                  Really remove
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={small}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="ml-auto rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-2"
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
