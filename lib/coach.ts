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
  };
}
