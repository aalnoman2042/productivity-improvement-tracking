/**
 * The one door to the free AI.
 *
 * Three features talk to Groq now — the daily read, the question box and the
 * weekly review — and they must fail identically: the same friendly sentence
 * when the key is missing, the same one when the free quota is catching its
 * breath, the same refusal to leak a provider's raw error into a card
 * someone is reading about their own life.
 *
 * The Anthropic/paid route stays consciously rejected: the owner wants free
 * AI only, which is the constraint this whole file exists inside.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * A reasoning model, which is why `reasoningEffort` exists below and why
 * `maxTokens` is generous: one trial with the budget too low burned it all
 * on thinking and returned an empty generation with HTTP 400.
 */
export const DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * The lighter model, for the asks that must not queue behind a big one.
 *
 * Groq's free tier is capped at 8,000 tokens a *minute*, and one reasoning
 * read of a fortnight requests nearly 7,000 of them. A question box sharing
 * that budget would spend its life returning "the quota is catching its
 * breath" — so the short-answer path takes the 20b sibling on a smaller
 * ceiling, about half as much of the minute.
 *
 * Checked against the live catalogue on 2026-08-23, and worth re-checking
 * before trusting any model name here: `llama-3.3-70b-versatile`, which this
 * app used as its default for months, has been withdrawn from Groq entirely
 * and now answers 404. Model ids are not forever.
 */
export const LIGHT_MODEL = "openai/gpt-oss-20b";

export type GroqOk = { ok: true; text: string; model: string };
export type GroqFail = { ok: false; status: number; error: string };

export type GroqAsk = {
  system: string;
  /** The user turn. Objects are stringified; this is where the facts go. */
  user: string;
  /** Force a JSON object back. Off for answers meant to be read as prose. */
  json?: boolean;
  maxTokens?: number;
  /** Low by default: this reads someone's real numbers, and invention is
   *  the only failure mode that matters. */
  temperature?: number;
  /** How hard the model thinks before writing. Worth raising for the reads
   *  that only happen once every few hours. Sent ONLY when given: a model
   *  that doesn't reason rejects the field outright. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Overrides the default for this call — see LIGHT_MODEL. */
  model?: string;
};

/** Whether the free AI is set up at all — a 503 with a setup line, not a crash. */
export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export const GROQ_SETUP_ERROR =
  "AI analysis isn't set up — add a free GROQ_API_KEY (console.groq.com) to the environment";

export async function askGroq(ask: GroqAsk): Promise<GroqOk | GroqFail> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, status: 503, error: GROQ_SETUP_ERROR };

  // An explicit choice wins: it is made for a reason the environment can't
  // know, like a token budget shared by the minute.
  const model = ask.model || process.env.GROQ_MODEL || DEFAULT_MODEL;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: ask.system },
          { role: "user", content: ask.user },
        ],
        max_tokens: ask.maxTokens ?? 4000,
        temperature: ask.temperature ?? 0.25,
        ...(ask.reasoningEffort ? { reasoning_effort: ask.reasoningEffort } : {}),
        ...(ask.json ? { response_format: { type: "json_object" as const } } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Groq error:", res.status, detail.slice(0, 500));
      return {
        ok: false,
        status: 502,
        error:
          res.status === 429
            ? "The free AI quota is catching its breath — try again in a minute"
            : "The AI service had trouble — try again shortly",
      };
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      // A reasoning model that spends its whole budget thinking answers with
      // nothing at all. Say so plainly rather than rendering an empty card.
      return {
        ok: false,
        status: 502,
        error: "The AI came back empty-handed — try again",
      };
    }
    return { ok: true, text, model: data.model ?? model };
  } catch (err) {
    console.error("Groq request failed:", err);
    return {
      ok: false,
      status: 502,
      error: "Couldn't reach the AI service — check the connection and try again",
    };
  }
}
