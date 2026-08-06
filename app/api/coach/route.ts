import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { hit, tooMany } from "@/lib/rateLimit";
import { addDays, formatMinutes, isValidDateStr } from "@/lib/dates";
import { toTracker } from "@/lib/trackerDoc";
import { dayFactsFrom, dayScore } from "@/lib/score";
import { gradeLetter, buildReportCard, type ReportEntry } from "@/lib/report";
import { categoryMeta, formatValue, typeMeta, type Tracker, type TrackerType } from "@/lib/trackers";
import { challengeProgress } from "@/lib/challenges";
import { COACH_COOLDOWN_MS, parseReview } from "@/lib/coach";

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
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const SYSTEM = `You are a blunt but kind personal coach. You are given a person's life-tracking data as JSON: an all-time report card, the last 14 days in detail (including a 0-100 day score), per-tracker recent numbers, and any challenges.

Produce an honest read of their life RIGHT NOW, second person, plain English. Ground every claim in the numbers given — never invent data; if data is thin, say so in the verdict. "habit":"bad" means less is better.

Respond with ONLY a JSON object, exactly this shape:
{
  "headline": "one punchy sentence - the whole read in a line, max 15 words",
  "verdict": "2-3 sentences: what this life looks like right now, said plainly",
  "working": [{"point": "what is genuinely going well", "evidence": "the exact numbers it stands on"}],
  "slipping": [{"point": "what is slipping and what it costs", "evidence": "the exact numbers"}],
  "fix": {"what": "the ONE thing to fix first this week and why it is first", "tonight": "the first concrete step, doable tonight"}
}
2-3 items each in "working" and "slipping" (fewer if the data is thin). Direct, warm, zero corporate tone, no flattery padding. No markdown anywhere.`;

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
  const [trackerDocs, entryDocs, challengeDocs] = await Promise.all([
    d.collection("trackers").find({ userId }).sort({ order: 1 }).toArray(),
    d
      .collection("entries")
      .find(
        { userId, date: { $lte: today } },
        { projection: { trackerId: 1, date: 1, value: 1, _id: 0 } }
      )
      .toArray(),
    d.collection("challenges").find({ userId }).toArray(),
  ]);

  const trackers = trackerDocs.map(toTracker) as Tracker[];
  const entries: ReportEntry[] = entryDocs.map((e) => ({
    trackerId: String(e.trackerId),
    date: String(e.date),
    value: Number(e.value),
  }));
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Nothing logged yet — there's no life on record to analyze" },
      { status: 400 }
    );
  }

  const report = buildReportCard(trackers, entries, [], today);

  // The last 14 days, day by day: values per tracker, then score + facts.
  const since = addDays(today, -13);
  const byDay = new Map<string, Record<string, number>>();
  for (const e of entries) {
    if (e.date < since || e.date > today) continue;
    const m = byDay.get(e.date) ?? {};
    m[e.trackerId] = e.value;
    byDay.set(e.date, m);
  }
  const days = [];
  for (let date = since; date <= today; date = addDays(date, 1)) {
    const values = byDay.get(date) ?? {};
    const facts = dayFactsFrom(trackers, values, new Set(Object.keys(values)));
    days.push({
      date,
      score: dayScore(facts),
      goalsMet: `${facts.goalsMet}/${facts.goalsTotal}`,
      trackersLogged: `${facts.logged}/${facts.trackers}`,
      sleep: facts.sleep === null ? null : formatMinutes(facts.sleep),
    });
  }

  // Per-tracker view of the same window, in the tracker's own terms.
  const active = trackers.filter((t) => !t.archived);
  const trackerFacts = active.map((t) => {
    const type = t.type as TrackerType;
    const rows = entries.filter(
      (e) => e.trackerId === t.id && e.date >= since && e.date <= today
    );
    const sum = rows.reduce((s, e) => s + e.value, 0);
    const aggregate = typeMeta(type).aggregate;
    const shown = aggregate === "sum" ? sum : rows.length > 0 ? sum / rows.length : 0;
    return {
      name: t.name,
      kind: typeMeta(type).label,
      category: categoryMeta(t.category).label,
      habit: t.habit ?? "good",
      goal: t.goal
        ? `${t.goal.direction === "min" ? "at least" : "at most"} ${formatValue(t.goal.target, type, t.unit)} per ${t.goal.period}`
        : null,
      last14days: {
        daysLogged: rows.length,
        [aggregate === "sum" ? "total" : "avgPerLoggedDay"]: formatValue(
          shown,
          type,
          t.unit
        ),
      },
    };
  });

  const challenges = challengeDocs.map((c) => {
    const start = String(c.startDate);
    const values: Record<string, number> = {};
    for (const e of entries) {
      if (e.trackerId === String(c.trackerId)) values[e.date] = e.value;
    }
    const p = challengeProgress(
      {
        startDate: start,
        days: Number(c.days),
        target: c.target == null ? null : Number(c.target),
        direction: c.direction === "max" ? "max" : "min",
        values,
      },
      today
    );
    return {
      name: String(c.name),
      length: `${Number(c.days)} days`,
      status: p.status,
      daysDone: p.met,
      missed: p.missed,
    };
  });

  const payload = {
    today,
    allTime: {
      firstLogged: report.firstDate,
      daysLogged: `${report.daysLogged}/${report.spanDays}`,
      bestLoggingStreak: report.bestStreak,
      currentLoggingStreak: report.currentStreak,
      totalEntries: report.totalEntries,
      timeLogged: formatMinutes(report.timeMinutes),
      overallGrade: report.overall !== null ? gradeLetter(report.overall) : null,
      subjects: report.subjects.map((s) => ({
        category: categoryMeta(s.category).label,
        grade: gradeLetter(s.score),
        pct: Math.round(s.score * 100),
      })),
    },
    last14Days: days,
    trackers: trackerFacts,
    challenges,
  };

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
          { role: "user", content: JSON.stringify(payload) },
        ],
        max_tokens: 900,
        temperature: 0.4,
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
  await d.collection("aiReviews").insertOne({
    userId,
    text: text.slice(0, 10000),
    today,
    model,
    createdAt,
  });

  return NextResponse.json({ review, text, today, createdAt }, { status: 201 });
}
