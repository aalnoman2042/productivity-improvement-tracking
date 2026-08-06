import { describe, expect, it } from "vitest";
import { parseReview } from "../lib/coach";

const good = {
  headline: "Strong habits, sabotaged nightly by a 2 am bedtime.",
  verdict: "You show up almost every day. The nights are the leak.",
  working: [
    { point: "Study is consistent", evidence: "3h 10m/day avg, 13 of 14 days" },
  ],
  slipping: [
    { point: "Bedtime is drifting", evidence: "2:05 am avg, 9 of 14 nights past 1 am" },
  ],
  fix: { what: "Bedtime before midnight", tonight: "Screens off at 11:15 pm." },
};

describe("parseReview", () => {
  it("accepts the shape the prompt asks for", () => {
    const r = parseReview(JSON.stringify(good));
    expect(r).not.toBeNull();
    expect(r!.headline).toContain("2 am");
    expect(r!.working).toHaveLength(1);
    expect(r!.fix.tonight).toContain("11:15");
  });

  it("rejects non-JSON and JSON that isn't a review", () => {
    expect(parseReview("Your life is fine. Sleep more.")).toBeNull();
    expect(parseReview(JSON.stringify({ headline: "hi" }))).toBeNull();
    expect(parseReview(JSON.stringify({ ...good, fix: { what: "x" } }))).toBeNull();
  });

  it("drops malformed points and caps the lists", () => {
    const r = parseReview(
      JSON.stringify({
        ...good,
        working: [
          { point: "a", evidence: "1" },
          { evidence: "no point — dropped" },
          { point: "b" }, // evidence optional
          { point: "c", evidence: "3" },
          { point: "d", evidence: "4" },
          { point: "e", evidence: "too many — capped" },
        ],
      })
    );
    expect(r!.working.map((p) => p.point)).toEqual(["a", "b", "c", "d"]);
    expect(r!.working[1].evidence).toBe("");
  });
});
