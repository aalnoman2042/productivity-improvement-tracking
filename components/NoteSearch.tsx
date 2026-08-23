"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { prettyDate } from "@/lib/dates";
import { MIN_QUERY } from "@/lib/noteSearch";

/**
 * The way back to something you wrote.
 *
 * It sits on the History page because that is where the written half of the
 * log already lives — the dots on the calendar, the month's notes underneath.
 * Typing here replaces that view with the matches instead of navigating
 * somewhere new: the answer to "when did I write that?" is a date, and a date
 * on this page is one tap from the day itself.
 */

type Hit = {
  date: string;
  tracker: string | null;
  text: string;
  snippet: string;
};

type Results = { q: string; count: number; capped: boolean; results: Hit[] };

/** The matched run, marked in the excerpt so the eye lands on it. */
function Marked({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-accent/25 text-inherit">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

export default function NoteSearch() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);

  const term = query.trim();

  useEffect(() => {
    // Nothing to clear here: a query too short to run was already cleared by
    // the keystroke that made it short. An effect that calls setState on its
    // way past is what the React Compiler rules are for.
    if (term.length < MIN_QUERY) return;
    // Typing is not a search each keystroke — this waits for a pause, and
    // an aborted controller drops the answer to a query already replaced.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/notes/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        setData(res.ok ? await res.json() : null);
      } catch {
        // An abort is the normal case here, not a failure worth showing.
      } finally {
        setBusy(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <section className="space-y-3">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Dropping below the minimum drops the results with it, in the
            // event that caused it rather than in an effect afterwards.
            if (e.target.value.trim().length < MIN_QUERY) setData(null);
          }}
          placeholder="Search everything you've written…"
          aria-label="Search your notes"
          className="w-full rounded-xl border border-edge card px-3 py-2.5 pr-20 text-sm shadow-sm"
        />
        {busy && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">
            searching…
          </span>
        )}
      </div>

      {term.length >= MIN_QUERY && data && (
        <div className="rounded-xl border border-edge card p-4 shadow-sm">
          <h2 className="font-semibold">
            📝 {data.count === 0 ? "Nothing found" : `${data.count} note${data.count === 1 ? "" : "s"}`}
            <span className="font-normal text-muted"> for “{data.q}”</span>
          </h2>

          {data.count === 0 ? (
            <p className="mt-2 text-sm text-secondary">
              No note has those words in it. Notes are written on the daily
              log — the day&apos;s own note at the foot of the page, and one
              per tracker you filled in.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.results.map((hit, i) => (
                <li
                  key={`${hit.date}-${hit.tracker ?? "day"}-${i}`}
                  className="rounded-md border border-edge bg-surface-2 p-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/?date=${hit.date}`}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {prettyDate(hit.date)}
                    </Link>
                    {hit.tracker && (
                      <span className="shrink-0 text-xs text-muted">{hit.tracker}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">
                    <Marked text={hit.snippet} query={data.q} />
                  </p>
                </li>
              ))}
            </ul>
          )}

          {data.capped && (
            <p className="mt-3 text-xs text-muted">
              Showing the newest {data.count}. A narrower search will reach the
              older ones.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
