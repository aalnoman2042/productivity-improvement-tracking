"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PERIODS, parseDateStr, toDateStr, type Period } from "@/lib/dates";
import {
  categoryMeta,
  formatValue,
  orderCategories,
  typeMeta,
  type Goal,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";
import { useCached } from "@/lib/useCached";
import type { Stats, Summary } from "@/lib/stats";
import { seriesColor } from "@/lib/palette";
import { nightLabel, shiftLabel } from "@/lib/clock";
import {
  DonutChart,
  TrendChart,
  SeriesChart,
  SleepClockChart,
} from "@/components/charts";
import type { Slice } from "@/components/charts/DonutChart";
import type { Point } from "@/components/charts/SeriesChart";
import type { ClockPoint } from "@/components/charts/SleepClockChart";

const shortTime = (v: number) =>
  v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${Math.round(v)}m`;

const PERIOD_WORD: Record<Period, string> = {
  week: "last week",
  "15d": "the previous 15 days",
  month: "last month",
  "6mo": "the previous 6 months",
  year: "last year",
};

function prettyDate(date: string): string {
  const d = parseDateStr(date);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------- pieces -------------------------------- */

/** ↑ 12% — green when it's movement in the direction you asked for. */
function Delta({
  changePct,
  goodDirection,
  compareTo,
}: {
  changePct: number | null;
  goodDirection: "up" | "down" | "unknown";
  compareTo: string;
}) {
  if (changePct === null || !Number.isFinite(changePct)) {
    return <span className="text-xs text-muted">no earlier data</span>;
  }
  const rounded = Math.round(changePct);
  if (rounded === 0) {
    return <span className="text-xs text-muted">same as {compareTo}</span>;
  }
  const up = rounded > 0;
  const good =
    goodDirection === "unknown" ? null : up === (goodDirection === "up");
  const tone =
    good === null
      ? "text-secondary"
      : good
        ? "text-green-700 dark:text-green-500"
        : "text-red-600 dark:text-red-400";
  return (
    <span className={`text-xs font-medium ${tone}`} title={`vs ${compareTo}`}>
      {up ? "↑" : "↓"} {Math.abs(rounded)}%
    </span>
  );
}

function StatTile({
  label,
  value,
  footer,
}: {
  label: string;
  value: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-edge card p-4 shadow-sm">
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {footer && <div className="mt-1">{footer}</div>}
    </div>
  );
}

function GoalBar({ met, total }: { met: number; total: number }) {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-secondary">
        <span>Goal met</span>
        <span className="tabular-nums">
          {met}/{total} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="bg-brand-gradient h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-3">
      {items.map((f) => (
        <div key={f.label}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------ the page ------------------------------- */

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("week");

  // The numbers from the last visit go up straight away and are replaced when
  // the fresh ones arrive — opening the dashboard shouldn't be a blank wait.
  const statsQ = useCached<Stats>(
    `/api/stats?period=${period}&today=${toDateStr(new Date())}`,
    `stats:${period}`
  );
  const stats = statsQ.data;

  const active = useMemo(
    () => (stats?.trackers ?? []).filter((t) => !t.archived),
    [stats]
  );
  const durationTrackers = active.filter((t) => t.type === "duration");
  const sleepTrackers = active.filter((t) => t.type === "sleep");
  const habitTrackers = active.filter(
    (t) => !["duration", "sleep"].includes(t.type)
  );

  // Habits are easier to read grouped the way they're grouped everywhere else.
  const habitGroups = useMemo(
    () =>
      orderCategories(habitTrackers.map((t) => t.category))
        .map((value) => ({
          value,
          ...categoryMeta(value),
          items: habitTrackers.filter(
            (t) => t.category.toLowerCase() === value.toLowerCase()
          ),
        }))
        .filter((g) => g.items.length > 0),
    [habitTrackers]
  );

  function pointsFor(t: Tracker): Point[] {
    if (!stats) return [];
    const aggregate = typeMeta(t.type as TrackerType).aggregate;
    return stats.buckets.map((b) => {
      const sum = b.values[t.id] ?? 0;
      const n = b.counts[t.id] ?? 0;
      if (aggregate === "avg") {
        return { label: b.label, value: n > 0 ? sum / n : null };
      }
      return { label: b.label, value: sum };
    });
  }

  function goalLineFor(t: Tracker): number | null {
    const goal: Goal = t.goal;
    if (!goal || goal.period !== "day") return null;
    const aggregate = typeMeta(t.type as TrackerType).aggregate;
    if (aggregate === "avg") return goal.target;
    return stats?.granularity === "day" ? goal.target : null;
  }

  /** More of this is good unless the goal says "at most". */
  function goodDirection(t: Tracker): "up" | "down" | "unknown" {
    if (t.goal) return t.goal.direction === "max" ? "down" : "up";
    return t.type === "measure" ? "unknown" : "up";
  }

  const timeSlices: Slice[] = durationTrackers
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      minutes: stats?.summary[t.id]?.sum ?? 0,
    }))
    .filter((s) => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const totalTime = timeSlices.reduce((s, x) => s + x.minutes, 0);
  const prevTotalTime = durationTrackers.reduce(
    (s, t) => s + (stats?.summary[t.id]?.previous.sum ?? 0),
    0
  );
  const timeChange =
    prevTotalTime > 0 ? ((totalTime - prevTotalTime) / prevTotalTime) * 100 : null;

  const goalStats = active
    .map((t) => stats?.summary[t.id]?.goal)
    .filter(Boolean) as { met: number; total: number }[];
  const goalsMet = goalStats.reduce((s, g) => s + g.met, 0);
  const goalsTotal = goalStats.reduce((s, g) => s + g.total, 0);

  const mainSleep = sleepTrackers[0];
  const sleepSummary = mainSleep ? stats?.summary[mainSleep.id] : undefined;
  const compareTo = PERIOD_WORD[period];

  // How much of the period is actually accounted for: every activity plus
  // sleep, against the 24 hours each day really has.
  const sleepMinutes = sleepTrackers.reduce(
    (s, t) => s + (stats?.summary[t.id]?.sum ?? 0),
    0
  );
  const accountedMinutes = totalTime + sleepMinutes;
  const periodHours = (stats?.days ?? 0) * 24;
  const coveragePct =
    periodHours > 0
      ? Math.round((accountedMinutes / (periodHours * 60)) * 100)
      : 0;

  function clockPointsFor(t: Tracker): ClockPoint[] {
    if (!stats) return [];
    return stats.buckets.map((b) => {
      const c = b.clock?.[t.id];
      return {
        label: b.label,
        range: c ? ([c.bed, c.wake] as [number, number]) : null,
        nights: c?.nights ?? 0,
      };
    });
  }

  /**
   * Hours slept says how much; this says *when*. Same data, but the question
   * "am I getting to bed earlier?" needs the clock, not a total.
   */
  function SleepClockCard({ t }: { t: Tracker }) {
    const clock = stats?.summary[t.id]?.clock ?? null;
    const shift =
      clock && clock.prevBed != null
        ? shiftLabel(clock.bed, clock.prevBed)
        : null;
    const earlier = clock && clock.prevBed != null && clock.bed < clock.prevBed;

    return (
      <section className="rounded-lg border border-edge card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: seriesColor(t.color) }}
          />
          <h3 className="text-sm font-semibold">Bedtime &amp; wake-up</h3>
          {shift && (
            <span
              className={`ml-auto text-xs font-medium ${
                shift === "about the same"
                  ? "text-muted"
                  : earlier
                    ? "text-green-700 dark:text-green-500"
                    : "text-red-600 dark:text-red-400"
              }`}
              title={`Average bedtime vs ${compareTo}`}
            >
              {shift === "about the same"
                ? `same bedtime as ${compareTo}`
                : `to bed ${shift}`}
            </span>
          )}
        </div>

        {clock ? (
          <>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">
                {nightLabel(clock.bed)}
              </span>
              <span className="text-xs text-muted">
                average bedtime across {clock.nights} night
                {clock.nights === 1 ? "" : "s"}
              </span>
            </div>

            <SleepClockChart
              data={clockPointsFor(t)}
              color={t.color}
              avgBed={clock.bed}
              height={150}
            />

            <Facts
              items={[
                { label: "Usually up at", value: nightLabel(clock.wake) },
                { label: "Earliest night", value: nightLabel(clock.earliestBed) },
                { label: "Latest night", value: nightLabel(clock.latestBed) },
              ]}
            />
            {clock.latestBedDate && clock.latestBed > clock.earliestBed && (
              <p className="mt-2 text-xs text-muted">
                Your latest night was {prettyDate(clock.latestBedDate)}.
              </p>
            )}
          </>
        ) : (
          <p className="py-10 text-center text-sm text-muted">
            Fill in the &ldquo;slept&rdquo; and &ldquo;woke&rdquo; times on{" "}
            <Link href="/" className="text-accent underline">
              the daily log
            </Link>{" "}
            and your nights show up here.
          </p>
        )}
      </section>
    );
  }

  /** A clean streak is about the run, not the period — so it says so. */
  function StreakCard({ t, s }: { t: Tracker; s: Summary }) {
    const run = s.streak;
    const days = run?.current ?? 0;
    return (
      <section className="rounded-lg border border-edge card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: seriesColor(t.color) }}
          />
          <h3 className="text-sm font-semibold">{t.name}</h3>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{days}</span>
          <span className="text-sm text-secondary">
            day{days === 1 ? "" : "s"} clean
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {run?.lastSlip
            ? `Last slip ${prettyDate(run.lastSlip)}`
            : run?.since
              ? `No slips since you started on ${prettyDate(run.since)}`
              : "Log a day to start the count"}
        </p>

        <Facts
          items={[
            { label: "Best run", value: `${run?.best ?? 0}d` },
            { label: "Slips (all time)", value: String(run?.slips ?? 0) },
            {
              label: "Clean this period",
              value: `${s.sum}/${stats?.days ?? 0}`,
            },
          ]}
        />

        <SeriesChart
          data={pointsFor(t)}
          color={t.color}
          kind="bar"
          title={t.name}
          format={(v) => formatValue(v, "streak", t.unit)}
          tickFormat={(v) => String(Math.round(v))}
          height={110}
        />
      </section>
    );
  }

  /** One tracker, one chart, with its own numbers underneath. */
  function TrackerCard({ t }: { t: Tracker }) {
    const s = stats?.summary[t.id];
    const type = t.type as TrackerType;
    const isTime = type === "duration" || type === "sleep";
    const aggregate = typeMeta(type).aggregate;
    const kind: "bar" | "line" =
      type === "measure" || type === "scale" ? "line" : "bar";
    const fmt = (v: number) => formatValue(v, type, t.unit);

    // The streak card stands on its own — it means something even in a week
    // where nothing was logged, because the run carries on regardless.
    if (type === "streak" && s) return <StreakCard t={t} s={s} />;

    if (!s || s.days === 0) {
      return (
        <section className="rounded-lg border border-edge card p-4 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: seriesColor(t.color) }}
            />
            {t.name}
          </h3>
          <p className="py-10 text-center text-sm text-muted">
            Nothing logged in this period
          </p>
        </section>
      );
    }

    const headline =
      type === "check"
        ? `${s.sum} of ${stats?.days} days`
        : aggregate === "avg"
          ? fmt(s.avgPerLoggedDay)
          : fmt(s.sum);

    const domain: [number, number] | undefined =
      type === "scale" ? [0, 5] : type === "prayer" ? [0, 5] : undefined;

    return (
      <section className="rounded-lg border border-edge card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: seriesColor(t.color) }}
          />
          <h3 className="text-sm font-semibold">{t.name}</h3>
          <span className="ml-auto">
            <Delta
              changePct={s.changePct}
              goodDirection={goodDirection(t)}
              compareTo={compareTo}
            />
          </span>
        </div>

        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{headline}</span>
          <span className="text-xs text-muted">
            {aggregate === "avg" ? "average" : "total"}
          </span>
        </div>

        <SeriesChart
          data={pointsFor(t)}
          color={t.color}
          kind={kind}
          title={t.name}
          format={fmt}
          tickFormat={
            isTime ? shortTime : (v) => String(Math.round(v * 10) / 10)
          }
          goal={goalLineFor(t)}
          goalLabel="goal"
          domain={domain}
          height={150}
        />

        <Facts
          items={[
            {
              label: aggregate === "avg" ? "Best" : "Per active day",
              value: fmt(aggregate === "avg" ? s.best : s.avgPerLoggedDay),
            },
            {
              label: "Best day",
              value: s.bestDate ? prettyDate(s.bestDate) : "—",
            },
            { label: "Days active", value: `${s.days}/${stats?.days}` },
          ]}
        />

        {s.goal && <GoalBar met={s.goal.met} total={s.goal.total} />}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          {stats && (
            <>
              <p className="mt-1 text-sm text-secondary">
                <strong className="text-foreground tabular-nums">
                  {formatValue(accountedMinutes, "duration", "min")}
                </strong>{" "}
                of{" "}
                <strong className="text-foreground tabular-nums">
                  {periodHours}h
                </strong>{" "}
                tracked
                <span className="text-muted"> ({coveragePct}%)</span>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {prettyDate(stats.start)} – {prettyDate(stats.end)} ·{" "}
                {stats.days} days · activities{" "}
                <span className="tabular-nums">
                  {formatValue(totalTime, "duration", "min")}
                </span>
                {sleepMinutes > 0 && (
                  <>
                    {" "}
                    · sleep{" "}
                    <span className="tabular-nums">
                      {formatValue(sleepMinutes, "sleep", "min")}
                    </span>
                  </>
                )}{" "}
                · untracked{" "}
                <span className="tabular-nums">
                  {formatValue(Math.max(0, periodHours * 60 - accountedMinutes), "duration", "min")}
                </span>
                {statsQ.refreshing && (
                  <span className="ml-2 animate-fade-in text-muted">
                    updating…
                  </span>
                )}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-edge card p-1 shadow-sm">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                period === p.value
                  ? "bg-brand-gradient text-white shadow-sm"
                  : "text-secondary hover:bg-surface-2"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {stats === null ? (
        statsQ.error ? (
          <div className="rounded-lg border border-dashed border-edge p-8 text-center">
            <p className="text-sm text-secondary">{statsQ.error}</p>
            <button
              onClick={() => void statsQ.refresh()}
              className="mt-3 rounded-md border border-edge px-4 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-4" aria-hidden="true">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-24 rounded-lg" />
              ))}
            </div>
            <div className="skeleton h-64 rounded-lg" />
          </div>
        )
      ) : active.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-10 text-center">
          <p className="text-lg font-medium">Welcome to PIT 👋</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
            Set up what you want to track — sleep, study, work, workouts, food,
            habits — then log your days and your progress shows up here.
          </p>
          <Link
            href="/trackers"
            className="mt-5 inline-block rounded-md bg-brand-gradient px-5 py-2.5 text-sm font-medium text-white hover:brightness-110"
          >
            Set up trackers
          </Link>
        </div>
      ) : (
        <>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Time logged"
              value={formatValue(totalTime, "duration", "min")}
              footer={
                <Delta
                  changePct={timeChange}
                  goodDirection="up"
                  compareTo={compareTo}
                />
              }
            />
            <StatTile
              label={mainSleep ? "Average sleep" : "Days logged"}
              value={
                mainSleep
                  ? sleepSummary && sleepSummary.days > 0
                    ? formatValue(sleepSummary.avgPerLoggedDay, "sleep", "min")
                    : "—"
                  : `${stats.daysLogged}`
              }
              footer={
                mainSleep && sleepSummary ? (
                  <Delta
                    changePct={sleepSummary.changePct}
                    goodDirection="up"
                    compareTo={compareTo}
                  />
                ) : undefined
              }
            />
            <StatTile
              label="Current streak"
              value={`${stats.streak}d`}
              footer={
                <span className="text-xs text-muted">
                  {stats.daysLogged}/{stats.days} days logged
                </span>
              }
            />
            <StatTile
              label="Goals met"
              value={
                goalsTotal > 0
                  ? `${Math.round((goalsMet / goalsTotal) * 100)}%`
                  : "—"
              }
              footer={
                goalsTotal > 0 ? (
                  <span className="text-xs text-muted">
                    {goalsMet} of {goalsTotal}
                  </span>
                ) : undefined
              }
            />
          </div>

          {!stats.hasEntries && (
            <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-secondary">
              Nothing logged in this period yet.{" "}
              <Link href="/" className="font-medium text-accent underline">
                Log today
              </Link>
            </div>
          )}

          {/* Everything together */}
          {totalTime > 0 && (
            <div className="animate-rise-in grid gap-4 lg:grid-cols-5">
              <section className="rounded-lg border border-edge card p-4 shadow-sm lg:col-span-2">
                <h2 className="mb-3 text-sm font-semibold text-secondary">
                  Where your time went
                </h2>
                <DonutChart data={timeSlices} />
              </section>
              <section className="rounded-lg border border-edge card p-4 shadow-sm lg:col-span-3">
                <h2 className="mb-1 text-sm font-semibold text-secondary">
                  All activities stacked
                </h2>
                <p className="mb-3 text-xs text-muted">
                  Total time per{" "}
                  {stats.granularity === "day"
                    ? "day"
                    : stats.granularity === "week"
                      ? "week"
                      : "month"}
                  , split by activity.
                </p>
                <TrendChart buckets={stats.buckets} series={durationTrackers} />
              </section>
            </div>
          )}

          {/* Then each one on its own */}
          {durationTrackers.length > 0 && (
            <section>
              <h2 className="mb-1 text-lg font-semibold">Each activity on its own</h2>
              <p className="mb-3 text-sm text-secondary">
                One chart per activity, so you can see how each is moving —
                compared with {compareTo}.
              </p>
              <div className="stagger grid gap-4 md:grid-cols-2">
                {durationTrackers.map((t) => (
                  <TrackerCard key={t.id} t={t} />
                ))}
              </div>
            </section>
          )}

          {/* Sleep: how long, and — just as telling — when */}
          {sleepTrackers.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Sleep</h2>
              {sleepTrackers.map((t) => {
                const quality = stats.buckets.reduce(
                  (acc, b) => {
                    const q = b.quality[t.id];
                    return q ? { sum: acc.sum + q.sum, n: acc.n + q.n } : acc;
                  },
                  { sum: 0, n: 0 }
                );
                return (
                  <div key={t.id} className="stagger grid gap-4 md:grid-cols-2">
                    <div>
                      <TrackerCard t={t} />
                      {quality.n > 0 && (
                        <p className="mt-1 px-1 text-xs text-secondary">
                          Average quality{" "}
                          <strong className="tabular-nums">
                            {(Math.round((quality.sum / quality.n) * 10) / 10).toFixed(1)}/5
                          </strong>{" "}
                          across {quality.n} night{quality.n > 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                    <SleepClockCard t={t} />
                  </div>
                );
              })}
            </section>
          )}

          {/* Habits, faith, food, health — grouped the way you filed them */}
          {habitGroups.length > 0 && (
            <section className="space-y-5">
              <h2 className="text-lg font-semibold">Habits &amp; health</h2>
              {habitGroups.map((group) => (
                <div key={group.value}>
                  <h3 className="mb-2 text-sm font-semibold text-secondary">
                    {group.icon} {group.label}
                  </h3>
                  <div className="stagger grid gap-4 md:grid-cols-2">
                    {group.items.map((t) => (
                      <TrackerCard key={t.id} t={t} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
