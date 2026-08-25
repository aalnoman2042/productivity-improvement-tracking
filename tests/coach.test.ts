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
  week: ["Pull bedtime back 20 minutes a night.", "Log every day, even the bad ones."],
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

  it("keeps the week's moves, capped, and shrugs off a missing list", () => {
    const r = parseReview(JSON.stringify(good));
    expect(r!.week).toEqual([
      "Pull bedtime back 20 minutes a night.",
      "Log every day, even the bad ones.",
    ]);

    const capped = parseReview(
      JSON.stringify({ ...good, week: ["a", "b", "c", "d"] })
    );
    expect(capped!.week).toEqual(["a", "b", "c"]);

    // A review written before the field existed is still a good review.
    expect(parseReview(JSON.stringify({ ...good, week: undefined }))!.week)
      .toBeUndefined();
    expect(parseReview(JSON.stringify({ ...good, week: "not a list" }))!.week)
      .toBeUndefined();
  });
});

describe("evidence that leaked the data's own shape", () => {
  const base = {
    headline: "Late nights are eating the week",
    verdict: "Two good weeks undone by a 2 am bedtime.",
    fix: { what: "Sleep first", tonight: "Lights off by midnight" },
  };

  it("drops a JSON key pasted in where a phrase was asked for", () => {
    const review = parseReview(
      JSON.stringify({
        ...base,
        working: [{ point: "Clean streak held", evidence: '"currentCleanDays":14' }],
      })
    );
    expect(review?.working[0].point).toBe("Clean streak held");
    // The claim survives; the leak does not.
    expect(review?.working[0].evidence).toBe("");
  });

  it("keeps evidence that is an actual phrase", () => {
    const review = parseReview(
      JSON.stringify({
        ...base,
        slipping: [
          { point: "Sleep fell away", evidence: "5h 20m a night, against 7h 40m the week before" },
        ],
      })
    );
    expect(review?.slipping[0].evidence).toBe(
      "5h 20m a night, against 7h 40m the week before"
    );
  });

  it("keeps a plain time of day, which is not a leak", () => {
    const review = parseReview(
      JSON.stringify({
        ...base,
        slipping: [{ point: "Bedtime moved", evidence: "in bed at 2:10 am, seven nights of seven" }],
      })
    );
    expect(review?.slipping[0].evidence).toBe("in bed at 2:10 am, seven nights of seven");
  });
});

describe("the one-word state", () => {
  const base = {
    headline: "Late nights are eating the week",
    verdict: "Two good weeks undone by a 2 am bedtime.",
    fix: { what: "Sleep first", tonight: "Lights off by midnight" },
  };

  it("takes one of the four", () => {
    expect(parseReview(JSON.stringify({ ...base, state: "slipping" }))?.state).toBe(
      "slipping"
    );
  });

  it("drops anything else rather than showing a word with no meaning", () => {
    expect(parseReview(JSON.stringify({ ...base, state: "vibing" }))?.state).toBeUndefined();
    expect(parseReview(JSON.stringify(base))?.state).toBeUndefined();
  });
});

describe("a second provider's idea of the same JSON", () => {
  /**
   * Found by probing, not by reasoning: given the identical prompt, gpt-oss
   * returns `week` as strings and Gemini returns `[{"move": "..."}]`. Both
   * are defensible readings of "a list of moves", and the card must not go
   * empty because of which one answered.
   */
  it("unwraps a move that arrived inside an object", () => {
    const review = parseReview(
      JSON.stringify({
        headline: "Sleep is what's dragging the week",
        verdict: "Short nights, falling scores.",
        fix: { what: "Sleep", tonight: "Lights out by midnight" },
        week: [{ move: "Log Sleep on all of the next 5 days" }, { move: "Study 2h on 4 days" }],
      })
    );
    expect(review?.week).toEqual([
      "Log Sleep on all of the next 5 days",
      "Study 2h on 4 days",
    ]);
  });

  it("still takes plain strings, which is what the prompt asks for", () => {
    const review = parseReview(
      JSON.stringify({
        headline: "Steady week",
        verdict: "Holding.",
        fix: { what: "Nothing", tonight: "Sleep by 11" },
        week: ["Study 2h on 4 of the next 5 days"],
      })
    );
    expect(review?.week).toEqual(["Study 2h on 4 of the next 5 days"]);
  });
});
