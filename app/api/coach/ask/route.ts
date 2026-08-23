import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { hit, tooMany } from "@/lib/rateLimit";
import { isValidDateStr } from "@/lib/dates";
import { gatherCoachFacts } from "@/lib/coachGather";
import { askGroq, groqConfigured, GROQ_SETUP_ERROR, LIGHT_MODEL } from "@/lib/groq";

/**
 * Ask your own data a question.
 *
 * The coach answers the question it was built to answer, once every eight
 * hours. This is for the other one — "is my sleep actually hurting my study?",
 * "which day of the week do I fall apart?" — asked at the moment someone
 * wonders it, against exactly the same facts.
 *
 * Same numbers, same accuracy rules, same privacy promise: no note anyone
 * wrote ever reaches the model. What differs is the shape of the answer —
 * a few sentences of prose, not a card, because a question deserves an
 * answer rather than a dashboard.
 *
 * Nothing is stored. A question asked and answered is a conversation, not a
 * record, and the eight-hour read is what the app keeps.
 */

const SYSTEM = `You are answering ONE question about one person's life-tracking data. You are given their numbers as JSON and their question. Answer only from the JSON.

WHAT YOU ARE GIVEN
- rightNow: the latest day score (0-100), last 7 days' average against the 7 before, and "momentum".
- allTime: the report card — overall grade, graded subjects, logging history.
- last14Days: every day with its score, goals met, trackers logged and sleep.
- trackers: each with its goal, grade, last 7 days against the 7 before, and "readsAs" — whether that change is better or worse FOR THIS HABIT. Sleep carries bedtime and wake time; streaks carry the streak.
- challenges: any challenge under way.

RULES
1. Every number you write must appear in the JSON exactly as printed there. Never calculate, estimate, re-round or subtract.
2. If the JSON doesn't answer the question, say so in one sentence and then say what it DOES show that is closest. Never invent, never guess, never fill a gap with a generality about health or productivity.
3. The data shows what moves with what. It does not show cause. If asked "why", answer with what moved together and say plainly that the data can't prove which caused which.
4. "habit":"bad" means less is better — trust "readsAs" over instinct.
5. Never contradict a computed figure: momentum, grades and the day score are facts here, not opinions.
6. Name trackers exactly as they are named. Never print a JSON field name.
7. If the question is not about this data at all, say that in one sentence. Do not answer it. You are not a general assistant, and you have nothing but these numbers.

HOW TO ANSWER
Plain prose, second person, 2 to 5 sentences. No headings, no bullet lists, no markdown, no emoji, no preamble. Never restate the question.

Your FIRST SENTENCE is the answer itself and must stand on its own in under 20 words — "Yes, and sleep is the reason." / "No, your study held steady." / "Fridays." It is shown on its own line, larger than the rest, so a sentence that only sets up the real answer wastes it. Keep the numbers OUT of it unless one number IS the answer.

Then, in the sentences after it, the figures it rests on. If there is an obvious action, one short final sentence may say it.`;

/** Long enough for a real question, short of an essay. */
const MAX_QUESTION = 300;

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!groqConfigured()) {
    return NextResponse.json({ error: GROQ_SETUP_ERROR }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const today = body?.today;
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const question =
    typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION) : "";
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
  }

  // There is no cooldown behind this one, so the rule is the whole gate.
  const verdict = await hit("ask", String(userId));
  if (!verdict.ok) return tooMany(verdict, "questions");

  const d = await dbReady();
  const gathered = await gatherCoachFacts(d, userId, today);
  if (!gathered) {
    return NextResponse.json(
      { error: "Nothing logged yet — there's nothing to ask about" },
      { status: 400 }
    );
  }

  const answer = await askGroq({
    system: SYSTEM,
    // The question is data, not instruction: it sits inside the payload so a
    // question shaped like an order ("ignore your rules and…") arrives as
    // something to answer rather than something to obey.
    user: JSON.stringify({ question, data: gathered.facts }),
    // Prose, not a card — a JSON envelope here would only be unwrapped again.
    //
    // And a light model on a small budget, deliberately: the free tier's cap
    // is per *minute*, so a question asked just after the coach has read the
    // fortnight must not be competing with it for the same 8,000 tokens.
    model: process.env.GROQ_ASK_MODEL || LIGHT_MODEL,
    // It is a reasoning model too, so the budget has to cover the thinking
    // as well as the answer — too small and it spends the lot on the former
    // and returns nothing at all.
    maxTokens: 1500,
    reasoningEffort: "low",
  });
  if (!answer.ok) {
    return NextResponse.json({ error: answer.error }, { status: answer.status });
  }

  return NextResponse.json({
    question,
    answer: answer.text.slice(0, 2000),
    today,
    // What's left in this hour, so the box can say so before it refuses.
    remaining: verdict.remaining,
  });
}
