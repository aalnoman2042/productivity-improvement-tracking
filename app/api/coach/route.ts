import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { aiBudget, hit, tooMany } from "@/lib/rateLimit";
import { isValidDateStr } from "@/lib/dates";
import { gatherCoachFacts } from "@/lib/coachGather";
import { askGroq, groqConfigured, GROQ_SETUP_ERROR } from "@/lib/groq";
import { COACH_COOLDOWN_MS, parseReview, type CoachSnapshot } from "@/lib/coach";

/**
 * The AI coach: "what does my life actually look like right now?"
 *
 * On demand only — POST gathers the numbers (report card, last two weeks
 * day by day, challenges), hands them to a free LLM (Groq) with a strict
 * "judge only what's in the data" brief, and stores the answer. GET returns
 * the last stored answer, so reading costs nothing and works offline.
 *
 * Only numbers and tracker names leave the server — no notes, no email.
 */

const SYSTEM = `You are a sharp, warm personal coach reading one person's life-tracking data. They are looking at a lot of numbers and cannot tell what any of it MEANS. Your whole job is to turn the data into a decision. Someone should know how they are doing, and what to do tonight, in ten seconds of reading you.

WHAT YOU ARE GIVEN (JSON)
- rightNow: the latest day score (0-100), the last 7 days' average against the 7 before it, and "momentum" — which way that moved.
- allTime: the report card — overall grade, graded subjects, logging history.
- last14Days: every day in the window with its score, goals met, trackers logged and sleep.
- trackers: each one with its goal, its grade, the last 7 days against the 7 before, and "readsAs" — whether that change is better or worse FOR THIS HABIT. Sleep trackers also carry average bedtime and wake time; clean-streak trackers carry the streak.
- challenges: any challenge under way.

ACCURACY RULES — these outrank style
1. Every number you write must appear in the JSON exactly as it is printed there. Do not calculate, estimate, re-round, convert units, subtract one number from another, or claim a habit is worth so many points of the score.
2. If a fact is not in the JSON, it does not exist. Never mention mood, energy, work, people, or anything untracked.
3. Name trackers exactly as they are named in the data.
4. "habit":"bad" means less is better. When judging a change, trust "readsAs" over your own instinct.
5. Never contradict "momentum" or a grade — those are computed, not opinions.
6. If few days are logged, that IS the headline finding: say so plainly and keep everything else short. An empty list beats an invented point.
7. Reporting a number and setting a target are different jobs. Numbers you report are copied exactly. A target is a number to aim at, so it must be BETTER than where they are now — never hand back their current average as the thing to reach for. "You're in bed at 12:45 am, so get there by 11:30" is right; "get to bed by 12:45" is not.

DECIDE, DON'T DESCRIBE — this is what the reader is here for
8. Every point must carry a judgement or a consequence, not just a figure. "Sleep averaged 5h 30m" is a reading; "5h 30m a night is why your afternoons are collapsing" is a point. If a sentence would still be true of someone doing well, rewrite it.
9. Pick ONE thing to fix. Not a list, not "focus on sleep and study and prayer" — one, and say plainly why it is first, in terms of what it drags down with it.
10. "tonight" is an instruction a tired person can obey without thinking: an action, a number and a time. "Phone on the shelf at 11:30, lights off by midnight" — not "try to improve your sleep hygiene".
11. Each move in "week" must be checkable at the end of the week: a tracker, a number, and how many days. "Study 2h on 4 of the next 5 days" — not "study more consistently".
12. When the data genuinely doesn't say what is causing what, say the honest version — "these two move together; whether one causes the other, this data can't say" — and never dress a guess as a finding.

HOW TO WRITE
Second person. Short, plain sentences a tired person gets in one pass. No jargon, no corporate tone, no flattery, no hedging, no therapy-speak. Every point names the tracker it is about and stands on a number. Say what is causing what, not just what the numbers are — the score is the symptom, the habit is the story.

Talk about the person's life, not the app: "your sleep", never "the sleep tracker". Never print a JSON field name — not in the evidence, not anywhere.

Evidence is a plain-English phrase, never a dump of the data: "5h 30m a night, against 7h 30m the week before" — not "last7Days:5h 30m, change:down 27%". Never print a field name from the JSON.

The headline is a sentence with a verb, not a label. "Two strong weeks undone by a 2 am bedtime" is a headline; "Sleep is slipping" is a label — never write one of those. The 0-100 number is called the day score, nothing else.

Respond with ONLY this JSON object:
{
  "state": "one word, exactly one of: thriving | steady | slipping | stalled. thriving = clearly improving and hitting goals. steady = holding, no real movement. slipping = going backwards on something that matters. stalled = barely logging, too little to judge.",
  "headline": "one sentence of 8 to 14 words naming the thing driving all this - the story, not the score",
  "verdict": "2-3 sentences. Open with the answer to 'how am I doing?' in plain words, then what is driving it. No preamble, no restating the score.",
  "working": [{"point": "what is genuinely going well, one short sentence", "evidence": "the numbers in plain English, copied exactly - like '5h 20m a night, against 7h 40m the week before'. NEVER a JSON field name, never a quoted key, never a colon-value pair, never braces"}],
  "slipping": [{"point": "what is slipping and what it is costing them, one short sentence", "evidence": "the numbers in plain English, copied exactly - like '5h 20m a night, against 7h 40m the week before'. NEVER a JSON field name, never a quoted key, never a colon-value pair, never braces"}],
  "fix": {"what": "the ONE thing to fix first and why it is first", "tonight": "one concrete step for tonight, with a time or a number in it, under 15 words"},
  "week": ["2-3 moves for the rest of the week; each names a tracker, a number and how many days"]
}
2-3 items each in "working" and "slipping", fewer when the data is thin. No markdown, no emoji, no headings.`;

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const d = await db();
  const doc = await d
    .collection("aiReviews")
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();
  return NextResponse.json(
    doc
      ? {
          // Structured when the stored text parses as a review; older
          // plain-text rows come through as `text` and render as prose.
          review: parseReview(String(doc.text)),
          text: String(doc.text),
          // Reviews written before the snapshot existed simply don't have
          // one, and the card drops the numbers strip rather than guessing.
          snapshot: (doc.snapshot as CoachSnapshot | undefined) ?? null,
          today: doc.today ?? null,
          createdAt: doc.createdAt,
        }
      : null
  );
}

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

  // Backstop against hammering the endpoint — the real gate is below.
  const verdict = await hit("coach", String(userId));
  if (!verdict.ok) return tooMany(verdict, "analyses");

  const d = await dbReady();

  // One analysis per 8 hours, measured from the last one that *succeeded* —
  // a failed AI call doesn't burn the slot.
  const last = await d
    .collection("aiReviews")
    .find({ userId }, { projection: { createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();
  if (last?.createdAt instanceof Date) {
    const wait = last.createdAt.getTime() + COACH_COOLDOWN_MS - Date.now();
    if (wait > 0) {
      const h = Math.floor(wait / 3_600_000);
      const m = Math.ceil((wait % 3_600_000) / 60_000);
      return NextResponse.json(
        {
          error: `The coach reads your life once every 8 hours — next analysis in ${h > 0 ? `${h}h ` : ""}${m}m`,
          retryAfter: Math.ceil(wait / 1000),
        },
        { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } }
      );
    }
  }

  const gathered = await gatherCoachFacts(d, userId, today);
  if (!gathered) {
    return NextResponse.json(
      { error: "Nothing logged yet — there's no life on record to analyze" },
      { status: 400 }
    );
  }
  const { facts, snapshot } = gathered;

  // The app's own share of the free tier for the day — one key, one budget,
  // however many accounts are asking. Counted here, at the last moment
  // before the model is called, so a read the cooldown was going to refuse
  // never spends anybody's allowance.
  const budget = await aiBudget();
  if (budget) return budget;

  // Once every eight hours is a budget that can afford to think. The effort
  // is what turns "sleep is down 27%" into "this is why the afternoons are
  // going", which is the whole reason anyone opens the card.
  const answer = await askGroq({
    system: SYSTEM,
    user: JSON.stringify(facts),
    json: true,
    reasoningEffort: "medium",
  });
  if (!answer.ok) {
    return NextResponse.json({ error: answer.error }, { status: answer.status });
  }

  const review = parseReview(answer.text);
  if (!review) {
    return NextResponse.json(
      { error: "The AI answer came back malformed — try again" },
      { status: 502 }
    );
  }

  const createdAt = new Date();
  // The snapshot is stored beside the review so a later GET shows the same
  // numbers this read was written against, not today's recomputed ones.
  await d.collection("aiReviews").insertOne({
    userId,
    text: answer.text.slice(0, 10000),
    snapshot,
    today,
    model: answer.model,
    createdAt,
  });

  return NextResponse.json(
    { review, text: answer.text, snapshot, today, createdAt },
    { status: 201 }
  );
}
