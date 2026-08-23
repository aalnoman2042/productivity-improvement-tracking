import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import {
  MIN_QUERY,
  escapeRegex,
  normalizeQuery,
  snippet,
  sortHits,
  type NoteHit,
} from "@/lib/noteSearch";

/**
 * Search everything you have written — the day notes and the ones pinned to
 * a tracker, in one list, newest first.
 *
 * Both collections are read because a note lives in whichever place it was
 * written: `dayNotes` holds the day's own line, `entries.note` the margin
 * scribbles. Neither is the authority on the other, so the search reads both
 * rather than pretending one is a subset.
 *
 * A regex scan rather than a text index on purpose: this is one person's
 * notes, thousands of short rows at the very most, and a substring match is
 * what a search box is expected to do — "sleep" should find "sleeping",
 * which a word index would not.
 */

/** Enough to scroll; past this, a narrower query is the better answer. */
const MAX_RESULTS = 60;

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("q");
  const q = normalizeQuery(raw);
  if (!q) {
    return NextResponse.json(
      { error: `Type at least ${MIN_QUERY} characters to search` },
      { status: 400 }
    );
  }

  // Escaped, so a note containing "(" is searchable and a query containing
  // one can't become a pattern that runs away on the server.
  const pattern = new RegExp(escapeRegex(q), "i");
  const d = await db();

  const [dayRows, entryRows] = await Promise.all([
    d
      .collection("dayNotes")
      .find({ userId, text: pattern }, { projection: { date: 1, text: 1, _id: 0 } })
      .sort({ date: -1 })
      .limit(MAX_RESULTS)
      .toArray(),
    d
      .collection("entries")
      .find(
        { userId, note: pattern },
        { projection: { date: 1, note: 1, trackerId: 1, _id: 0 } }
      )
      .sort({ date: -1 })
      .limit(MAX_RESULTS)
      .toArray(),
  ]);

  // Names, not ids: a result reading "Sleep" is the point of the row.
  const names = new Map<string, string>();
  if (entryRows.length > 0) {
    const trackers = await d
      .collection("trackers")
      .find(
        { userId, _id: { $in: [...new Set(entryRows.map((e) => e.trackerId))] } },
        { projection: { name: 1 } }
      )
      .toArray();
    for (const t of trackers) names.set(String(t._id), String(t.name));
  }

  const hits: NoteHit[] = [
    ...dayRows.map((r) => ({
      date: String(r.date),
      tracker: null,
      text: String(r.text),
    })),
    ...entryRows.map((r) => ({
      date: String(r.date),
      // A note whose tracker has since been deleted keeps the note; it just
      // stops knowing whose it was.
      tracker: names.get(String(r.trackerId)) ?? "—",
      text: String(r.note),
    })),
  ];

  const results = sortHits(hits)
    .slice(0, MAX_RESULTS)
    .map((h) => ({ ...h, snippet: snippet(h.text, q) }));

  return NextResponse.json({
    q,
    // What was found, and whether the list is the whole truth — a capped
    // list that says so is honest; one that doesn't is a lie about the data.
    count: results.length,
    capped: hits.length > MAX_RESULTS,
    results,
  });
}
