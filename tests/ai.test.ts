import { describe, expect, it } from "vitest";
import { chooseProviders, classifyFailure } from "../lib/ai";

/**
 * The fallback chain is only as good as these two decisions, and they are the
 * parts of talking to a model that can be tested without a network: what a
 * failure means, and who gets asked in what order.
 */

describe("classifyFailure", () => {
  it("does NOT try another model when the quota is spent", () => {
    // Groq's free tier caps tokens per minute across the org, so a second
    // model asks the same exhausted budget. Retrying turns a one-minute
    // wait into two. Measured against the real API, not assumed.
    const attempt = classifyFailure(429, "Rate limit reached ... TPM: Limit 8000");
    expect(attempt.retry).toBe(false);
    expect(attempt.error).toMatch(/catching its breath/);
  });

  it("but DOES try the other provider on a spent quota", () => {
    // The whole reason a second provider exists: a cap belongs to one key,
    // and the other one has an allowance of its own. This is the case a
    // second model could never answer.
    expect(classifyFailure(429, "Rate limit reached").otherProvider).toBe(true);
  });

  it("lets a rejected key fall through to the other provider", () => {
    // One misconfigured key must not take the whole feature down.
    expect(classifyFailure(401, "invalid api key").otherProvider).toBe(true);
  });

  it("names the key of the provider that actually refused", () => {
    expect(classifyFailure(403, "denied", "gemini").error).toMatch(/GEMINI_API_KEY/);
    expect(classifyFailure(403, "denied", "groq").error).toMatch(/GROQ_API_KEY/);
  });

  it("recognises a withdrawn model in Google's wording too", () => {
    const attempt = classifyFailure(
      404,
      '{"error":{"status":"NOT_FOUND","message":"models/gemini-9 is not found"}}',
      "gemini"
    );
    expect(attempt.retry).toBe(true);
    expect(attempt.error).toMatch(/GEMINI_MODEL/);
  });

  it("does NOT try another model when the key is rejected", () => {
    for (const status of [401, 403]) {
      const attempt = classifyFailure(status, "invalid api key");
      expect(attempt.retry).toBe(false);
      expect(attempt.error).toMatch(/GROQ_API_KEY/);
    }
  });

  it("names a withdrawn model instead of saying 'try again shortly'", () => {
    // This exact failure has happened once: llama-3.3-70b-versatile was
    // removed from Groq entirely. "Try again shortly" is advice that can
    // never come true, and it cost an afternoon to see through.
    const attempt = classifyFailure(
      404,
      '{"error":{"message":"The model `llama-3.3-70b-versatile` does not exist","code":"model_not_found"}}'
    );
    expect(attempt.retry).toBe(true);
    expect(attempt.error).toMatch(/no longer exists/);
    expect(attempt.error).toMatch(/GROQ_MODEL/);
  });

  it("tries another model when this one couldn't produce the JSON", () => {
    // Seen for real from qwen3.6-27b on the coach prompt.
    const attempt = classifyFailure(
      400,
      '{"error":{"code":"json_validate_failed","failed_generation":""}}'
    );
    expect(attempt.retry).toBe(true);
  });

  it("tries another model when this one answered with nothing at all", () => {
    // A reasoning model that spends its whole budget thinking. Status 0 is
    // this codebase's stand-in for "answered, but with nothing".
    expect(classifyFailure(0, "empty generation").retry).toBe(true);
  });

  it("tries another model when the service itself stumbles", () => {
    for (const status of [500, 502, 503, 408]) {
      expect(classifyFailure(status, "").retry).toBe(true);
    }
  });

  it("gives up on a failure it doesn't recognise", () => {
    // A second model is a guess, and a guess that costs a whole extra
    // round trip is not worth making blind.
    expect(classifyFailure(418, "teapot").retry).toBe(false);
  });

  it("never leaks the provider's own words to the reader", () => {
    const raw = 'Rate limit reached for model `openai/gpt-oss-120b` in organization org_01kx';
    expect(classifyFailure(429, raw).error).not.toContain("org_01kx");
    expect(classifyFailure(429, raw).error).not.toContain("gpt-oss");
  });

  it("always answers with a status a route can return", () => {
    for (const status of [400, 401, 404, 429, 500, 418, 0]) {
      expect(classifyFailure(status, "").status).toBe(502);
    }
  });
});

describe("chooseProviders", () => {
  it("asks nobody when nothing is configured", () => {
    expect(chooseProviders({})).toEqual([]);
  });

  it("uses whichever key exists", () => {
    expect(chooseProviders({ groqKey: "g" })).toEqual(["groq"]);
    expect(chooseProviders({ geminiKey: "k" })).toEqual(["gemini"]);
  });

  it("puts Groq first by default — it is the one this app was measured on", () => {
    expect(chooseProviders({ groqKey: "g", geminiKey: "k" })).toEqual([
      "groq",
      "gemini",
    ]);
  });

  it("honours a stated preference without dropping the other", () => {
    // "Prefer" is not "only": a spent quota has to have somewhere to go.
    expect(
      chooseProviders({ groqKey: "g", geminiKey: "k", preferred: "gemini" })
    ).toEqual(["gemini", "groq"]);
  });

  it("ignores a preference for a provider with no key", () => {
    expect(chooseProviders({ groqKey: "g", preferred: "gemini" })).toEqual(["groq"]);
  });

  it("ignores a preference that isn't a provider", () => {
    expect(
      chooseProviders({ groqKey: "g", geminiKey: "k", preferred: "anthropic" })
    ).toEqual(["groq", "gemini"]);
  });
});
