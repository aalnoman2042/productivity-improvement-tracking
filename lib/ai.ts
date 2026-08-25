/**
 * The one door to the free AI — now with two ways through it.
 *
 * Three features talk to a model (the daily read, the question box, the
 * weekly review) and they must fail identically: the same friendly sentence
 * when no key is set, the same one when a free quota is catching its breath,
 * the same refusal to leak a provider's raw error into a card somebody is
 * reading about their own life.
 *
 * It was `lib/groq.ts` until a second provider arrived, and the rename came
 * with it — the same rule that turned `monthCompare` into `periodCompare` the
 * moment it stopped being about months. A file named after one vendor is a
 * file that quietly grows a second vendor inside it.
 *
 * **Why a second provider at all.** Groq's free tier is capped at ~1,000
 * requests a *day per key* and 8,000 tokens a *minute*, and both ceilings
 * belong to the key rather than to the person using it. One user never meets
 * them; a handful of friends on a shared key meet the minute regularly, and
 * a crowd meets the day. Google's free tier has its own separate allowance,
 * so the honest fix for "the quota is catching its breath" is not to wait —
 * it is to ask somebody else. That is the one thing a second model at the
 * same provider could never do.
 *
 * The Anthropic/paid route stays consciously rejected: the owner wants free
 * AI only, which is the constraint this whole file exists inside.
 */

export type Provider = "groq" | "gemini";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

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
 * Google's side of the chain, **measured against this app's own prompt on
 * 2026-08-25**, not taken from documentation:
 *
 * - `gemini-3.5-flash` — valid JSON in ~12s. The daily read's model.
 * - `gemini-3.5-flash-lite` — valid JSON in ~2.5s. The question box's.
 * - `gemini-flash-latest` — an alias, and it *timed out* at 75 seconds on
 *   the same call. Aliases never 404, which is tempting after llama was
 *   withdrawn, but one that hangs is worse than one that is missing.
 * - `gemini-3.7-flash` — the request failed outright on this key.
 *
 * Before trusting any of these, list what the key can actually reach:
 * `GET https://generativelanguage.googleapis.com/v1beta/models` with an
 * `x-goog-api-key` header. Model ids are not forever — this app has already
 * lost one.
 */
export const GEMINI_MODEL = "gemini-3.5-flash";
export const GEMINI_LIGHT_MODEL = "gemini-3.5-flash-lite";

/**
 * Gemini counts its *thinking* against the output ceiling, so a budget that
 * is generous at Groq is a truncated answer here — the same prompt returned
 * unparseable JSON at 4,000 tokens and a complete review at 8,000. Measured,
 * not guessed: the floor is here rather than in the callers because it is a
 * fact about the provider, and no route should have to know it.
 */
const GEMINI_MIN_TOKENS = 8000;

/**
 * What to fall back to when the first choice doesn't answer, *within* a
 * provider.
 *
 * Both directions are real: the big model is the better writer, the small one
 * is cheaper on a minute that is capped at 8,000 tokens, and either can be
 * the one that is unavailable. Both Groq entries were checked against the
 * actual coach prompt on 2026-08-23 and both return a complete, valid review.
 *
 * `qwen/qwen3.6-27b` is deliberately NOT in here: it is in the catalogue and
 * it fails this prompt outright (HTTP 400, `json_validate_failed`, empty
 * generation). A fallback that cannot answer is worse than no fallback,
 * because it turns one clear failure into two slow ones.
 */
const FALLBACKS: Record<string, string> = {
  "openai/gpt-oss-120b": "openai/gpt-oss-20b",
  "openai/gpt-oss-20b": "openai/gpt-oss-120b",
  "gemini-3.5-flash": "gemini-3.5-flash-lite",
  "gemini-3.5-flash-lite": "gemini-3.5-flash",
};

export type AiOk = { ok: true; text: string; model: string; provider: Provider };
export type AiFail = { ok: false; status: number; error: string };

