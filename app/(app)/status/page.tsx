"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import AskData from "@/components/AskData";
import LoadError from "@/components/LoadError";
import LifeNow from "@/components/LifeNow";
import PeriodCompare from "@/components/PeriodCompare";
import ReportCard from "@/components/ReportCard";
import ShareStatus, { type StatusShareData } from "@/components/ShareStatus";
import WeeklyReviews from "@/components/WeeklyReviews";
import { buildAdvice } from "@/lib/advice";
import { prettyDate, toDateStr, type Period } from "@/lib/dates";
import { buildInsights, type InsightLevel } from "@/lib/insights";
import { BUNDLED } from "@/lib/motivation";
import { reportLines, type ReportCard as Report } from "@/lib/report";
import { scoresFromStats } from "@/lib/score";
import type { Stats, Summary } from "@/lib/stats";
import { formatValue, typeMeta, type Tracker, type TrackerType } from "@/lib/trackers";
import { useCached } from "@/lib/useCached";

/**
 * The status page: where you stand, said plainly.
 *
 * One screen that answers "how am I actually doing?" — what's being hit,
 * what's being missed, and what to fix first — over a week, two weeks or a
 * month. The dashboard is for reading trends; this is for reading yourself.
 */

const RANGES: { value: Period; label: string }[] = [
  { value: "week", label: "1 week" },
  { value: "15d", label: "2 weeks" },
  { value: "month", label: "Month" },
];

const LEVEL: Record<
  InsightLevel,
  { icon: string; ring: string; text: string }
> = {
  bad: {
    icon: "⚠️",
    ring: "border-red-600/40 bg-red-600/5",
    text: "text-red-600",
  },
  warn: {
    icon: "⚡",
    ring: "border-amber-600/40 bg-amber-600/5",
    text: "text-amber-700 dark:text-amber-500",
  },
  good: {
    icon: "✓",
    ring: "border-green-700/40 bg-green-700/5",
    text: "text-green-700 dark:text-green-500",
  },
};

/** A goal-carrying tracker's period, reduced to one judgeable number. */
type GoalRow = {
  tracker: Tracker;
  met: number;
  total: number;
  rate: number;
  /** "3h 20m a day", "4.2/5" — what actually happened, beside the verdict. */
  value: string;
};

