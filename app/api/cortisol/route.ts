import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db, dbReady } from "@/lib/db";
import { currentCortisolUserId } from "@/lib/admin";
import { addDays, isValidDateStr } from "@/lib/dates";
import { napMinutes, type Nap } from "@/lib/draft";
import { clockToMinutes } from "@/lib/clock";
import { minutesBetween } from "@/lib/trackers";
import { toTracker } from "@/lib/trackerDoc";
import type { Tracker } from "@/lib/trackers";
import {
  buildReport,
  findSources,
  parseProfile,
  type CheckInput,
  type CortisolDay,
} from "@/lib/cortisol";
import {
  checkDue,
  isComplete,
  morningFactor,
  scoreCheck,
  type Answers,
} from "@/lib/cortisolCheck";

/**
 * The cortisol read.
 *
 * Gated while it is being tested (see `currentCortisolUserId`), and reading
 * **the signed-in account's own days and only its own** whether it is gated
 * or not — no version of this route can be pointed at somebody else, which
 * is the promise every other data route here makes too.
 *
 * All it does is fetch a window, reduce each day to the handful of numbers
 * `lib/cortisol` reads, and hand back what that computes. Not one figure on
 * the page is written by an AI; the model is arithmetic, and it lives in
 * `lib/` where it can be tested.
 *
 * GET `?today=YYYY-MM-DD&days=14` — the report.
 * PATCH `{age, sex, mood}` — the three things no tracker records.
 */

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MIN_DAYS = 7;

/** The night itself: the clock times when they are there, the value when not. */
function nightOf(value: number, meta: Record<string, unknown> | null, naps: number): number | null {
  const start = typeof meta?.start === "string" ? meta.start : null;
  const end = typeof meta?.end === "string" ? meta.end : null;
  if (start && end) return minutesBetween(start, end);
  // No clock times — the total is all there is, so take the naps back out
  // rather than counting an afternoon on the sofa as part of the night.
  const rest = value - naps;
  return rest > 0 ? rest : null;
}

export async function GET(req: Request) {
  const userId = await currentCortisolUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = new URL(req.url).searchParams;
  const today = params.get("today");
  if (!isValidDateStr(today)) {
    return NextResponse.json({ error: "today=YYYY-MM-DD required" }, { status: 400 });
  }
  const asked = Number(params.get("days"));
  const days = Number.isFinite(asked)
    ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(asked)))
    : DEFAULT_DAYS;
  const from = addDays(today, -(days - 1));

  const d = await db();
  const [trackerDocs, user, checkDoc] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d.collection("users").findOne({ _id: userId }, { projection: { cortisol: 1 } }),
    // The newest check-up, whichever month it belongs to. An older one still
    // says more than nothing — the page reports its date so nobody reads a
    // February answer as a September one.
    d
      .collection("cortisolChecks")
      .find({ userId }, { projection: { month: 1, answers: 1, _id: 0 } })
      .sort({ month: -1 })
      .limit(1)
      .next(),
  ]);

  const trackers = trackerDocs.map(toTracker) as Tracker[];
  const sources = findSources(trackers);
  const profile = parseProfile(user?.cortisol);

  let check: CheckInput = null;
  if (checkDoc) {
    const answers = (checkDoc.answers ?? {}) as Answers;
    // A sheet stored before a question was added is incomplete now, and the
    // page treats it as a check-up owed rather than as one done.
    const scored = isComplete(answers) ? scoreCheck(answers) : null;
    if (scored)
      check = {
        month: String(checkDoc.month),
        score: scored.score,
        pressure: scored.pressure,
        morning: morningFactor(answers),
        confident: scored.confident,
      };
  }
  const due = checkDue(check?.month ?? null, today);

  const wanted = [
    sources.sleepId,
    sources.dietId,
    sources.junkId,
    sources.moodId,
    ...sources.exerciseIds,
  ].filter((id): id is string => Boolean(id));

  if (wanted.length === 0) {
    return NextResponse.json({
      report: buildReport([], profile, sources, check),
      days,
      from,
      to: today,
      due,
    });
  }

  const rows = await d
    .collection("entries")
    .find(
      {
        userId,
        date: { $gte: from, $lte: today },
        trackerId: { $in: wanted.map((id) => new ObjectId(id)) },
      },
      { projection: { trackerId: 1, date: 1, value: 1, meta: 1, _id: 0 } }
    )
    .toArray();

  // One bucket per date that has anything at all on it. A day nobody logged
  // is left out rather than filled with zeroes — a blank Tuesday is not a
  // Tuesday with no sleep on it.
  const byDate = new Map<string, CortisolDay>();
  const blank = (date: string): CortisolDay => ({
    date,
    bed: null,
    wake: null,
    nightMinutes: null,
    napMinutes: 0,
    quality: null,
    diet: null,
    junk: null,
    exercise: null,
    mood: null,
  });

  for (const row of rows) {
    const date = String(row.date);
    const id = String(row.trackerId);
    const value = Number(row.value) || 0;
    const meta = (row.meta ?? null) as Record<string, unknown> | null;
    const day = byDate.get(date) ?? blank(date);

    if (id === sources.sleepId) {
      const naps = napMinutes((meta?.naps ?? null) as Nap[] | null);
      day.napMinutes = naps;
      day.nightMinutes = nightOf(value, meta, naps);
      day.bed = clockToMinutes(meta?.start);
      day.wake = clockToMinutes(meta?.end);
      const q = Number(meta?.quality);
      day.quality = Number.isFinite(q) && q >= 1 && q <= 5 ? q : null;
    } else if (id === sources.dietId) {
      day.diet = value > 0 ? value : null;
    } else if (id === sources.junkId) {
      day.junk = value;
    } else if (id === sources.moodId) {
      day.mood = value > 0 ? value : null;
    } else if (sources.exerciseIds.includes(id)) {
      // Several fitness trackers add up — a run and a gym session are one
      // day's movement, not two competing answers.
      day.exercise = (day.exercise ?? 0) + value;
    }

    byDate.set(date, day);
  }

  return NextResponse.json({
    report: buildReport([...byDate.values()], profile, sources, check),
    days,
    from,
    to: today,
    due,
  });
}

export async function PATCH(req: Request) {
  const userId = await currentCortisolUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const profile = parseProfile(body);

  const d = await dbReady();
  await d
    .collection("users")
    .updateOne(
      { _id: userId },
      { $set: { cortisol: { ...profile, updatedAt: new Date() } } }
    );

  return NextResponse.json({ ok: true, profile });
}
