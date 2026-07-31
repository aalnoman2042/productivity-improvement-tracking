"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PERIODS, toDateStr, type Period } from "@/lib/dates";
import {
  formatValue,
  typeMeta,
  type Goal,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";
import { DonutChart, TrendChart, SeriesChart } from "@/components/charts";
import type { Slice } from "@/components/charts/DonutChart";
import type { Point } from "@/components/charts/SeriesChart";

type Bucket = {
  key: string;
  label: string;
  values: Record<string, number>;
  counts: Record<string, number>;
  quality: Record<string, { sum: number; n: number }>;
};

type Summary = {
  sum: number;
  days: number;
  best: number;
  avgPerDay: number;
  avgPerLoggedDay: number;
  goal: { met: number; total: number } | null;
};

type Stats = {
  period: Period;
  days: number;
  granularity: "day" | "week" | "month";
  trackers: Tracker[];
  buckets: Bucket[];
  summary: Record<string, Summary>;
  streak: number;
  daysLogged: number;
  hasEntries: boolean;
};

/** Compact axis labels: 90 → "1.5h", 45 → "45m". */
const shortTime = (v: number) =>
  v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${Math.round(v)}m`;

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-edge card p-4 shadow-sm">
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {hint && <div className="mt-1 text-xs text-secondary">{hint}</div>}
    </div>
  );
}

function GoalBar({ met, total }: { met: number; total: number }) {
  const pct = total > 0 ? Math.round((met / total) * 100) : 0;
  return (
    <div className="mt-2">
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

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stats?period=${period}&today=${toDateStr(new Date())}`)
      .then(async (res) => {
        if (res.status === 401) return location.assign("/login");
        const data = await res.json();
        if (!cancelled) setStats(data);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  const active = useMemo(
    () => (stats?.trackers ?? []).filter((t) => !t.archived),
    [stats]
  );
  const durationTrackers = active.filter((t) => t.type === "duration");
  const sleepTrackers = active.filter((t) => t.type === "sleep");
  const otherTrackers = active.filter(
    (t) => !["duration", "sleep"].includes(t.type)
  );

  /** Per-bucket points for one tracker: summed, or averaged for avg types. */
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

  /**
   * Only draw a goal line when it's an honest comparison with what the bars
   * show — daily averages always, daily sums only on daily buckets.
   */
  function goalLineFor(t: Tracker): number | null {
    const goal: Goal = t.goal;
    if (!goal || goal.period !== "day") return null;
    const aggregate = typeMeta(t.type as TrackerType).aggregate;
    if (aggregate === "avg") return goal.target;
    return stats?.granularity === "day" ? goal.target : null;
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

  const goalStats = active
    .map((t) => stats?.summary[t.id]?.goal)
    .filter(Boolean) as { met: number; total: number }[];
  const goalsMet = goalStats.reduce((s, g) => s + g.met, 0);
  const goalsTotal = goalStats.reduce((s, g) => s + g.total, 0);

  const mainSleep = sleepTrackers[0];
  const sleepAvg = mainSleep
    ? (stats?.summary[mainSleep.id]?.avgPerLoggedDay ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
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

      {stats === null || loading ? (
        <p className="text-sm text-muted">Loading…</p>
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
            />
            <StatTile
              label={mainSleep ? "Average sleep" : "Days logged"}
              value={
                mainSleep
                  ? sleepAvg > 0
                    ? formatValue(sleepAvg, "sleep", "min")
                    : "—"
                  : `${stats.daysLogged}`
              }
            />
            <StatTile label="Current streak" value={`${stats.streak}d`} />
            <StatTile
              label="Goals met"
              value={
                goalsTotal > 0
                  ? `${Math.round((goalsMet / goalsTotal) * 100)}%`
                  : "—"
              }
              hint={goalsTotal > 0 ? `${goalsMet} of ${goalsTotal}` : undefined}
            />
          </div>

          {!stats.hasEntries && (
            <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-secondary">
              Nothing logged in this period yet.{" "}
              <Link href="/today" className="font-medium text-accent underline">
                Log today
              </Link>
            </div>
          )}

          {/* Time spent */}
          {totalTime > 0 && (
            <div className="animate-rise-in grid gap-4 lg:grid-cols-5">
              <section className="rounded-lg border border-edge card p-4 shadow-sm lg:col-span-2">
                <h2 className="mb-3 text-sm font-semibold text-secondary">
                  Where your time went
                </h2>
                <DonutChart data={timeSlices} />
              </section>
              <section className="rounded-lg border border-edge card p-4 shadow-sm lg:col-span-3">
                <h2 className="mb-3 text-sm font-semibold text-secondary">
                  Time per{" "}
                  {stats.granularity === "day"
                    ? "day"
                    : stats.granularity === "week"
                      ? "week"
                      : "month"}
                </h2>
                <TrendChart buckets={stats.buckets} series={durationTrackers} />
              </section>
            </div>
          )}

          {/* Sleep */}
          {sleepTrackers.map((t) => {
            const s = stats.summary[t.id];
            if (!s || s.days === 0) return null;
            const quality = stats.buckets.reduce(
              (acc, b) => {
                const q = b.quality[t.id];
                return q ? { sum: acc.sum + q.sum, n: acc.n + q.n } : acc;
              },
              { sum: 0, n: 0 }
            );
            return (
              <section
                key={t.id}
                className="rounded-lg border border-edge card p-4 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-secondary">
                    🌙 {t.name}
                  </h2>
                  <div className="flex gap-4 text-xs text-secondary">
                    <span>
                      Average{" "}
                      <strong className="tabular-nums">
                        {formatValue(s.avgPerLoggedDay, "sleep", "min")}
                      </strong>
                    </span>
                    {quality.n > 0 && (
                      <span>
                        Quality{" "}
                        <strong className="tabular-nums">
                          {(Math.round((quality.sum / quality.n) * 10) / 10).toFixed(1)}/5
                        </strong>
                      </span>
                    )}
                  </div>
                </div>
                <SeriesChart
                  data={pointsFor(t)}
                  color={t.color}
                  kind="bar"
                  title={t.name}
                  format={(v) => formatValue(v, "sleep", "min")}
                  tickFormat={shortTime}
                  goal={goalLineFor(t)}
                  goalLabel="target"
                  height={200}
                />
                {s.goal && <GoalBar met={s.goal.met} total={s.goal.total} />}
              </section>
            );
          })}

          {/* Habits, food, health */}
          {otherTrackers.length > 0 && (
            <div className="stagger grid gap-4 md:grid-cols-2">
              {otherTrackers.map((t) => {
                const s = stats.summary[t.id];
                const type = t.type as TrackerType;
                const isRating = type === "scale";
                const isCheck = type === "check";
                const kind: "bar" | "line" =
                  type === "measure" || isRating ? "line" : "bar";
                const headline = !s
                  ? "—"
                  : isCheck
                    ? `${s.sum}/${stats.days} days`
                    : typeMeta(type).aggregate === "avg"
                      ? s.days > 0
                        ? formatValue(s.avgPerLoggedDay, type, t.unit)
                        : "—"
                      : formatValue(s.sum, type, t.unit);

                return (
                  <section
                    key={t.id}
                    className="rounded-lg border border-edge card p-4 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-sm font-semibold text-secondary">
                        {t.name}
                      </h2>
                      <span className="text-xs text-secondary">
                        {typeMeta(type).aggregate === "avg" ? "avg" : "total"}{" "}
                        <strong className="tabular-nums">{headline}</strong>
                      </span>
                    </div>
                    {s && s.days > 0 ? (
                      <>
                        <SeriesChart
                          data={pointsFor(t)}
                          color={t.color}
                          kind={kind}
                          title={t.name}
                          format={(v) => formatValue(v, type, t.unit)}
                          tickFormat={(v) =>
                            String(Math.round(v * 10) / 10)
                          }
                          goal={goalLineFor(t)}
                          goalLabel="goal"
                          domain={isRating ? [0, 5] : undefined}
                          height={160}
                        />
                        {s.goal && <GoalBar met={s.goal.met} total={s.goal.total} />}
                      </>
                    ) : (
                      <p className="py-8 text-center text-sm text-muted">
                        No data in this period
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
