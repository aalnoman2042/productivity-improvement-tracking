"use client";

import { useCached } from "@/lib/useCached";
import { formatMinutes, monthTitle, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import type { MonthChange } from "@/lib/monthCompare";

/**
 * This month against the last one.
 *
 * The report card grades a lifetime, the coach reads a fortnight, the
 * calendar above shows where the gaps are — and none of them answer "is this
 * a better month than the last one?", which is the question people actually
 * carry around. It follows the month picker, so browsing back through the
 * year compares each month to the one before it.
 *
 * The card is deliberately quiet about certainty: it shows both numbers and
 * the movement between them, and leaves the reader to decide what it means.
 * The only judgement it makes is tone — green for a change in the direction
 * this tracker wants, amber against — and that comes from `lib/direction`,
 * the same rule the coach and the Patterns card use.
 */

type Compare = {
  month: string;
  previous: string;
  days: number;
  partial: boolean;
  headline: {
    daysLogged: { now: number; before: number };
    minutes: { now: number; before: number };
    goals: { now: number | null; before: number | null };
  };
  trackers: MonthChange[];
};

const TONE: Record<string, string> = {
  better: "text-green-700 dark:text-green-500",
  worse: "text-amber-700 dark:text-amber-500",
};

function Headline({
  label,
  now,
  before,
}: {
  label: string;
  now: string;
  before: string;
}) {
  return (
    <div className="rounded-md border border-edge bg-surface-2 p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-sm">
        <span className="text-muted tabular-nums">{before}</span>
        <span aria-hidden="true" className="text-muted">
          →
        </span>
        <strong className="tabular-nums">{now}</strong>
      </div>
    </div>
  );
}

export default function MonthCompare({ month }: { month: string }) {
  const today = toDateStr(new Date());
  const q = useCached<Compare>(
    `/api/stats/months?month=${month}&today=${today}`,
    `months:${month}`
  );
  const data = q.data;

  if (!data) return null;

  const { headline } = data;
  const moved = data.trackers.filter((t) => t.pct !== null);
  // Nothing to compare against is not a comparison — say so once, plainly,
  // rather than drawing a card full of "nothing either month".
  if (moved.length === 0) {
    return (
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">📅 {monthTitle(month)} vs {monthTitle(data.previous)}</h2>
        <p className="mt-1 text-sm text-secondary">
          Not enough on record in {monthTitle(data.previous)} to compare
          against yet. Next month this fills in.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">
        📅 {monthTitle(month)} vs {monthTitle(data.previous)}
      </h2>
      <p className="mt-1 text-sm text-secondary">
        {data.partial
          ? `The first ${data.days} days of each month, so a month still running isn't judged against a finished one.`
          : `All ${data.days} days against the same stretch of ${monthTitle(data.previous)}.`}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Headline
          label="Days logged"
          now={`${headline.daysLogged.now}`}
          before={`${headline.daysLogged.before}`}
        />
        <Headline
          label="Time logged"
          now={formatMinutes(headline.minutes.now)}
          before={formatMinutes(headline.minutes.before)}
        />
        <Headline
          label="Goals met"
          now={headline.goals.now === null ? "—" : `${Math.round(headline.goals.now * 100)}%`}
          before={
            headline.goals.before === null
              ? "—"
              : `${Math.round(headline.goals.before * 100)}%`
          }
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {moved.map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seriesColor(t.color) }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate font-medium">{t.name}</span>
            <span className="text-muted tabular-nums">
              {t.before} → {t.now}
            </span>
            <span className="text-xs text-muted">{t.basis}</span>
            <span
              className={`ml-auto text-xs font-medium tabular-nums ${
                TONE[t.readsAs ?? ""] ?? "text-muted"
              }`}
            >
              {t.change}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
