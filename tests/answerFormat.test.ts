import { describe, expect, it } from "vitest";
import { segments, shapeAnswer } from "../lib/answerFormat";

/** What the figures in a shaped answer actually came out as. */
const figures = (text: string) =>
  segments(text)
    .filter((s) => s.number)
    .map((s) => s.text);

describe("shapeAnswer", () => {
  it("lifts the opening sentence out as the answer", () => {
    const { lead, body } = shapeAnswer(
      "Your sleep is the problem. It fell to 5h 20m a night from 7h 40m."
    );
    expect(lead).toBe("Your sleep is the problem.");
    expect(body).toEqual(["It fell to 5h 20m a night from 7h 40m."]);
  });

  it("does not cut a sentence in half at a decimal", () => {
    // "4.1" must not end the headline at "Your namaz averaged 4."
    const { lead } = shapeAnswer("Your namaz averaged 4.1 out of 5. That is down.");
    expect(lead).toBe("Your namaz averaged 4.1 out of 5.");
  });

  it("does not cut at a duration's full stop mid-figure", () => {
    const { lead } = shapeAnswer("You slept 5h 20m a night. Study followed it down.");
    expect(lead).toBe("You slept 5h 20m a night.");
  });

  it("keeps a one-sentence answer whole", () => {
    const only = "There is nothing in your data about grocery spending.";
    expect(shapeAnswer(only)).toEqual({ lead: only, body: [] });
  });

  it("splits the remainder on line breaks, not on every sentence", () => {
    const { body } = shapeAnswer("Yes. One. Two.\n\nA second paragraph.");
    expect(body).toEqual(["One. Two.", "A second paragraph."]);
  });

  it("treats a single line break as a paragraph too", () => {
    // Groq writes a sentence per line as often as it writes paragraphs, and
    // both mean the same thing: a new thought.
    const { lead, body } = shapeAnswer(
      "Yes, your sleep is the reason.\nSleep fell to 5h 20m.\nStudy followed it down."
    );
    expect(lead).toBe("Yes, your sleep is the reason.");
    expect(body).toEqual(["Sleep fell to 5h 20m.", "Study followed it down."]);
  });

  it("survives an answer with no punctuation at all", () => {
    expect(shapeAnswer("no data on that")).toEqual({
      lead: "no data on that",
      body: [],
    });
  });

  it("has nothing to say about nothing", () => {
    expect(shapeAnswer("   ")).toEqual({ lead: "", body: [] });
  });
});

describe("segments", () => {
  it("finds a plain number", () => {
    expect(figures("Your score is 46 today")).toEqual(["46"]);
  });

  it("keeps a duration together instead of splitting it in two", () => {
    // "5h" highlighted and "20m" left grey is worse than no highlighting.
    expect(figures("You slept 5h 20m a night")).toEqual(["5h 20m"]);
  });

  it("takes the unit with the number", () => {
    expect(figures("down 30% on the week")).toEqual(["30%"]);
    expect(figures("in bed at 2:10 am")).toEqual(["2:10 am"]);
  });

  it("reads a ratio as one figure", () => {
    expect(figures("logged 14/14 days")).toEqual(["14/14"]);
    expect(figures("namaz at 4.1/5")).toEqual(["4.1/5"]);
  });

  it("finds every figure in a real answer", () => {
    expect(
      figures(
        "Your sleep fell from 7h 40m a day to 5h 20m a day, a 30% drop, while study fell from 28h to 9h 55m."
      )
    ).toEqual(["7h 40m", "5h 20m", "30%", "28h", "9h 55m"]);
  });

  it("puts the text back together exactly as it came", () => {
    // The whole contract: this decides what is large, never what is said.
    const text =
      "You slept 5h 20m a night, against 7h 40m the week before — a 30% drop.";
    expect(segments(text).map((s) => s.text).join("")).toBe(text);
  });

  it("leaves prose with no figures in one piece", () => {
    const text = "That question isn't about your data.";
    expect(segments(text)).toEqual([{ text, number: false }]);
  });
});

describe("what is not a figure", () => {
  it("leaves a day of the month alone", () => {
    // "since Monday 17 Aug" — lighting up the 17 tells the reader nothing
    // and costs the real numbers around it some of their weight.
    expect(figures("no goals met since Monday 17 Aug")).toEqual([]);
  });

  it("still reads the numbers in a sentence that also carries a date", () => {
    expect(figures("On 17 Aug the score fell to 46")).toEqual(["46"]);
  });

  it("puts a sentence with a date back together exactly", () => {
    const text = "You've met no goals since Monday 17 Aug, and the score is 46.";
    expect(segments(text).map((s) => s.text).join("")).toBe(text);
  });
});
