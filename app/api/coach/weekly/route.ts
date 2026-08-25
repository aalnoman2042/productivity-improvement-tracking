import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { aiBudget, hit, tooMany } from "@/lib/rateLimit";
import { isValidDateStr } from "@/lib/dates";
import { gatherCoachFacts } from "@/lib/coachGather";
import { askGroq, groqConfigured, GROQ_SETUP_ERROR } from "@/lib/groq";
import { parseReview, type CoachSnapshot } from "@/lib/coach";
import { buildDigest } from "@/lib/digest";
import {
  isComplete,
  lastCompleteWeek,
  weekOf,
  weekTitle,
  type Week,
} from "@/lib/weeklyReview";

/**
 * The week in review, written once and kept.
 *
 * The daily coach is a snapshot — the next read overwrites it, so the app
 * has never been able to tell anyone what it made of them in June. This is
 * the memory: one review per finished week, stored for good, listed newest
 * first. Forty of them is a year you can read back.
 *
 * GET lists what has been written and which week is waiting. POST writes one
 * — for the last complete week by default, or any finished week asked for by
 * its Sunday. Generation is manual on purpose: an AI call that fires without
 * anyone asking is a bill and a surprise, and the free quota is small.
 */

const SYSTEM = `You are writing one person's week in review, from their own life-tracking data. It will be saved and read again months from now, so it must still make sense on its own: this is a record, not a notification.

WHAT YOU ARE GIVEN (JSON)
- week: the Monday-to-Sunday dates this review covers, and plain lines the app already computed about it.
- data.rightNow: the day score at the end of the week, the last 7 days' average against the 7 before, and "momentum".
- data.allTime: the report card — overall grade, graded subjects, logging history.
- data.last14Days: this week day by day, and the week before it, with scores, goals met and sleep.
- data.trackers: each with its goal, grade, this week against the week before, and "readsAs" — whether that change is better or worse FOR THIS HABIT.
- data.challenges: any challenge under way.

ACCURACY RULES — these outrank style
1. Every number you write must appear in the JSON exactly as printed there. Never calculate, estimate, re-round, convert units or subtract one number from another.
2. If a fact is not in the JSON, it does not exist. Never mention mood, energy, work, people, or anything untracked.
3. Name trackers exactly as they are named.
4. "habit":"bad" means less is better. Trust "readsAs" over instinct.
5. Never contradict "momentum" or a grade — those are computed, not opinions.
6. If the week was barely logged, that IS the review. Say it in one line and stop; a summary of nothing is worse than nothing.
7. A target must be BETTER than where they are now — never hand back their current average as the thing to aim for.

WHAT MAKES THIS A WEEK AND NOT A DAY
8. Judge the week as a whole against the week before it. The story is the direction, not any single day.
9. Name the turn if there was one — the day it changed, and what changed with it — but only if the daily numbers actually show it.
10. Write it so it reads well in six months. "The week the 2 am bedtimes started" is a record; "keep up the good work" is filler.

Respond with ONLY this JSON object:
{
  "state": "one word, exactly one of: thriving | steady | slipping | stalled",
  "headline": "one sentence of 8 to 14 words naming what this week was about",
  "verdict": "3-4 sentences: what this week was, how it compares to the week before, and what drove it",
  "working": [{"point": "what held up this week, one short sentence", "evidence": "the numbers in plain English, copied exactly - like '5h 20m a night, against 7h 40m the week before'. NEVER a JSON field name, never a quoted key, never a colon-value pair, never braces"}],
  "slipping": [{"point": "what gave way this week and what it cost", "evidence": "the numbers in plain English, copied exactly - like '5h 20m a night, against 7h 40m the week before'. NEVER a JSON field name, never a quoted key, never a colon-value pair, never braces"}],
  "fix": {"what": "the ONE thing to carry into next week, and why it is first", "tonight": "the first concrete step, with a number or a time in it, under 15 words"},
  "week": ["2-3 moves for the coming week; each names a tracker, a number and how many days"]
}
2-3 items each in "working" and "slipping", fewer when the week is thin. Second person, plain sentences. No markdown, no emoji, no headings.`;

type Row = {
  weekStart: string;
  weekEnd: string;
  text: string;
  snapshot?: CoachSnapshot | null;
  digest?: string[] | null;
  createdAt: Date;
};

