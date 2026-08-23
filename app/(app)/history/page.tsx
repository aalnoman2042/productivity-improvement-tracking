"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCached } from "@/lib/useCached";
import PeriodCompare from "@/components/PeriodCompare";
import MotivationLine from "@/components/MotivationLine";
import NoteSearch from "@/components/NoteSearch";
import {
  WEEKDAY_INITIALS,
  addMonths,
  calendarGrid,
  formatMinutes,
  monthOf,
  monthTitle,
  prettyDate,
  toDateStr,
} from "@/lib/dates";
import {
  dayLabel,
  dayLook,
  fillOpacity,
  type MonthDay,
  type MonthSummary,
} from "@/lib/history";

/**
 * The shape of your history, a month at a time.
 *
 * The question this page exists to answer is "where did I stop?", which no
 * chart of totals can — a run of blank days averages away into the line. Here
 * a gap is a gap: an empty square you can see from across the room, and tap to
 * fill in.
 */

/** One square. Ring = you logged it, fill = how it went against your goals. */
function Day({
  date,
  day,
  trackers,
  today,
}: {
  date: string;
  day: MonthDay | undefined;
  trackers: number;
  today: string;
}) {
  const look = dayLook(day);
  const isToday = date === today;
  const future = date > today;
  const num = Number(date.slice(8));

  return (
    <Link
      href={`/?date=${date}`}
      aria-disabled={future}
      tabIndex={future ? -1 : undefined}
      title={`${prettyDate(date)} — ${future ? "not yet" : dayLabel(day, trackers)}`}
      className={`relative flex aspect-square items-center justify-center rounded-md border text-sm tabular-nums transition-transform ${
        future
          ? "pointer-events-none border-transparent text-muted opacity-30"
          : look.logged
            ? "border-accent/60 hover:scale-105"
            : "border-dashed border-edge text-muted hover:scale-105 hover:border-accent"
      } ${isToday ? "ring-2 ring-accent ring-offset-1 ring-offset-transparent" : ""}`}
    >
      {/* The fill sits behind the number so a full day stays readable. */}
      {look.logged && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-md bg-accent"
          style={{ opacity: fillOpacity(look.score) }}
        />
      )}
      <span
        className={`relative ${
          look.logged && (look.score ?? 0) >= 0.67 ? "font-semibold text-white" : ""
        }`}
      >
        {num}
      </span>
      {/* A written note is worth a mark of its own — it's the day you had
          something to say. */}
      {((day?.notes?.length ?? 0) > 0 || Boolean(day?.dayNote)) && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-500"
        />
      )}
    </Link>
  );
}