/** What a failed attempt means: worth another model, another provider, or neither. */
export type Attempt = {
  /** Whether a different model *at the same provider* could do better. */
  retry: boolean;
  /**
   * Whether the *other provider* is worth asking.
   *
   * This is the distinction the second provider exists for. A spent minute
   * or a spent day belongs to one key: another model at the same provider is
   * asking the same exhausted budget (which is why `retry` is false for a
   * 429), while another provider has an allowance of its own.
   */
  otherProvider: boolean;
  status: number;
  error: string;
};

/**
 * Read a failure and decide what, if anything, is worth trying next. Pure, so
 * the decision can be tested without a network.
 */
export function classifyFailure(
  status: number,
  body: string,
  provider: Provider = "groq"
): Attempt {
  const keyName = provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";

  if (status === 401 || status === 403) {
    return {
      retry: false,
      // A rejected key is a configuration problem, and the other provider may
      // be perfectly healthy — there is no reason for one bad key to take the
      // whole feature down.
      otherProvider: true,
      status: 502,
      error: `The AI key was rejected — check ${keyName}`,
    };
  }

  if (status === 429) {
    return {
      retry: false,
      otherProvider: true,
      status: 502,
      error: "The free AI quota is catching its breath — try again in a minute",
    };
  }

  // The configured model is gone. This is the failure that "try again
  // shortly" was actively wrong about: retrying the same name never works,
  // and a model id withdrawn by the provider is a config problem to read
  // about, not weather to wait out. (It has happened once already —
  // llama-3.3-70b-versatile.)
  if (
    body.includes("model_not_found") ||
    body.includes("does not exist") ||
    body.includes("NOT_FOUND")
  ) {
    return {
      retry: true,
      otherProvider: true,
      status: 502,
      error: `The configured AI model no longer exists — set ${
        provider === "groq" ? "GROQ_MODEL" : "GEMINI_MODEL"
      } to one that does`,
    };
  }

  // The model could not satisfy the JSON schema, or spent its whole budget
  // thinking and returned nothing. A different model genuinely may not.
  if (status === 400 || status === 0) {
    return {
      retry: true,
      otherProvider: true,
      status: 502,
      error: "The AI answer came back unusable — try again",
    };
  }

  if (status >= 500 || status === 408) {
    return {
      retry: true,
      otherProvider: true,
      status: 502,
      error: "The AI service had trouble — try again shortly",
    };
  }

  return {
    retry: false,
    otherProvider: true,
    status: 502,
    error: "The AI service had trouble — try again shortly",
  };
}

/**
 * Which providers to ask, in order.
 *
 * Pure and separate from the asking, because "who gets asked first" is a
 * decision worth reading in a test rather than inferring from a stack of
 * `if`s. A provider with no key is never in the list — an unconfigured
 * fallback is just a slower failure.
 */
export function chooseProviders(env: {
  groqKey?: string;
  geminiKey?: string;
  preferred?: string;
}): Provider[] {
  const available: Provider[] = [];
  if (env.groqKey) available.push("groq");
  if (env.geminiKey) available.push("gemini");

  const preferred = env.preferred === "gemini" || env.preferred === "groq"
    ? (env.preferred as Provider)
    : null;
  if (!preferred) return available;
  // A stated preference goes first and the other stays as the fallback —
  // "prefer" is not "only", or a spent quota would have nowhere to go.
  return [
    ...available.filter((p) => p === preferred),
    ...available.filter((p) => p !== preferred),
  ];
}

export type AiAsk = {
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
  /** True when the caller wants the small/cheap tier at whichever provider. */
  light?: boolean;
};

/** Whether any free AI is set up at all — a 503 with a setup line, not a crash. */
export function aiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

export const AI_SETUP_ERROR =
  "AI analysis isn't set up — add a free GROQ_API_KEY (console.groq.com) or GEMINI_API_KEY (aistudio.google.com) to the environment";

