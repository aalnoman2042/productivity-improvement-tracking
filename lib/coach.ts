/**
 * The shape of a coach review — what the AI is asked to return and what the
 * Status page renders. Parsed defensively: the model's JSON is checked field
 * by field, and anything malformed degrades to plain text rather than a
 * broken card.
 */

/** The coach reads a life once every 8 hours — enforced by the server off
 * the last review's timestamp, shown as a countdown by the client. */
export const COACH_COOLDOWN_MS = 8 * 60 * 60_000;

export type CoachPoint = {
  /** The claim, in plain words. */
  point: string;
  /** The number(s) it stands on — "2:10 am average bedtime, 9 of 14 nights". */
  evidence: string;
};

export type CoachReview = {
  /** One punchy sentence — the whole read in a line. */
  headline: string;
  /** 2–3 sentences: what this life looks like right now. */
  verdict: string;
  working: CoachPoint[];
  slipping: CoachPoint[];
  fix: {
    /** The one thing to fix first this week. */
    what: string;
    /** The first concrete step, tonight. */
    tonight: string;
  };
  /** Two or three concrete moves for the rest of the week. Optional: reviews
   * written before this field existed are still perfectly good reviews. */
  week?: string[];
};

/**
 * The numbers on the card — worked out by the app, never by the model.
 *
 * The review is a judgement and the model is allowed to be wrong about it;
 * these are facts, so they're computed server-side from the same data the
 * model was shown and rendered exactly as given. It means the top of the
 * card is trustworthy at a glance even on a run where the writing is weak.
 */
export type CoachSnapshot = {
  /** Day score of the most recent day that has one, 0–100. */
  score: number | null;
  scoreDate: string | null;
  /** Average day score over the last 7 days, and the 7 before them. */
  avg7: number | null;
  prevAvg7: number | null;
  /** Which way that moved — the one-glance answer to "am I improving?". */
  momentum: "rising" | "steady" | "slipping" | null;
  /** The window, oldest day first — the card's sparkline. */
  days: { date: string; score: number | null }[];
  daysLogged: number;
  windowDays: number;
  /** Consecutive logged days ending today. */
  streak: number;
  /** All-time report-card letter, when there's enough history to grade. */
  grade: string | null;
  /** "6h 40m a night · bed 1:20 am", when sleep is tracked. */
  sleep: string | null;
};

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

function points(raw: unknown): CoachPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachPoint[] = [];
  for (const item of raw) {
    if (out.length >= 4) break;
    const point = str((item as Record<string, unknown>)?.point, 200);
    const evidence = str((item as Record<string, unknown>)?.evidence, 200);
    if (point) out.push({ point, evidence: evidence ?? "" });
  }
  return out;
}

/** Short, concrete lines — anything longer is a paragraph pretending. */
function moves(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= 3) break;
    const line = str(item, 180);
    if (line) out.push(line);
  }
  return out.length > 0 ? out : undefined;
}

/** The model's JSON into a CoachReview, or null if it isn't one. */
export function parseReview(raw: string): CoachReview | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const headline = str(d.headline, 200);
  const verdict = str(d.verdict, 800);
  const fix = d.fix as Record<string, unknown> | undefined;
  const what = str(fix?.what, 300);
  const tonight = str(fix?.tonight, 300);
  if (!headline || !verdict || !what || !tonight) return null;

  return {
    headline,
    verdict,
    working: points(d.working),
    slipping: points(d.slipping),
    fix: { what, tonight },
    week: moves(d.week),
  };
}
