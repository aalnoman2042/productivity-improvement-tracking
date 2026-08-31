"use client";

import { bucketOf, prettyDate } from "@/lib/dates";
import { FIRST, goalSpans } from "@/lib/goalHistory";
import { formatValue, type Tracker, type TrackerType } from "@/lib/trackers";

/**
 * Every promise you have made about this tracker, and how each one went.
 *
 * The point is that they are kept **apart**. One blended "goals met: 68%"
 * across a stretch where the target moved says nothing about either target:
 * a fortnight at 2 hours a day that you kept, followed by a fortnight at 5
 * that you didn't, is not a 68% anything — it is one promise kept and one
 * promise overreached, and those are different facts with different lessons.
 * Read as a list, the shape of a commitment shows up: how long each one
 * lasted, whether raising the bar broke the run, and where the level you can
 * actually hold sits.
 *
 * Nothing is invented. Each row counts only the days inside its own span,
 * against the goal that was in force during it (`lib/goalHistory.ts`), and a
 * day nobody logged is a day the goal was not met — the same rule the rest
 * of the app uses, said out loud in the footnote.
 */

type Row = { date: string; value: number };

export default function Commitments({
  tracker,
  entries,
  today,
}: {
  tracker: Tracker;
  /** Every entry ever logged for this tracker, oldest first. */
  entries: Row[];
  today: string;
}) {
  const spans = goalSpans(tracker.goalHistory, tracker.goal);
  const type = tracker.type as TrackerType;

  // A tracker whose goal has never changed has exactly one span, and the
  // card would just be the goal line that is already in the header.
  const worthShowing = spans.filter((s) => s.goal !== null).length > 1;

  const byDate = new Map(entries.map((e) => [e.date, e.value]));
  const first = entries[0]?.date ?? today;

  const rows = spans.map((span) => {
    // A span reaching back before the record starts is clamped to the first
    // day logged — counting the years before this tracker existed as days
    // the goal was missed would be a lie with a percentage on it.
    const from = span.from === FIRST || span.from < first ? first : span.from;
    const to = span.to && span.to < today ? span.to : today;
    const goal = span.goal;

    let met = 0;
    let total = 0;
    if (goal && from <= to) {
      if (goal.period === "day") {
        for (let d = from; d <= to; d = nextDay(d)) {
          total++;
          const v = byDate.get(d) ?? 0;
          if (goal.direction === "min" ? v >= goal.target : v <= goal.target) met++;
        }
      } else {
        const weekly = new Map<string, number>();
        for (let d = from; d <= to; d = nextDay(d)) {
          const wk = bucketOf(d, "week");
          weekly.set(wk, (weekly.get(wk) ?? 0) + (byDate.get(d) ?? 0));
        }
        for (const sum of weekly.values()) {
          total++;
          if (goal.direction === "min" ? sum >= goal.target : sum <= goal.target) met++;
        }
      }
    }
    return { span, from, to, goal, met, total };
  });

  if (!worthShowing) return null;

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <h2 className="font-semibold">🤝 What you committed to</h2>
      <p className="mt-1 text-sm text-secondary">
        Each goal you set is judged on its own days, at the target that was
        actually in force then. Raising the bar never turns a week you kept
        into a week you failed.
      </p>

      <ul className="mt-3 space-y-2">
        {rows
          .slice()
          .reverse()
          .map((r) => {
            const pct = r.total > 0 ? Math.round((r.met / r.total) * 100) : null;
            const live = r.span.to === null;
            return (
              <li
                key={r.span.from}
                className={`rounded-lg border p-3 ${
                  live ? "border-accent/40 bg-accent/5" : "border-edge"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">
                    {r.goal
                      ? `${r.goal.direction === "min" ? "At least" : "At most"} ${formatValue(
                          r.goal.target,
                          type,
                          tracker.unit
                        )} / ${r.goal.period}`
                      : "No goal"}
                    {live && (
                      <span className="ml-2 text-xs font-normal text-accent">
                        now
                      </span>
                    )}
                  </span>
                  {r.goal && pct !== null && (
                    <span className="text-sm font-semibold tabular-nums">
                      {r.met}/{r.total}
                      <span className="ml-1 text-xs font-normal text-muted">
                        · {pct}%
                      </span>
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-xs text-muted">
                  {r.span.from === FIRST || r.span.from < r.from
                    ? `From the start of the record`
                    : prettyDate(r.from)}
                  {" – "}
                  {live ? "now" : prettyDate(r.to)}
                </p>

                {r.goal && pct !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="bg-brand-gradient h-full rounded-full transition-[width] duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
      </ul>

      <p className="mt-3 text-xs text-muted">
        A day with nothing logged counts as a day the goal wasn&apos;t met —
        the same rule as everywhere else here.
      </p>
    </section>
  );
}

/** Local, so this file doesn't drag a date module in for one line. */
function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
    next.getDate()
  ).padStart(2, "0")}`;
}
