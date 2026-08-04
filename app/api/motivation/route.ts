import { NextResponse } from "next/server";
import { BUNDLED, clean, type Line } from "@/lib/motivation";

/**
 * Fresh lines for the loading screens, fetched from a handful of free quote
 * APIs and handed on as one normalised list.
 *
 * It goes through the server rather than straight from the browser for three
 * reasons: none of these services promise CORS headers, the reader's IP never
 * reaches a third party this way, and one warm instance can serve the same
 * batch to everyone instead of every tab asking independently.
 *
 * Every source is optional. They are hobby endpoints with no uptime promise —
 * `quotable.io`, which used to be the obvious pick, is simply gone — so all of
 * them are raced with a short timeout and whatever comes back is used. If they
 * all fail, the bundled lines answer instead and nobody sees a difference.
 */

export const dynamic = "force-dynamic";

/** Long enough to be worth having, short enough to never delay a page. */
const FETCH_TIMEOUT_MS = 2500;

/** How long a batch is reused before anyone goes back out to the network. */
const CACHE_MS = 30 * 60_000;

type Fetcher = { name: string; url: string; parse: (data: unknown) => Line[] };

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

const SOURCES: Fetcher[] = [
  {
    name: "zenquotes",
    url: "https://zenquotes.io/api/quotes",
    // [{ q: "...", a: "Author" }]
    parse: (d) =>
      asArray(d)
        .map((x) => clean((x as { q?: unknown })?.q, (x as { a?: unknown })?.a))
        .filter(Boolean) as Line[],
  },
  {
    name: "dummyjson",
    url: "https://dummyjson.com/quotes?limit=30",
    // { quotes: [{ quote, author }] }
    parse: (d) =>
      asArray((d as { quotes?: unknown })?.quotes)
        .map((x) =>
          clean((x as { quote?: unknown })?.quote, (x as { author?: unknown })?.author)
        )
        .filter(Boolean) as Line[],
  },
  {
    name: "affirmations",
    url: "https://www.affirmations.dev/",
    // { affirmation: "..." } — one at a time, and deliberately unattributed
    parse: (d) => {
      const line = clean((d as { affirmation?: unknown })?.affirmation, null);
      return line ? [line] : [];
    },
  },
  {
    name: "stoic",
    url: "https://stoic-quotes.com/api/quotes",
    // [{ text, author }]
    parse: (d) =>
      asArray(d)
        .map((x) =>
          clean((x as { text?: unknown })?.text, (x as { author?: unknown })?.author)
        )
        .filter(Boolean) as Line[],
  },
];

async function fromSource(s: Fetcher): Promise<Line[]> {
  try {
    const res = await fetch(s.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
      // These are third-party and slow; never let one hold up a build or a
      // page render by being cached into a static response.
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return [];
    return s.parse(await res.json());
  } catch {
    // Down, slow, rate-limited, or answering with something unexpected —
    // all the same to us, and all survivable.
    return [];
  }
}

let cache: { at: number; lines: Line[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ lines: cache.lines, cached: true });
  }

  const batches = await Promise.all(SOURCES.map(fromSource));
  const fetched = batches.flat();

  // Two of the same quote from two services is one quote.
  const seen = new Set<string>();
  const lines = [...fetched, ...BUNDLED].filter((l) => {
    const key = l.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Only remember a batch that actually got something new; a run where every
  // source was down shouldn't lock the bundled fallback in for half an hour.
  if (fetched.length > 0) cache = { at: Date.now(), lines };

  return NextResponse.json({
    lines,
    cached: false,
    sources: fetched.length,
  });
}
