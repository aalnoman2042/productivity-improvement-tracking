"use client";

import { useMemo, useState } from "react";
import { useCached } from "@/lib/useCached";
import { toDateStr } from "@/lib/dates";
import { progressOf, readingPace, shelfOrder, type Book } from "@/lib/books";

/**
 * The book you're in the middle of, on the page where you're already
 * accounting for the day.
 *
 * Logging a day and moving a bookmark are the same act of remembering, and
 * asking someone to go to another screen for the second one is how a shelf
 * goes stale. So the current reads sit at the foot of the log: type the page
 * you reached, watch what's left of the book shrink.
 *
 * Deliberately thin. It shows *only* what's being read now, it disappears
 * entirely when nothing is, and the page number it writes is the same
 * absolute `pagesRead` the shelf keeps — there is no second idea of progress
 * to fall out of step with the first.
 */
export default function ReadingToday() {
  const today = toDateStr(new Date());
  const q = useCached<Book[]>("/api/books", "books");
  const books = useMemo(
    () => shelfOrder(q.data ?? [], "reading"),
    [q.data]
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      q.update((q.data ?? []).map((b) => (b.id === book.id ? book : b)));
    } catch {
      // The rest of this page works offline; the shelf doesn't, and saying so
      // is better than a page number that quietly didn't move.
      setError("No connection — the page number will need saving again later");
    } finally {
      setBusy(false);
    }
  }

  // Nothing on the go: the log stays about the day.
  if (books.length === 0) return null;

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">📖 Reading now</h2>
      <ul className="mt-3 space-y-4">
        {books.map((book) => (
          <CurrentRead
            key={book.id}
            book={book}
            today={today}
            busy={busy}
            onPatch={patch}
          />
        ))}
      </ul>
      {error && (
        <p className="animate-fade-in mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

function CurrentRead({
  book,
  today,
  busy,
  onPatch,
}: {
  book: Book;
  today: string;
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [page, setPage] = useState(String(book.pagesRead || ""));
  const pct = progressOf(book);
  const pace = readingPace(book, today);
  const left = book.pages ? Math.max(0, book.pages - book.pagesRead) : null;
  const done = left === 0 && book.pages !== null;

  function commit() {
    const n = Number(page || 0);
    if (n !== book.pagesRead) void onPatch(book.id, { pagesRead: n });
  }

  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 font-medium">{book.title}</span>
        {book.author && (
          <span className="min-w-0 truncate text-sm text-muted">{book.author}</span>
        )}
        {left !== null && (
          <span className="ml-auto text-sm tabular-nums text-secondary">
            {left === 0 ? "at the last page" : `${left} pages to go`}
          </span>
        )}
      </div>

      {/* Without a page count there is no bar to draw — and inventing one
          from nothing would be the only dishonest number in the app. */}
      {pct !== null ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="bg-brand-gradient h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Add a page count on the Trackers page and this becomes a bar.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          On page
          <input
            value={page}
            onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            inputMode="numeric"
            aria-label={`Page reached in ${book.title}`}
            className="w-20 rounded-md border border-edge bg-transparent px-2 py-1.5 text-right tabular-nums outline-none focus:border-accent"
          />
          {book.pages && (
            <span className="text-sm text-muted tabular-nums">of {book.pages}</span>
          )}
        </label>

        {pace && (
          <span className="text-xs text-muted">
            about {pace.perDay}/day · {pace.daysLeft} days at this rate
          </span>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={() => void onPatch(book.id, { status: "finished" })}
          className={`ml-auto rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${
            done
              ? "border-green-700 bg-green-700/10 text-green-700 dark:text-green-500"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          ✓ Finished
        </button>
      </div>
    </li>
  );
}