function goalRows(stats: Stats): GoalRow[] {
  const rows: GoalRow[] = [];
  for (const t of stats.trackers) {
    if (t.archived || !t.goal) continue;
    const s: Summary | undefined = stats.summary[t.id];
    if (!s || !s.goal || s.goal.total === 0) continue;
    const aggregate = typeMeta(t.type as TrackerType).aggregate;
    const shown = aggregate === "sum" ? s.sum : s.avgPerLoggedDay;
    rows.push({
      tracker: t,
      met: s.goal.met,
      total: s.goal.total,
      rate: s.goal.met / s.goal.total,
      value:
        s.days === 0
          ? "nothing logged"
          : formatValue(shown, t.type as TrackerType, t.unit) +
            (aggregate === "sum" ? " total" : " avg"),
    });
  }
  // Worst first inside each list, so the biggest gap leads.
  return rows.sort((a, b) => a.rate - b.rate);
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-edge card p-3 shadow-sm">
      <p className="text-xs text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function GoalList({
  rows,
  tone,
}: {
  rows: GoalRow[];
  tone: "win" | "fail";
}) {
  const bar = tone === "win" ? "bg-green-600" : "bg-red-500";
  return (
    <ul className="mt-3 space-y-3">
      {rows.map(({ tracker, met, total, rate, value }) => (
        <li key={tracker.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{tracker.name}</span>
            <span className="shrink-0 tabular-nums text-secondary">
              {met}/{total} {tracker.goal?.period === "week" ? "weeks" : "days"}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full ${bar}`}
                style={{ width: `${Math.round(rate * 100)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">
              {Math.round(rate * 100)}%
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">{value}</p>
        </li>
      ))}
    </ul>
  );
}

export default function StatusPage() {
  const [period, setPeriod] = useState<Period>("week");
  const today = toDateStr(new Date());

  const statsQ = useCached<Stats>(
    `/api/stats?period=${period}&today=${today}`,
    `stats:${period}`
  );
  const stats = statsQ.data;

  // The all-time report card feeds two things here: the card at the bottom,
  // and the line at the top — fetched once, shared by both.
  const reportQ = useCached<Report>(`/api/report?today=${today}`, "report");
  const report = reportQ.data;

  // One motivation line at the top — from your own record when there is
  // one, from the shared quote pool until then. "Random" here is a hash of
  // the date and the record rather than Math.random(): rendering stays
  // pure, the line holds still all day, and tomorrow brings a different one.
  const motivation = useMemo(() => {
    if (!report) return null;
    const personal = reportLines(report);
    const pool =
      personal.length > 0
        ? personal
        : BUNDLED.map((l) => (l.author ? `${l.text} — ${l.author}` : l.text));
    if (pool.length === 0) return null;
    let h = report.totalEntries;
    for (const ch of today) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
  }, [report, today]);

  // The three biggest wins available right now, as instructions.
  const advice = useMemo(() => buildAdvice(stats).slice(0, 3), [stats]);

  const insights = useMemo(() => buildInsights(stats), [stats]);
  const toImprove = insights.filter((i) => i.level !== "good");
  const goingWell = insights.filter((i) => i.level === "good");

  // One number per day: today's, the range's average, and its best.
  const dayScores = useMemo(() => {
    const all = stats ? scoresFromStats(stats) : [];
    const scored = all.filter((s): s is { date: string; score: number } => s.score !== null);
    const last = all.length > 0 ? all[all.length - 1].score : null;
    return {
      today: last,
      avg:
        scored.length > 0
          ? Math.round(scored.reduce((s, x) => s + x.score, 0) / scored.length)
          : null,
      best: scored.length > 0 ? Math.max(...scored.map((s) => s.score)) : null,
    };
  }, [stats]);

  const goals = useMemo(() => (stats ? goalRows(stats) : []), [stats]);
  const wins = goals.filter((g) => g.rate >= 0.6);
  const fails = goals.filter((g) => g.rate < 0.6);
  const goalsMet = goals.reduce((n, g) => n + g.met, 0);
  const goalsTotal = goals.reduce((n, g) => n + g.total, 0);

  const shareData = useMemo<StatusShareData | null>(() => {
    if (!stats || !stats.hasEntries) return null;
    return {
      rangeLabel: `Last ${stats.days} days`,
      dateLabel: prettyDate(today),
      daysLogged: stats.daysLogged,
      days: stats.days,
      streak: stats.streak,
      goalsPct:
        goalsTotal > 0 ? `${Math.round((goalsMet / goalsTotal) * 100)}%` : "—",
      improve: toImprove.map((i) => ({
        title: i.title,
        level: i.level === "bad" ? ("bad" as const) : ("warn" as const),
      })),
      wins: wins.map((g) => `${g.tracker.name} — ${g.met}/${g.total}`),
      fails: fails.map((g) => `${g.tracker.name} — ${g.met}/${g.total}`),
    };
  }, [stats, today, goalsMet, goalsTotal, toImprove, wins, fails]);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Status</h1>
        <p className="mt-1 text-sm text-secondary">
          Where you stand right now — what you&apos;re hitting, what you&apos;re
          missing, and what to fix first. For the day-by-day calendar, open{" "}
          <Link href="/history" className="font-medium text-accent underline">
            📅 History
          </Link>
          .
        </p>
      </div>

      {/* A word on the way in — your own numbers when there are any. */}
      {report && motivation && (
        <p className="animate-fade-in rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm font-medium">
          ✨ {motivation}
        </p>
      )}

      {/* The coach reads everything, so it sits above the range picker. */}
      <LifeNow />

      {/* The coach answers the question the app chose; this answers the one
          you have. It sits directly under the card because that is where
          the question occurs to someone — reading the read. */}
      <AskData />

      {/* Range picker, and the way to show someone */}
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setPeriod(r.value)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              period === r.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-edge text-secondary hover:bg-surface-2"
            }`}
          >
            {r.label}
          </button>
        ))}
        <ShareStatus data={shareData} />
      </div>

      {statsQ.loading && !stats ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton h-20 rounded-lg" />
          <div className="skeleton h-40 rounded-lg" />
          <div className="skeleton h-40 rounded-lg" />
        </div>
      ) : !stats && statsQ.error ? (
        // Before this branch existed, a failed request fell through to
        // "Nothing logged in this range yet" — which is not a slow screen or
        // an empty one, it is the app telling someone they did nothing.
        <LoadError
          what="your status"
          message={statsQ.error}
          onRetry={() => void statsQ.refresh()}
        />
      ) : !stats || !stats.hasEntries ? (
        <p className="rounded-xl border border-edge card p-4 text-sm text-muted">
          Nothing logged in this range yet.{" "}
          <Link href="/" className="font-medium text-accent underline">
            Log a few days
          </Link>{" "}
          and this page fills in.
        </p>
      ) : (
        <>
          {/* The headline numbers */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Day score"
              value={dayScores.today !== null ? String(dayScores.today) : "—"}
              hint={
                dayScores.avg !== null
                  ? `avg ${dayScores.avg} · best ${dayScores.best}`
                  : "today, out of 100"
              }
            />
            <Tile
              label="Days logged"
              value={`${stats.daysLogged}/${stats.days}`}
              hint={
                stats.prevDaysLogged > 0
                  ? `was ${stats.prevDaysLogged} before`
                  : undefined
              }
            />
            <Tile
              label="Logging streak"
              value={String(stats.streak)}
              hint={stats.streak === 1 ? "day in a row" : "days in a row"}
            />
            <Tile
              label="Goals hit"
              value={goalsTotal > 0 ? `${Math.round((goalsMet / goalsTotal) * 100)}%` : "—"}
              hint={goalsTotal > 0 ? `${goalsMet} of ${goalsTotal}` : "no goals set"}
            />
          </div>

          {/* The week against the last one. It sits above the advice because
              it is the same question at a different altitude — "how is this
              week going?" — and below the tiles because those are today. The
              month version of this card lives on the calendar page, where
              the month picker is. */}
          <PeriodCompare period="week" anchor={today} />

          {/* The advice — not what's happening, but what to do about it,
              biggest win first. Quiet when there's nothing to fix. */}
          {advice.length > 0 && (
            <section className="rounded-xl border border-accent/40 card p-4 shadow-sm">
              <h2 className="font-semibold">🎯 Focus first</h2>
              <p className="mt-1 text-sm text-secondary">
                The biggest wins available right now, in order.
              </p>
              <ol className="mt-3 space-y-4">
                {advice.map((a, i) => (
                  <li key={a.focus} className="flex gap-3">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        a.level === "bad"
                          ? "bg-red-600/10 text-red-600"
                          : "bg-accent/10 text-accent"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{a.focus}</p>
                      <p className="mt-0.5 text-sm text-secondary">{a.why}</p>
                      <p className="mt-1 text-sm text-secondary">
                        <span className="font-medium text-accent">Fix: </span>
                        {a.how}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* What to fix first — the point of the page, so it leads. */}
          <section className="rounded-xl border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">Key points to improve</h2>
            {toImprove.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                Nothing stands out — keep doing what you&apos;re doing.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {toImprove.map((insight, i) => {
                  const look = LEVEL[insight.level];
                  return (
                    <li key={i} className={`rounded-md border p-3 ${look.ring}`}>
                      <div className="flex items-start gap-2">
                        <span aria-hidden="true">{look.icon}</span>
                        <div className="min-w-0">
                          <p className={`text-sm font-semibold ${look.text}`}>
                            {insight.title}
                          </p>
                          <p className="mt-0.5 text-sm text-secondary">
                            {insight.detail}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Goals, split by verdict */}
          {fails.length > 0 && (
            <section className="rounded-xl border border-edge card p-4 shadow-sm">
              <h2 className="font-semibold text-red-600">Falling short</h2>
              <p className="mt-1 text-sm text-secondary">
                Goals hit less than 60% of the time in this range.
              </p>
              <GoalList rows={fails} tone="fail" />
            </section>
          )}

          {wins.length > 0 && (
            <section className="rounded-xl border border-edge card p-4 shadow-sm">
              <h2 className="font-semibold text-green-700 dark:text-green-500">
                Holding up
              </h2>
              <p className="mt-1 text-sm text-secondary">
                Goals you&apos;re hitting most of the time.
              </p>
              <GoalList rows={wins} tone="win" />
            </section>
          )}

          {goingWell.length > 0 && (
            <section className="rounded-xl border border-edge card p-4 shadow-sm">
              <h2 className="font-semibold">Going well</h2>
              <ul className="mt-3 space-y-2">
                {goingWell.map((insight, i) => (
                  <li
                    key={i}
                    className={`rounded-md border p-3 ${LEVEL.good.ring}`}
                  >
                    <div className="flex items-start gap-2">
                      <span aria-hidden="true">{LEVEL.good.icon}</span>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${LEVEL.good.text}`}>
                          {insight.title}
                        </p>
                        <p className="mt-0.5 text-sm text-secondary">
                          {insight.detail}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Every number, for the trackers without goals too */}
          <section className="rounded-xl border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">The numbers</h2>
            <ul className="mt-3 divide-y divide-edge text-sm">
              {stats.trackers
                .filter((t) => !t.archived)
                .map((t) => {
                  const s = stats.summary[t.id];
                  if (!s) return null;
                  const aggregate = typeMeta(t.type as TrackerType).aggregate;
                  const shown = aggregate === "sum" ? s.sum : s.avgPerLoggedDay;
                  return (
                    <li
                      key={t.id}
                      className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span
                          className="inline-block h-2 w-2 shrink-0 self-center rounded-full"
                          style={{ backgroundColor: t.color }}
                          aria-hidden="true"
                        />
                        <Link
                          href={`/tracker/${t.id}`}
                          className="truncate font-medium hover:text-accent hover:underline"
                        >
                          {t.name}
                        </Link>
                      </span>
                      <span className="shrink-0 tabular-nums text-secondary">
                        {s.days === 0
                          ? "—"
                          : formatValue(shown, t.type as TrackerType, t.unit)}
                        <span className="ml-1.5 text-xs text-muted">
                          {s.days}/{stats.days}d
                        </span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </section>
        </>
      )}

      {/* Weeks that have already been judged, kept. Below the range picker
          for the same reason the report card is: it is not about the range
          being browsed, it is about all of them. */}
      <WeeklyReviews />

      {/* The ranges above answer "how is this week going?" — this one is the
          whole account graded, so it sits outside the range picker. */}
      <ReportCard report={report} />
    </div>
  );
}
