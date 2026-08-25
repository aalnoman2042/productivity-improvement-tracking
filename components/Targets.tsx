"use client";

import { useEffect, useState } from "react";
import { useNearViewport } from "@/lib/useNearViewport";
import { seriesColor } from "@/lib/palette";
import { prettyDate, toDateStr } from "@/lib/dates";
import { formatValue, type TrackerType } from "@/lib/trackers";
import type { TargetProgress } from "@/lib/targets";

/**
 * The numbers being walked towards, and whether they will arrive.
 *
 * Everything else on this page judges a day. This card is the only thing in
 * the app that looks *forward*: it takes the pace you have actually kept and
 * says what date that lands on. The projection is the whole point — a bar
 * showing 40% tells you where you are, which you already knew; "at this
 * rate, 9 September" tells you whether to change something.
 *
 * It never invents one. No movement, or movement the wrong way, means no
 * date — the card says so instead of printing something reassuring.
 */

type Row = {
  trackerId: string;
  name: string;
  unit: string;
  color: string;
  type: string;
  progress: TargetProgress;
};

function verdict(p: TargetProgress): { text: string; tone: string } {
  if (p.done) return { text: "reached", tone: "text-green-700 dark:text-green-500" };
  if (p.over) return { text: "deadline passed", tone: "text-red-600" };
  if (p.projected === null) {
    return { text: "no movement yet", tone: "text-muted" };
  }
  return p.onTrack
    ? {
        text: `at this rate, ${prettyDate(p.projected)}`,
        tone: "text-green-700 dark:text-green-500",
      }
    : {
        text: `at this rate, ${prettyDate(p.projected)} — past it`,
        tone: "text-amber-700 dark:text-amber-500",
      };
}

export default function Targets() {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const [rows, setRows] = useState<Row[] | null>(null);
  const today = toDateStr(new Date());

  useEffect(() => {
    if (!near) return;
    let live = true;
    fetch(`/api/stats/targets?today=${today}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { targets: Row[] }) => live && setRows(body.targets))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [near, today]);

  // Computed before the early return — see npm run check:shape.
  const has = (rows?.length ?? 0) > 0;

  return (
    <div ref={ref}>
      {has && (
        <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
          <h2 className="font-semibold">🎯 On the way to</h2>
          <p className="mt-1 text-sm text-secondary">
            Not today&apos;s goals — the numbers with a date on them, and where
            your own pace puts them.
          </p>

          <ul className="mt-3 space-y-3">
            {rows!.map((r) => {
              const p = r.progress;
              const v = verdict(p);
              const type = r.type as TrackerType;
              return (
                <li key={r.trackerId}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(r.color) }}
                    />
                    <span className="min-w-0 font-medium">{r.name}</span>
                    <span className="text-sm text-secondary tabular-nums">
                      {formatValue(p.current, type, r.unit)} of{" "}
                      {formatValue(p.target, type, r.unit)}
                    </span>
                    <span className="ml-auto text-xs text-muted">
                      by {prettyDate(p.by)}
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                        p.done
                          ? "bg-green-700"
                          : p.onTrack === false
                            ? "bg-amber-500"
                            : "bg-brand-gradient"
                      }`}
                      style={{ width: `${p.pct}%` }}
                    />
                  </div>

                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
                    <span className={`font-medium ${v.tone}`}>{v.text}</span>
                    {!p.done && !p.over && p.needPerDay !== null && (
                      <span className="text-muted tabular-nums">
                        {/* What the remaining days each have to carry — the
                            one number that turns a deadline into a plan. */}
                        needs {formatValue(roundish(p.needPerDay), type, r.unit)} a
                        day for {Math.max(1, p.daysLeft)} days
                      </span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Enough precision to act on, not enough to pretend to. */
function roundish(n: number): number {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}
