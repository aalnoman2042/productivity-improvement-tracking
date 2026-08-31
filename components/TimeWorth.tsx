"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNearViewport } from "@/lib/useNearViewport";
import { formatMinutes, toDateStr, type Period } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import { formatMoney, spendLine, type TimeSpend, type TimeValue } from "@/lib/timeValue";

/**
 * What your time was worth, and what you spent it on.
 *
 * This is the one card in the app that translates hours into money, and the
 * translation is the whole point: three hours a day means nothing to anybody,
 * and the same three hours priced at your own wage — every day, for a year —
 * is a number that stops you.
 *
 * It is written carefully, because a card like this is one adjective away
 * from being cruel:
 *
 * - It **never says "wasted"**. It says what the hours went to and what they
 *   were worth. The reader already knows which of those they regret.
 * - It shows the **invested** hours in the same breath as the burned ones.
 *   Totalling only the bad half is lying by omission.
 * - It prices **sleep separately and judges it not at all** — sleep is the
 *   floor the day stands on, not an hour you chose over another.
 * - Every figure is computed by the app from logged minutes and a price the
 *   reader set. Nothing here is estimated, and nothing is generated.
 *
 * Renders nothing at all until a price exists (a link to set one, and that's
 * it), like every other opt-in card here.
 */

type Payload = {
  value: TimeValue | null;
  period?: Period;
  window?: TimeSpend;
  allTime?: TimeSpend;
};

function Side({
  title,
  side,
  currency,
  tone,
}: {
  title: string;
  side: TimeSpend["burned"];
  currency: string;
  tone: string;
}) {
  if (side.minutes === 0) return null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{title}</span>
        <span className={`text-sm font-semibold tabular-nums ${tone}`}>
          {formatMinutes(side.minutes)} · {formatMoney(side.cost, currency)}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {side.rows.slice(0, 4).map((r) => (
          <li key={r.trackerId} className="flex items-baseline gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: seriesColor(r.color) }}
            />
            <span className="min-w-0 truncate text-secondary">{r.name}</span>
            <span className="ml-auto shrink-0 text-muted tabular-nums">
              {formatMinutes(r.minutes)} · {formatMoney(r.cost, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function TimeWorth({
  period,
  anchor,
}: {
  period: Period;
  /** First day of the unit being priced — the same one the page is showing. */
  anchor: string;
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  // Tagged with the window it answers, so stepping to another month shows
  // the skeleton again instead of last month's money under this month's name.
  const [answer, setAnswer] = useState<{ key: string; body: Payload } | null>(
    null
  );
  const today = toDateStr(new Date());
  const key = `${period}:${anchor}:${today}`;
  const data = answer?.key === key ? answer.body : null;

  useEffect(() => {
    if (!near) return;
    let live = true;
    fetch(`/api/stats/spend?period=${period}&anchor=${anchor}&today=${today}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: Payload) => live && setAnswer({ key, body }))
      .catch(() => live && setAnswer({ key, body: { value: null } }));
    return () => {
      live = false;
    };
  }, [near, today, period, anchor, key]);

  // Everything computed before the early returns — see npm run check:shape.
  const value = data?.value ?? null;
  const win = data?.window ?? null;
  const all = data?.allTime ?? null;
  const currency = value?.currency ?? "$";
  const hourly = value ? formatMoney(value.perMinute * 60, currency) : null;
  const share =
    win?.wakingShare != null ? Math.round(win.wakingShare * 100) : null;

  return (
    <section
      ref={ref}
      className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm"
    >
      <h2 className="font-semibold">⏳ What your time was worth</h2>

      {!data ? (
        <div className="skeleton mt-3 h-24 rounded-lg" aria-hidden="true" />
      ) : !value || !win || !all ? (
        <p className="mt-1 text-sm text-secondary">
          Put a price on an hour of your life and this card prices every hour
          you have tracked — what went into what you&apos;re building, and what
          went to the habits you&apos;d rather drop.{" "}
          <Link href="/settings" className="font-medium text-accent underline">
            Set it on the Account page
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-secondary">{spendLine(win, currency)}</p>

          <div className="mt-3 grid gap-3 border-t border-edge pt-3 sm:grid-cols-2">
            <Side
              title="Habits you'd drop"
              side={win.burned}
              currency={currency}
              tone="text-amber-700 dark:text-amber-500"
            />
            <Side
              title="What you're building"
              side={win.invested}
              currency={currency}
              tone="text-green-700 dark:text-green-500"
            />
          </div>

          {/* The scale line. One window is a number; a whole record is the
              thing that lands — and the year figure is this window's own
              pace carried forward, never a guess. */}
          <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-edge pt-3 text-center sm:grid-cols-4">
            <div>
              <dd className="text-lg font-bold tabular-nums">
                {formatMoney(win.tracked.cost, currency)}
              </dd>
              <dt className="text-xs text-muted">
                all {formatMinutes(win.tracked.minutes)} tracked
              </dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums">
                {formatMinutes(Math.round(win.perDay))}
              </dd>
              <dt className="text-xs text-muted">a day on those habits</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums">
                {formatMoney(win.perYear.cost, currency)}
              </dd>
              <dt className="text-xs text-muted">a year at this rate</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums">
                {formatMoney(all.burned.cost, currency)}
              </dd>
              <dt className="text-xs text-muted">
                since you started, over {all.days} days
              </dt>
            </div>
          </dl>

          <p className="mt-3 border-t border-edge pt-3 text-xs text-muted">
            At {hourly} an hour{share !== null && `, ${share}% of your waking hours`}
            {all.slept.minutes > 0 &&
              ` · ${formatMinutes(all.slept.minutes)} slept, and nobody should price that`}
            . This is what the time was <em>worth</em>, not money anyone took
            from you — a way to see the size of an hour, at a price you set.
          </p>
        </>
      )}
    </section>
  );
}
