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

/**
 * The verdict in one word, so the card can be read before it is read.
 *
 * Someone opening this at midnight wants "am I alright?" answered before
 * they parse a paragraph — and a chip they can take in at a glance is worth
 * more than the three sentences under it. Optional: reviews written before
 * it existed are still perfectly good reviews.
 */
export type CoachState = "thriving" | "steady" | "slipping" | "stalled";

const STATES: CoachState[] = ["thriving", "steady", "slipping", "stalled"];

export type CoachReview = {
  /** One punchy sentence — the whole read in a line. */
  headline: string;
  /** The one-word verdict, when the model gave a usable one. */
  state?: CoachState;
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

/**
 * Evidence that turned out to be a paste of the data instead of a phrase.
 *
 * The prompt forbids it and the model still does it under load —
 * `"currentCleanDays":14` where "14 days clean" was asked for. Rather than
 * showing someone the app's own field names as though they were a sentence
 * about their life, the evidence is dropped and the point stands alone: a
 * claim without its number reads as a claim, which is honest. A number
 * wearing a JSON key does not.
 */
function cleanEvidence(raw: unknown): string {
  const text = str(raw, 200);
  if (!text) return "";
  const leaked = /"[A-Za-z_][\w]*"\s*:|[{}[\]]|\b[A-Za-z_]\w*\s*:\s*"/.test(text);
  return leaked ? "" : text;
}

function points(raw: unknown): CoachPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: CoachPoint[] = [];
  for (const item of raw) {
    if (out.length >= 4) break;
    const point = str((item as Record<string, unknown>)?.point, 200);
    const evidence = cleanEvidence((item as Record<string, unknown>)?.evidence);
    if (point) out.push({ point, evidence });
  }
  return out;
}

/**
 * Short, concrete lines — anything longer is a paragraph pretending.
 *
 * A line may arrive wrapped in an object. The prompt asks for plain strings
 * and gpt-oss gives them; Gemini answers the same prompt with
 * `[{"move": "..."}]`, which is a defensible reading of "a list of moves"
 * and would otherwise silently empty the section. Two providers, one shape:
 * unwrap the object rather than argue with either of them in the prompt.
 */
function moves(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= 3) break;
    const wrapped =
      item && typeof item === "object"
        ? (item as Record<string, unknown>).move ??
          (item as Record<string, unknown>).text ??
          (item as Record<string, unknown>).point
        : item;
    const line = str(wrapped, 180);
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
    // An unrecognised word is dropped rather than shown: the chip's whole
    // value is that its four states mean the same thing every time.
    state: STATES.find((s) => s === d.state),
    verdict,
    working: points(d.working),
    slipping: points(d.slipping),
    fix: { what, tonight },
    week: moves(d.week),
  };
}
