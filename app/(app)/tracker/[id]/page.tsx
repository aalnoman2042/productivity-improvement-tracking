"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCached } from "@/lib/useCached";
import { calendarGrid, monthOf, addMonths, monthTitle, prettyDate, toDateStr, WEEKDAY_INITIALS } from "@/lib/dates";
import { MILESTONES, reached } from "@/lib/milestones";
import { streakInfo } from "@/lib/streak";
import { seriesColor } from "@/lib/palette";
import {
  categoryMeta,
  formatValue,
  typeMeta,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

/**
 * One habit's whole story. History shows a month of everything and the
 * dashboard shows a period of everything — this is the one place a single
 * tracker gets: every month since it started, its streak, its best days,
 * and every note ever written on it.
 */

type HistEntry = {
  date: string;
  value: number;
  note: string | null;
  meta: { status?: string | null } | null;
};

type Payload = { tracker: Tracker; entries: HistEntry[] };

const monthShort = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${NAMES[mm - 1]} ${String(y).slice(2)}`;
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-edge card p-3 shadow-sm">
      <p className="text-xs text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A month of squares, shaded by how each logged day went. */
function MiniMonth({
  month,
  entries,
  tracker,
  today,
}: {
  month: string;
  entries: Map<string, HistEntry>;
  tracker: Tracker;
  today: string;
}) {
  const grid = calendarGrid(month);
  const goal = tracker.goal;

  const shade = (e: HistEntry | undefined): number => {
    if (!e || (e.value <= 0 && !e.meta)) return 0;
    if (!goal || goal.period !== "day") return 0.65;
    const met =
      goal.direction === "min" ? e.value >= goal.target : e.value <= goal.target;
    return met ? 0.95 : 0.35;
  };

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-secondary">
        {monthTitle(month)}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_INITIALS.map((d, i) => (
          <span key={`h-${i}`} className="text-center text-[10px] text-muted">
            {d}
          </span>
        ))}
        {grid.map((date, i) => {
          if (date === null) return <span key={`p-${i}`} aria-hidden="true" />;
          const e = entries.get(date);
          const opacity = shade(e);
          const future = date > today;
          return (
            <Link
              key={date}
              href={`/?date=${date}`}
              aria-disabled={future}
              tabIndex={future ? -1 : undefined}
              title={`${prettyDate(date)}${
                e
                  ? ` — ${formatValue(e.value, tracker.type as TrackerType, tracker.unit)}`
                  : " — nothing logged"
              }`}
              className={`relative aspect-square rounded-sm border ${
                future
                  ? "pointer-events-none border-transparent opacity-20"
                  : opacity > 0
                    ? "border-accent/40"
                    : "border-dashed border-edge"
              }`}
            >
              {opacity > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-sm bg-accent"
                  style={{ opacity }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function TrackerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const today = toDateStr(new Date());
  const [noteQuery, setNoteQuery] = useState("");

  const q = useCached<Payload>(
    `/api/trackers/${id}/history`,
    `tracker:${id}:history`
  );
  const tracker = q.data?.tracker ?? null;
  const entries = useMemo(() => q.data?.entries ?? [], [q.data]);

  const type = (tracker?.type ?? "count") as TrackerType;
  const aggregate = typeMeta(type).aggregate;

  const logged = useMemo(
    () => entries.filter((e) => e.value > 0 || e.meta),
    [entries]
  );
  const byDate = useMemo(
    () => new Map(logged.map((e) => [e.date, e])),
    [logged]
  );

  const totals = useMemo(() => {
    const days = logged.length;
    const sum = logged.reduce((s, e) => s + e.value, 0);
    let best: HistEntry | null = null;
    for (const e of logged) if (!best || e.value > best.value) best = e;
    return { days, sum, best, first: entries[0]?.date ?? null };
  }, [logged, entries]);

  const streak = useMemo(() => {
    if (type !== "streak" || entries.length === 0) return null;
    return streakInfo(
      entries[0].date,
      entries.filter((e) => e.value <= 0).map((e) => e.date),
      today
    );
  }, [type, entries, today]);

  // Milestones are counted on days *logged* — showing up is the habit.
  const hit = reached(totals.days);

  const monthly = useMemo(() => {
    const buckets = new Map<string, { sum: number; days: number }>();
    for (const e of logged) {
      const m = monthOf(e.date);
      const b = buckets.get(m) ?? { sum: 0, days: 0 };
      b.sum += e.value;
      b.days += 1;
      buckets.set(m, b);
    }
    const months = [...buckets.keys()].sort().slice(-12);
    const rows = months.map((m) => {
      const b = buckets.get(m)!;
      return { month: m, value: aggregate === "sum" ? b.sum : b.sum / b.days, days: b.days };
    });
    const max = Math.max(1, ...rows.map((r) => r.value));
    return { rows, max };
  }, [logged, aggregate]);

  const recentMonths = useMemo(() => {
    const current = monthOf(today);
    return [addMonths(current, -2), addMonths(current, -1), current];
  }, [today]);

  const notes = useMemo(() => {
    const all = entries.filter((e) => e.note).reverse();
    const needle = noteQuery.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (e) =>
        e.note!.toLowerCase().includes(needle) || e.date.includes(needle)
    );
  }, [entries, noteQuery]);

  if (q.loading && !q.data) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <div className="skeleton h-10 rounded-lg" aria-hidden="true" />
        <div className="skeleton h-24 rounded-lg" aria-hidden="true" />
        <div className="skeleton h-64 rounded-lg" aria-hidden="true" />
      </div>
    );
  }

  if (!tracker) {
    return (
      <p className="mx-auto max-w-xl rounded-xl border border-edge card p-4 shadow-sm text-sm text-muted">
        This tracker doesn&apos;t exist (or isn&apos;t yours).{" "}
        <Link href="/trackers" className="font-medium text-accent underline">
          Back to trackers
        </Link>
      </p>
    );
  }

  const cat = categoryMeta(tracker.category);
  const goalText = tracker.goal
    ? `${tracker.goal.direction === "min" ? "At least" : "At most"} ${formatValue(
        tracker.goal.target,
        type,
        tracker.unit
      )} per ${tracker.goal.period}`
    : null;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <span
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: seriesColor(tracker.color) }}
          />
          <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight">
            {tracker.name}
          </h1>
          {tracker.archived && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
              archived
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-secondary">
          {cat.icon} {cat.label} · {typeMeta(type).label}
          {goalText && <> · {goalText}</>}
          {" · "}
          <Link href="/trackers" className="text-accent hover:underline">
            edit
          </Link>
        </p>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-3 gap-2">
        <Tile
          label="Days logged"
          value={String(totals.days)}
          hint={totals.first ? `since ${prettyDate(totals.first)}` : undefined}
        />
        {streak ? (
          <Tile
            label="Clean streak"
            value={`${streak.current}d`}
            hint={`best ${streak.best}d · ${streak.slips} slip${streak.slips === 1 ? "" : "s"}`}
          />
        ) : (
          <Tile
            label={aggregate === "sum" ? "All-time total" : "Average"}
            value={formatValue(
              aggregate === "sum"
                ? totals.sum
                : totals.days > 0
                  ? totals.sum / totals.days
                  : 0,
              type,
              tracker.unit
            )}
          />
        )}
        <Tile
          label="Best day"
          value={
            totals.best
              ? formatValue(totals.best.value, type, tracker.unit)
              : "—"
          }
          hint={totals.best ? prettyDate(totals.best.date) : undefined}
        />
      </div>

      {/* Milestones on showing up */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">Milestones:</span>
        {MILESTONES.map((m) => (
          <span
            key={m}
            className={`rounded-full border px-2.5 py-1 font-medium tabular-nums ${
              hit !== null && m <= hit
                ? "border-green-700/40 bg-green-700/10 text-green-700 dark:text-green-500"
                : "border-edge text-muted"
            }`}
          >
            {hit !== null && m <= hit ? "✓ " : ""}
            {m} days
          </span>
        ))}
      </div>

      {/* The long arc, month by month */}
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">Month by month</h2>
        <p className="mt-1 text-sm text-secondary">
          {aggregate === "sum" ? "Total" : "Average"} per month, up to the last
          twelve.
        </p>
        {monthly.rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {monthly.rows.map((r) => (
              <li key={r.month} className="flex items-center gap-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted tabular-nums">
                  {monthShort(r.month)}
                </span>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-2">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(2, Math.round((r.value / monthly.max) * 100))}%`,
                      backgroundColor: seriesColor(tracker.color),
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-secondary">
                  {formatValue(r.value, type, tracker.unit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The last three months, day by day */}
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">Day by day</h2>
        <p className="mt-1 text-sm text-secondary">
          {tracker.goal?.period === "day"
            ? "Deep fill hit the goal, light fill fell short. Tap a day to open it."
            : "Filled squares are logged days. Tap one to open it."}
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {recentMonths.map((m) => (
            <MiniMonth
              key={m}
              month={m}
              entries={byDate}
              tracker={tracker}
              today={today}
            />
          ))}
        </div>
      </section>

      {/* Every note, findable again */}
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Notes</h2>
          <span className="text-xs text-muted">
            {entries.filter((e) => e.note).length} on record
          </span>
        </div>
        {entries.some((e) => e.note) ? (
          <>
            <input
              type="search"
              value={noteQuery}
              onChange={(e) => setNoteQuery(e.target.value)}
              placeholder="Search notes…"
              className="mt-3 w-full rounded-md border border-edge bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <ul className="mt-3 space-y-2">
              {notes.map((e) => (
                <li key={e.date} className="rounded-md border border-edge bg-surface-2 p-3">
                  <Link
                    href={`/?date=${e.date}`}
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    {prettyDate(e.date)}
                  </Link>
                  <p className="mt-1 text-sm">{e.note}</p>
                </li>
              ))}
              {notes.length === 0 && (
                <li className="text-sm text-muted">No notes match.</li>
              )}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">
            None yet — notes you add on the daily log show up here, searchable.
          </p>
        )}
      </section>
    </div>
  );
}