/** Which model this ask wants at a given provider. */
function modelFor(provider: Provider, ask: AiAsk): string {
  if (provider === "groq") {
    // An explicit choice wins: it is made for a reason the environment can't
    // know, like a token budget shared by the minute.
    if (ask.model) return ask.model;
    if (ask.light) return LIGHT_MODEL;
    return process.env.GROQ_MODEL || DEFAULT_MODEL;
  }
  if (ask.light) return process.env.GEMINI_LIGHT_MODEL || GEMINI_LIGHT_MODEL;
  return process.env.GEMINI_MODEL || GEMINI_MODEL;
}

export async function askAI(ask: AiAsk): Promise<AiOk | AiFail> {
  const providers = chooseProviders({
    groqKey: process.env.GROQ_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
    preferred: process.env.AI_PROVIDER,
  });
  if (providers.length === 0) {
    return { ok: false, status: 503, error: AI_SETUP_ERROR };
  }

  let last: Attempt = {
    retry: false,
    otherProvider: false,
    status: 502,
    error: "The AI service had trouble — try again shortly",
  };

  for (const provider of providers) {
    const first = modelFor(provider, ask);
    const chain = [first, FALLBACKS[first]].filter(Boolean) as string[];

    for (const model of chain) {
      const attempt = await once(provider, model, ask);
      if ("ok" in attempt && attempt.ok) {
        if (provider !== providers[0] || model !== first) {
          // Worth a line in the log: the primary is unavailable, and the only
          // other sign of it is a review quietly written by something else.
          console.warn(`AI: fell back to ${provider}/${model}`);
        }
        return attempt;
      }
      last = attempt as Attempt;
      if (!last.retry) break;
    }
    if (!last.otherProvider) break;
  }

  return { ok: false, status: last.status, error: last.error };
}

/** One provider, one model, one attempt. */
async function once(
  provider: Provider,
  model: string,
  ask: AiAsk
): Promise<AiOk | Attempt> {
  return provider === "groq" ? askGroqOnce(model, ask) : askGeminiOnce(model, ask);
}

async function askGroqOnce(model: string, ask: AiAsk): Promise<AiOk | Attempt> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { retry: false, otherProvider: true, status: 503, error: AI_SETUP_ERROR };
  }
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
      return classifyFailure(res.status, detail, "groq");
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
      return classifyFailure(0, "empty generation", "groq");
    }
    return { ok: true, text, model: data.model ?? model, provider: "groq" };
  } catch (err) {
    console.error("Groq request failed:", model, err);
    return {
      retry: true,
      otherProvider: true,
      status: 502,
      error: "Couldn't reach the AI service — check the connection and try again",
    };
  }
}

/**
 * Google's shape is not OpenAI's: the system prompt is its own field rather
 * than a message, JSON mode is a response *mime type*, and the answer arrives
 * as parts to be joined. Everything above this line is written not to care.
 */
async function askGeminiOnce(model: string, ask: AiAsk): Promise<AiOk | Attempt> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { retry: false, otherProvider: false, status: 503, error: AI_SETUP_ERROR };
  }
  try {
    const res = await fetch(
      `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // In the header rather than the query string: a key in a URL ends
          // up in logs, proxies and error messages.
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: ask.system }] },
          contents: [{ role: "user", parts: [{ text: ask.user }] }],
          generationConfig: {
            temperature: ask.temperature ?? 0.25,
            // See GEMINI_MIN_TOKENS: thinking is spent from this budget.
            maxOutputTokens: Math.max(ask.maxTokens ?? 4000, GEMINI_MIN_TOKENS),
            ...(ask.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(45_000),
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Gemini error:", model, res.status, detail.slice(0, 500));
      return classifyFailure(res.status, detail, "gemini");
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      // Same meaning as Groq's empty generation: it answered with nothing,
      // which a different model may not.
      console.error("Gemini returned an empty generation:", model);
      return classifyFailure(0, "empty generation", "gemini");
    }
    return { ok: true, text, model, provider: "gemini" };
  } catch (err) {
    console.error("Gemini request failed:", model, err);
    return {
      retry: true,
      otherProvider: true,
      status: 502,
      error: "Couldn't reach the AI service — check the connection and try again",
    };
  }
}
