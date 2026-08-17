import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { hit, tooMany } from "@/lib/rateLimit";
import { isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { buildReportCard } from "@/lib/report";
import type { Tracker } from "@/lib/trackers";
import {
  buildCoachFacts,
  type CoachChallengeRow,
  type CoachEntry,
} from "@/lib/coachFacts";
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

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-120b"

const SYSTEM = `You are a sharp, warm personal coach reading one person's life-tracking data. Someone should understand their own life in ten seconds of reading you.

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

HOW TO WRITE
Second person. Short, plain sentences a tired person gets in one pass. No jargon, no corporate tone, no flattery, no hedging, no therapy-speak. Every point names the tracker it is about and stands on a number. Say what is causing what, not just what the numbers are — the score is the symptom, the habit is the story.

Talk about the person's life, not the app: "your sleep", never "the sleep tracker". Never print a JSON field name — not in the evidence, not anywhere.

Evidence is a plain-English phrase, never a dump of the data: "5h 30m a night, against 7h 30m the week before" — not "last7Days:5h 30m, change:down 27%". Never print a field name from the JSON.

The headline is a sentence with a verb, not a label. "Two strong weeks undone by a 2 am bedtime" is a headline; "Sleep is slipping" is a label — never write one of those. The 0-100 number is called the day score, nothing else.

Respond with ONLY this JSON object:
{
  "headline": "one sentence of 8 to 14 words naming the thing driving all this - the story, not the score",
  "verdict": "2-3 sentences: what this life looks like right now, and what is driving it",
  "working": [{"point": "what is genuinely going well, one short sentence", "evidence": "the exact numbers, copied"}],
  "slipping": [{"point": "what is slipping and what it costs, one short sentence", "evidence": "the exact numbers, copied"}],
  "fix": {"what": "the ONE thing to fix first and why it is first", "tonight": "one concrete step for tonight, with a time or a number in it, under 15 words"},
  "week": ["2-3 moves for the rest of the week; each names a tracker and a number to aim at"]
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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI analysis isn't set up — add a free GROQ_API_KEY (console.groq.com) to the environment",
      },
      { status: 503 }
    );
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

  /* --------------------------- gather the facts -------------------------- */
  // `meta` comes along for the ride: bedtimes are the one thing the coach was
  // most often asked about and had no way of knowing.
  const [trackerDocs, entryDocs, challengeDocs] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, meta: 1, _id: 0 } }
      )
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker) as Tracker[];
  const entries: CoachEntry[] = entryDocs.map((e) => ({
    trackerId: String(e.trackerId),
    date: String(e.date),
    value: Number(e.value),
    meta: (e.meta as CoachEntry["meta"]) ?? null,
  }));
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Nothing logged yet — there's no life on record to analyze" },
      { status: 400 }
    );
  }

  const challengeRows: CoachChallengeRow[] = challengeDocs.map((c) => ({
    name: String(c.name),
    trackerId: String(c.trackerId),
    startDate: String(c.startDate),
    days: Number(c.days),
    target: c.target == null ? null : Number(c.target),
    direction: c.direction === "max" ? "max" : "min",
  }));

  const report = buildReportCard(trackers, entries, [], today);
  const { facts, snapshot } = buildCoachFacts(
    trackers,
    entries,
    challengeRows,
    report,
    today
  );

  /* ------------------------------ ask the AI ----------------------------- */


  

  let text = "";
  let model = process.env.GROQ_MODEL || DEFAULT_MODEL;
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
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(facts) },
        ],
        max_tokens: 4000,
        // Low: this is a reading of someone's real numbers, not a piece of
        // writing — invention is the only failure mode that matters here.
        temperature: 0.25,
      reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Groq error:", res.status, detail.slice(0, 500));
      return NextResponse.json(
        {
          error:
            res.status === 429
              ? "The free AI quota is catching its breath — try again in a minute"
              : "The AI service had trouble — try again shortly",
        },
        { status: 502 }
      );
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    text = (data.choices?.[0]?.message?.content ?? "").trim();
    model = data.model ?? model;
  } catch (err) {
    console.error("Groq request failed:", err);
    return NextResponse.json(
      { error: "Couldn't reach the AI service — check the connection and try again" },
      { status: 502 }
    );
  }
  const review = text ? parseReview(text) : null;
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
    text: text.slice(0, 10000),
    snapshot,
    today,
    model,
    createdAt,
  });

  return NextResponse.json(
    { review, text, snapshot, today, createdAt },
    { status: 201 }
  );
}
