/**
 * Making an AI answer readable at a glance.
 *
 * The question box gets back two to five sentences of prose, and prose is the
 * right thing for it to get back — a question deserves an answer, not a
 * dashboard. But a wall of it is exactly the problem the owner named in the
 * first place: plenty of words, and you still have to read all of them to
 * find the one that answers you.
 *
 * So the shape is recovered rather than requested. The prompt already
 * promises the answer comes first ("start with the answer, then the numbers
 * it rests on"), which means the opening sentence *is* the verdict and can
 * be set like one. And the figures are found in the text rather than asked
 * for as a separate field — they are already there, already copied from the
 * app's own numbers, and asking the model to list them again would be one
 * more thing for it to get wrong.
 *
 * Nothing here changes a single character of what was written. It only
 * decides what gets to be large.
 */

/** The lead sentence, and whatever follows it, as paragraphs. */
export type ShapedAnswer = {
  /** The opening sentence — the answer itself. Never empty. */
  lead: string;
  /** The rest, split on line breaks. Empty when the answer was one sentence. */
  body: string[];
};

/**
 * Sentence ends that aren't. A full stop inside "5h 20m." is the end of a
 * sentence; one inside "a.m." or "4.1" is not, and splitting there would
 * hand the card half a number as its headline.
 */
const SENTENCE_END = /(?<![A-Z])(?<!\ba\.m)(?<!\bp\.m)(?<!\d)[.!?]+(?=\s)|[.!?]+(?=\s+[A-Z“"])/;

export function shapeAnswer(raw: string): ShapedAnswer {
  const text = raw.trim();
  if (!text) return { lead: "", body: [] };

  const match = SENTENCE_END.exec(text);
  // One sentence, or no punctuation to trust: the whole thing is the lead.
  if (!match || match.index + match[0].length >= text.length) {
    return { lead: text, body: [] };
  }

  const cut = match.index + match[0].length;
  const lead = text.slice(0, cut).trim();
  const rest = text.slice(cut).trim();

  return {
    lead,
    // Any line break, not just a blank one: the model writes a sentence per
    // line as often as it writes a paragraph, and both mean "a new thought".
    body: rest ? rest.split(/\n+/).map((p) => p.trim()).filter(Boolean) : [],
  };
}

export type Segment = { text: string; number: boolean };

/**
 * A figure, as it is actually written in these answers: "5h 20m", "7h 40m a
 * day", "30%", "14/14", "2:10 am", "4.1/5". Deliberately greedy about
 * trailing units and about the second half of a duration, because "5h" alone
 * highlighted and "20m" left grey is worse than not highlighting at all.
 */
const FIGURE =
  /\d+(?:[.,:]\d+)*\s*(?:%|hrs?|hours?|mins?|minutes?|h|m|am|pm)?(?:\s*\/\s*\d+)?/gi;

/** Whether two matches are close enough to be one figure ("5h" + " 20m"). */
const JOINABLE = /^\s?$/;

/**
 * A day of the month is not a figure. "since Monday 17 Aug" would otherwise
 * light up the 17, which tells the reader nothing and costs the real numbers
 * around it some of their weight.
 */
const DATE_TAIL = /^\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

/**
 * Split text into what is a number and what isn't, so a renderer can set the
 * figures apart without the writer having marked them up. Adjacent runs are
 * merged: "5h 20m" is one figure, not two.
 */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;

  for (const match of text.matchAll(FIGURE)) {
    const start = match.index;
    const value = match[0].trimEnd();
    if (!value) continue;

    // A bare 1-2 digit number followed by a month is a date, not a measure.
    if (/^\d{1,2}$/.test(value) && DATE_TAIL.test(text.slice(start + value.length))) {
      continue;
    }

    const gap = text.slice(at, start);
    const last = out[out.length - 1];

    if (last?.number && JOINABLE.test(gap)) {
      // "5h" and "20m" arrived as two matches and are one figure.
      last.text += gap + value;
    } else {
      if (gap) out.push({ text: gap, number: false });
      out.push({ text: value, number: true });
    }
    at = start + value.length;
  }

  const tail = text.slice(at);
  if (tail) out.push({ text: tail, number: false });
  return out;
}
