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

/**
 * What to fall back to when the first choice doesn't answer.
 *
 * Both directions are real: the big model is the better writer, the small one
 * is cheaper on a minute that is capped at 8,000 tokens, and either can be
 * the one that is unavailable. Both were checked against the actual coach
 * prompt on 2026-08-23 and both return a complete, valid review.
 *
 * `qwen/qwen3.6-27b` is deliberately NOT in here: it is in the catalogue and
 * it fails this prompt outright (HTTP 400, `json_validate_failed`, empty
 * generation). A fallback that cannot answer is worse than no fallback,
 * because it turns one clear failure into two slow ones.
 */
const FALLBACKS: Record<string, string> = {
  "openai/gpt-oss-120b": "openai/gpt-oss-20b",
  "openai/gpt-oss-20b": "openai/gpt-oss-120b",
};

export type GroqOk = { ok: true; text: string; model: string };
export type GroqFail = { ok: false; status: number; error: string };

/** What a failed attempt means: worth another model, or worth stopping. */
export type Attempt = {
  /** Whether a different model could plausibly do better. */
  retry: boolean;
  status: number;
  error: string;
};

/**
 * Read a failure and decide whether the next model in the chain is worth a
 * try. Pure, so the decision can be tested without a network.
 *
 * The one that surprises people is 429: it does NOT retry. Groq's free tier
 * caps tokens per *minute* across the org, so a second model is asking the
 * same exhausted budget — measured, not assumed, while probing this app's
 * own prompts. Retrying there would turn a one-minute wait into two.
 */
export function classifyFailure(status: number, body: string): Attempt {
  if (status === 401 || status === 403) {
    return {
      retry: false,
      status: 502,
      error: "The AI key was rejected — check GROQ_API_KEY",
    };
  }

  if (status === 429) {
    return {
      retry: false,
      status: 502,
      error: "The free AI quota is catching its breath — try again in a minute",
    };
  }

  // The configured model is gone. This is the failure that "try again
  // shortly" was actively wrong about: retrying the same name never works,
  // and a model id withdrawn by the provider is a config problem to read
  // about, not weather to wait out. (It has happened once already —
  // llama-3.3-70b-versatile.)
  if (body.includes("model_not_found") || body.includes("does not exist")) {
    return {
      retry: true,
      status: 502,
      error:
        "The configured AI model no longer exists at Groq — set GROQ_MODEL to one that does",
    };
  }

  // The model could not satisfy the JSON schema, or spent its whole budget
  // thinking and returned nothing. A different model genuinely may not.
  if (status === 400 || status === 0) {
    return {
      retry: true,
      status: 502,
      error: "The AI answer came back unusable — try again",
    };
  }

  if (status >= 500 || status === 408) {
    return { retry: true, status: 502, error: "The AI service had trouble — try again shortly" };
  }

  return { retry: false, status: 502, error: "The AI service had trouble — try again shortly" };
}

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
  const first = ask.model || process.env.GROQ_MODEL || DEFAULT_MODEL;
  const chain = [first, FALLBACKS[first]].filter(Boolean) as string[];

  let last: Attempt = {
    retry: false,
    status: 502,
    error: "The AI service had trouble — try again shortly",
  };

  for (const model of chain) {
    const attempt = await once(apiKey, model, ask);
    if ("ok" in attempt && attempt.ok) {
      if (model !== first) {
        // Worth a line in the log: the primary is unavailable, and the only
        // other sign of it is a review quietly written by a smaller model.
        console.warn(`Groq: ${first} unavailable, answered by ${model}`);
      }
      return attempt;
    }
    last = attempt as Attempt;
    if (!last.retry) break;
  }

  return { ok: false, status: last.status, error: last.error };
}

/** One model, one attempt. Returns the answer, or why it didn't come. */
async function once(
  apiKey: string,
  model: string,
  ask: GroqAsk
): Promise<GroqOk | Attempt> {
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
      console.error("Groq error:", model, res.status, detail.slice(0, 500));
      return classifyFailure(res.status, detail);
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      // A reasoning model that spends its whole budget thinking answers with
      // nothing at all — status 0 stands for "answered, but with nothing".
      console.error("Groq returned an empty generation:", model);
      return classifyFailure(0, "empty generation");
    }
    return { ok: true, text, model: data.model ?? model };
  } catch (err) {
    console.error("Groq request failed:", model, err);
    return {
      retry: true,
      status: 502,
      error: "Couldn't reach the AI service — check the connection and try again",
    };
  }
}
