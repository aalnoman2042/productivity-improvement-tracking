import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentCortisolUserId } from "@/lib/admin";
import { isValidDateStr } from "@/lib/dates";
import {
  cleanAnswers,
  checkDue,
  isComplete,
  missingFrom,
  monthOfDate,
  scoreCheck,
  type Answers,
} from "@/lib/cortisolCheck";

/**
 * The monthly check-up.
 *
 * One row per person per month, kept rather than overwritten — a check-up is
 * a dated fact and not a setting, so June's answers stay describing June and
 * next month gets its own row. Answering again inside the same month edits
 * that month's row, which is what a correction should do.
 *
 * GET `?today=YYYY-MM-DD` — this month's answers if they exist, the previous
 * month's to prefill from if they don't, and whether one is due.
 * POST `{today, answers}` — save this month's.
 *
 * Nothing the client sends is trusted: `cleanAnswers` drops unknown keys and
 * any answer that isn't one of the offered values, so the stored document can
 * only ever contain answers to questions this app actually asks.
 */

export async function GET(req: Request) {
  const userId = await currentCortisolUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const today = new URL(req.url).searchParams.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const month = monthOfDate(today);

  const d = await db();
  // The latest two, so "this month's" and "the one to prefill from" are one
  // query rather than two.
  const rows = await d
    .collection("cortisolChecks")
    .find({ userId }, { projection: { month: 1, answers: 1, updatedAt: 1, _id: 0 } })
    .sort({ month: -1 })
    .limit(2)
    .toArray();

  const current = rows.find((r) => r.month === month) ?? null;
  const previous = rows.find((r) => r.month !== month) ?? null;
  const lastMonth = rows[0] ? String(rows[0].month) : null;

  const answers = (current?.answers ?? {}) as Answers;
  // Only a complete sheet counts as this month being done.
  const done = current !== null && isComplete(answers);

  return NextResponse.json({
    month,
    due: !done || checkDue(lastMonth, today),
    complete: done,
    // What to fill the form in with: this month's if it exists, otherwise
    // last month's, because most of these answers barely move and retyping
    // thirty of them is how a monthly check-up becomes a never check-up.
    answers: current ? answers : ((previous?.answers ?? {}) as Answers),
    prefilledFrom: current ? null : previous ? String(previous.month) : null,
    answeredAt: current?.updatedAt ?? null,
    result: current ? scoreCheck(answers) : null,
  });
}

export async function POST(req: Request) {
  const userId = await currentCortisolUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const today = body?.today;
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }

  const answers = cleanAnswers(body?.answers);
  // All of it or none of it. A partly-filled sheet scores perfectly well and
  // that is the problem: it makes one month incomparable with the next, and
  // with anybody else's. The refusal lives here as well as in the form,
  // because the form is not the only thing that can post.
  if (!isComplete(answers)) {
    const missing = missingFrom(answers);
    return NextResponse.json(
      {
        error: `Every question has to be answered — ${missing.length} still ${
          missing.length === 1 ? "is" : "are"
        } blank`,
        missing: missing.map((q) => q.id),
      },
      { status: 400 }
    );
  }
  const result = scoreCheck(answers);

  const month = monthOfDate(today);
  const now = new Date();
  const d = await dbReady();
  await d.collection("cortisolChecks").updateOne(
    { userId, month },
    {
      $set: { answers, score: result.score, updatedAt: now },
      $setOnInsert: { userId, month, createdAt: now },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, month, answers, result });
}
