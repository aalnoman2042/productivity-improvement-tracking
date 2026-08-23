import { describe, expect, it } from "vitest";
import { classifyFailure } from "../lib/groq";

/**
 * The fallback chain is only as good as this decision, and it is the one
 * part of talking to Groq that can be tested without a network.
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
