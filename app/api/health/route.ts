import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { db } from "@/lib/db";
import { currentHealthUserId } from "@/lib/access";
import { addDays, isValidDateStr } from "@/lib/dates";
import { buildReport, coverageOf, parseProfile, type CheckInput } from "@/lib/cortisol";
import {
  checkDue,
  isComplete,
  monthOfDate,
  morningFactor,
  scoreCheck,
  type Answers,
} from "@/lib/cortisolCheck";
import {
  balanceOf,
  domainsOf,
  levelTrendWithSleep,
  summarize,
  timingsOf,
} from "@/lib/health";
import {
  foldDays,
  neededTrackerIds,
  sourcesFromRoles,
  toCortisolDays,
  type EntryRow,
} from "@/lib/healthDays";
import { predict } from "@/lib/healthRisk";
import { tipsFor } from "@/lib/healthTips";
import { loadRoleState } from "@/lib/roleStore";
import { missingRoles, roleCoverage } from "@/lib/trackerRoles";

/**
 * The health read.
 *
 * Gated to invited members while it is tested (`currentHealthUserId`), and
 * reading **the signed-in account's own days and only its own** whether it is
 * gated or not — there is no version of this route that can be pointed at
 * somebody else, which is the promise every data route here makes.
 *
 * The shape of the work, in order:
 *
 * 1. Find out what each tracker *means* (`lib/roleStore`) — rules, then the
 *    AI's stored answer, then anything the reader has overridden.
 * 2. Fetch one window of entries for the trackers that fill a role, and fold
 *    them into days (`lib/healthDays`).
 * 3. Run the arithmetic: metrics, domains, the cortisol curve, the
 *    predictions, the tips (`lib/health`, `lib/healthRisk`, `lib/healthTips`).
 *
 * **No number returned from here is written by an AI.** The model's entire
 * involvement was step 1, deciding that the tracker called "Baje khabar" is
 * junk food; everything after that is arithmetic in `lib/` where it is
 * tested. That separation is the whole design.
 *
 * The **monthly check-up** is read whole or not at all. A partly-filled sheet
 * scores perfectly well, which is exactly the problem — it makes one month
 * incomparable with the next — so an incomplete one is treated as one owed,
 * and the log-derived half of the page carries on without it.
 *
 * GET `?today=YYYY-MM-DD&days=14`.
 */

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
const MIN_DAYS = 7;

export async function GET(req: Request) {
  const userId = await currentHealthUserId();
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
  const [state, user, checkDoc] = await Promise.all([
    loadRoleState(d, userId),
    d.collection("users").findOne({ _id: userId }, { projection: { cortisol: 1 } }),
    // The newest check-up, whichever month it belongs to. An older one still
    // says more than nothing — the page reports its month so nobody reads a
    // February answer as a September one.
    d
      .collection("cortisolChecks")
      .find({ userId }, { projection: { month: 1, answers: 1, _id: 0 } })
      .sort({ month: -1 })
      .limit(1)
      .next(),
  ]);

  const map = state.map;
  const profile = parseProfile(user?.cortisol);

  // All of it or none of it — see the note above and `lib/cortisolCheck`.
  const rawAnswers = (checkDoc?.answers ?? null) as Answers | null;
  const complete = rawAnswers !== null && isComplete(rawAnswers);
  const answers = complete ? rawAnswers : null;

  let check: CheckInput = null;
  if (checkDoc && answers) {
    const scored = scoreCheck(answers);
    check = {
      month: String(checkDoc.month),
      score: scored.score,
      pressure: scored.pressure,
      morning: morningFactor(answers),
      confident: scored.confident,
    };
  }

  const wanted = neededTrackerIds(map);
  const rows: EntryRow[] =
    wanted.length === 0
      ? []
      : (
          await d
            .collection("entries")
            .find(
              {
                userId,
                date: { $gte: from, $lte: today },
                trackerId: { $in: wanted.map((id) => new ObjectId(id)) },
              },
              { projection: { trackerId: 1, date: 1, value: 1, meta: 1, _id: 0 } }
            )
            .toArray()
        ).map((row) => ({
          trackerId: String(row.trackerId),
          date: String(row.date),
          value: Number(row.value) || 0,
          meta: (row.meta ?? null) as Record<string, unknown> | null,
        }));

  // The trackers go in as well as the rows: an entry carries a number and
  // nothing else, and whether that number is minutes or repetitions, pounds
  // or kilograms, a clean day or a slip is a property of the tracker.
  const healthDays = foldDays(rows, map, state.trackers);

  const cortisol = buildReport(
    toCortisolDays(healthDays),
    profile,
    sourcesFromRoles(map),
    check
  );
  const metrics = summarize(healthDays, answers, days);
  // Everything cortisol-derived waits for a complete check-up, and it waits
  // HERE rather than in the page. Filtering it out on the client alone would
  // leave the rhythm domain inside the balance average and inside
  // weakest/strongest — a headline computed partly from a card the reader
  // cannot see, which is exactly the unverifiable arithmetic this page
  // promises not to print.
  const shown = complete ? cortisol : null;
  const domains = domainsOf(metrics, shown);
  const balance = balanceOf(domains);
  const timings = timingsOf(metrics, shown);
  const { risks, forecasts } = predict(metrics, shown, answers);
  const tips = tipsFor({ m: metrics, cortisol, check: answers, risks, timings });

  return NextResponse.json({
    days,
    from,
    to: today,
    metrics,
    domains,
    balance,
    timings,
    // The level day by day with that night's sleep beside it — the trend the
    // single-day curve cannot show, and the reason the two are on one chart.
    levels: complete ? levelTrendWithSleep(cortisol, healthDays) : [],
    risks,
    forecasts,
    tips,
    cortisol,
    // Two different coverage numbers, kept apart because they answer two
    // different questions: how many *kinds* of input exist at all, and how
    // much of the cortisol model in particular is standing on real data.
    coverage: {
      roles: roleCoverage(map),
      missing: missingRoles(map).filter((r) => !r.quiet).slice(0, 5),
      cortisol: coverageOf(cortisol, days),
    },
    roles: {
      assignments: map.assignments,
      aiAt: map.aiAt,
      stale: state.stale,
      never: state.never,
    },
    check: {
      month: checkDoc ? String(checkDoc.month) : null,
      complete,
      due: checkDue(complete ? String(checkDoc?.month) : null, today),
      thisMonth: monthOfDate(today),
      score: check?.score ?? null,
      confident: check?.confident ?? true,
    },
  });
}