function Legend() {
  const steps = [
    { score: null as number | null, label: "no goals set" },
    { score: 0.2, label: "few met" },
    { score: 0.5, label: "some" },
    { score: 0.8, label: "most" },
    { score: 1, label: "all" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-4 rounded-md border border-dashed border-edge" />
        not logged
      </span>
      <span className="flex items-center gap-1">
        goals met
        {steps.map((s) => (
          <span
            key={s.label}
            title={s.label}
            className="h-4 w-4 rounded-md border border-accent/60 bg-accent"
            style={{ opacity: Math.max(0.14, fillOpacity(s.score)) }}
          />
        ))}
      </span>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-edge card p-3 shadow-sm">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

export default function HistoryPage() {
  const today = toDateStr(new Date());
  const [month, setMonth] = useState(() => monthOf(today));

  const q = useCached<MonthSummary>(
    `/api/entries/month?month=${month}`,
    `month:${month}`
  );
  const data = q.data;

  const byDate = useMemo(
    () => new Map((data?.days ?? []).map((d) => [d.date, d])),
    [data]
  );
  const grid = useMemo(() => calendarGrid(month), [month]);

  const thisMonth = monthOf(today);
  const atLatest = month >= thisMonth;

  const inPast = (data?.days ?? []).filter((d) => d.date <= today);
  const minutes = inPast.reduce((s, d) => s + d.minutes, 0);
  const goals = inPast.reduce(
    (acc, d) => ({ met: acc.met + d.goalsMet, total: acc.total + d.goalsTotal }),
    { met: 0, total: 0 }
  );
  // Gaps are the point of this page, so they get counted out loud.
  const missed = inPast.filter((d) => d.logged === 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-secondary">
          Every day you&apos;ve logged, and every one you haven&apos;t. Tap any
          day to fill it in.
        </p>
      </div>

      {/* Above the calendar, because "when did I write that?" is a question
          about all of it, not about the month being browsed. */}
      <NoteSearch />

      <div className="flex items-center gap-2">
        <button
          onClick={() => setMonth(addMonths(month, -1))}
          className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2"
          aria-label="Previous month"
        >
          ←
        </button>
        <div className="flex-1 text-center">
          <span className="font-semibold">{monthTitle(month)}</span>
          {q.refreshing && (
            <span className="ml-2 animate-fade-in text-xs text-muted">updating…</span>
          )}
        </div>
        <button
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={atLatest}
          className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2 disabled:opacity-30"
          aria-label="Next month"
        >
          →
        </button>
        {!atLatest && (
          <button
            onClick={() => setMonth(thisMonth)}
            className="rounded-md border border-edge px-3 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
          >
            This month
          </button>
        )}
      </div>

      {q.loading ? (
        <div className="space-y-3">
          <div className="skeleton h-72 w-full rounded-lg" aria-hidden="true" />
          <MotivationLine />
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-edge card p-3 shadow-sm sm:p-4">
            <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-muted">
              {WEEKDAY_INITIALS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((date, i) =>
                date === null ? (
                  <span key={`pad-${i}`} aria-hidden="true" />
                ) : (
                  <Day
                    key={date}
                    date={date}
                    day={byDate.get(date)}
                    trackers={data?.trackers ?? 0}
                    today={today}
                  />
                )
              )}
            </div>
            <div className="mt-4 border-t border-edge pt-3">
              <Legend />
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              value={`${data?.daysLogged ?? 0}/${inPast.length}`}
              label="days logged"
            />
            <Stat value={`${data?.bestRun ?? 0}d`} label="longest run" />
            <Stat value={formatMinutes(minutes)} label="time logged" />
            <Stat
              value={
                goals.total > 0
                  ? `${Math.round((goals.met / goals.total) * 100)}%`
                  : "—"
              }
              label="goals met"
            />
          </div>

          {/* The month against the one before it. Follows the picker above,
              so browsing back compares each month to its predecessor. */}
          <PeriodCompare period="month" anchor={month} />

          {missed > 0 && (
            <p className="text-sm text-secondary">
              <strong className="tabular-nums text-foreground">{missed}</strong>{" "}
              {missed === 1 ? "day is" : "days are"} still blank this month.
              Tapping one opens it ready to fill in.
            </p>
          )}

          {/* What you wrote this month, readable again instead of buried in
              the days it was typed on. */}
          {inPast.some((d) => (d.notes?.length ?? 0) > 0 || d.dayNote) && (
            <section className="rounded-xl border border-edge card p-4 shadow-sm">
              <h2 className="font-semibold">
                📝 Notes this month
              </h2>
              <ul className="mt-3 space-y-2">
                {inPast
                  .filter((d) => (d.notes?.length ?? 0) > 0 || d.dayNote)
                  .reverse()
                  .map((d) => (
                    <li key={d.date} className="rounded-md border border-edge bg-surface-2 p-3">
                      <Link
                        href={`/?date=${d.date}`}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {prettyDate(d.date)}
                      </Link>
                      {/* The day's own note leads — it's about the day, not
                          about one row of it. */}
                      {d.dayNote && (
                        <p className="mt-1 text-sm whitespace-pre-wrap">
                          {d.dayNote}
                        </p>
                      )}
                      <ul className="mt-1 space-y-1">
                        {d.notes.map((n, i) => (
                          <li key={i} className="text-sm">
                            <span className="text-muted">{n.tracker}:</span>{" "}
                            {n.note}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