const shape = (r: Row) => ({
  week: { start: r.weekStart, end: r.weekEnd },
  title: weekTitle({ start: r.weekStart, end: r.weekEnd }),
  review: parseReview(String(r.text)),
  text: String(r.text),
  snapshot: r.snapshot ?? null,
  digest: r.digest ?? null,
  createdAt: r.createdAt,
});

/** Everything written so far, and the week that is waiting to be. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The client's own date: "which week is over" is a question about the
  // reader's clock, not the server's.
  const today = new URL(req.url).searchParams.get("today");
  const d = await db();

  const rows = (await d
    .collection("weeklyReviews")
    .find({ userId })
    .sort({ weekEnd: -1 })
    .limit(52)
    .toArray()) as unknown as Row[];

  const reviews = rows.map(shape);

  let pending: { start: string; end: string; title: string } | null = null;
  if (isValidDateStr(today)) {
    const week = lastCompleteWeek(today);
    const written = new Set(rows.map((r) => r.weekEnd));
    if (!written.has(week.end)) {
      pending = { ...week, title: weekTitle(week) };
    }
  }

  return NextResponse.json({ reviews, pending });
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

  // Any finished week can be asked for by a date inside it; the default is
  // the one that just ended.
  const week: Week = isValidDateStr(body?.weekOf)
    ? weekOf(body.weekOf)
    : lastCompleteWeek(today);
  if (!isComplete(week, today)) {
    return NextResponse.json(
      { error: "That week isn't over yet — a week is reviewed once it has been lived" },
      { status: 400 }
    );
  }

  const verdict = await hit("weekly", String(userId));
  if (!verdict.ok) return tooMany(verdict, "weekly reviews");

  const d = await dbReady();

  // One review per week, for good. Rewriting it would quietly change what
  // the record says about a week nobody can live again.
  const existing = (await d
    .collection("weeklyReviews")
    .findOne({ userId, weekEnd: week.end })) as unknown as Row | null;
  if (existing) {
    return NextResponse.json({ ...shape(existing), already: true });
  }

  // The app's own share of the free tier for the day — one key, one budget,
  // however many accounts are asking. Counted at the last moment before the
  // model is called, so a request something else was about to refuse never
  // spends anybody's allowance.
  const budget = await aiBudget();
  if (budget) return budget;

  // The facts as of the week's last day — so `last7Days` IS the week under
  // review and `the 7 before` is the week before it, which is exactly the
  // comparison a weekly review is.
  const gathered = await gatherCoachFacts(d, userId, week.end);
  if (!gathered) {
    return NextResponse.json(
      { error: "Nothing logged yet — there's no week on record to review" },
      { status: 400 }
    );
  }

  // The same plain lines the Sunday push is built from: sleep, prayers and
  // streaks said the way a friend would say them.
  const digest = await buildDigest(d, userId, week.end);
  if (!digest) {
    return NextResponse.json(
      { error: "Nothing was logged that week — there's nothing to review" },
      { status: 400 }
    );
  }
  // The digest falls back to a line telling a phone where to tap when it has
  // no findings. That is a notification's job, not a fact about the week, so
  // it is dropped rather than handed to the model as evidence.
  const digestLines = digest.body
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("Tap to see"));

  const answer = await askGroq({
    system: SYSTEM,
    user: JSON.stringify({
      week: { start: week.start, end: week.end, lines: digestLines },
      data: gathered.facts,
    }),
    json: true,
    // Once a week, and kept for good — this is the read worth thinking about.
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

  const row: Row = {
    weekStart: week.start,
    weekEnd: week.end,
    text: answer.text.slice(0, 10000),
    snapshot: gathered.snapshot,
    digest: digestLines,
    createdAt: new Date(),
  };

  try {
    await d.collection("weeklyReviews").insertOne({ userId, ...row, model: answer.model });
  } catch (err) {
    // Two devices asking at once: the unique index decides, and the loser
    // reads back the winner rather than reporting a failure that isn't one.
    const dup = (err as { code?: number })?.code === 11000;
    if (!dup) throw err;
    const won = (await d
      .collection("weeklyReviews")
      .findOne({ userId, weekEnd: week.end })) as unknown as Row;
    return NextResponse.json({ ...shape(won), already: true });
  }

  return NextResponse.json(shape(row), { status: 201 });
}
