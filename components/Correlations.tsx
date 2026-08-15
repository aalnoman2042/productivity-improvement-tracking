"use client";

import { useCached } from "@/lib/useCached";
import { toDateStr } from "@/lib/dates";
import type { Finding } from "@/lib/correlate";

type Response = {
  findings: Finding[];
  ready: boolean;
  days: number;
  minDays: number;
  qualifying: number;
};

const TONE: Record<Finding["tone"], { bar: string; icon: string }> = {
  bad: { bar: "bg-red-600", icon: "↓" },
  good: { bar: "bg-green-700", icon: "↑" },
  neutral: { bar: "bg-accent", icon: "→" },
};

/**
 * The impact score in words — a number would invite false precision. Old
 * cached responses pre-date the score and fall back to raw strength.
 */
function impactLabel(f: Finding): string {
  const impact = f.impact ?? f.strength;
  if (impact >= 0.45) return "strong link";
  if (impact >= 0.25) return "clear link";
  return "early signal";
}

/**
 * What goes with what.
 *
 * The one thing here a spreadsheet doesn't do more easily, because it knows
 * *your* trackers. Everything is phrased as an association and never as a
 * cause — the footnote saying so is not boilerplate, it's the honest limit of
 * what a daily grid of self-reported numbers can establish.
 */
export default function Correlations() {
  const q = useCached<Response>(
    `/api/insights/correlations?today=${toDateStr(new Date())}`,
    "correlations"
  );
  const data = q.data;

  // Nothing to say yet and nothing worth a placeholder — the dashboard has
  // plenty else on it.
  if (q.loading || !data) return null;

  if (!data.ready) {
    return (
      <section className="rounded-lg border border-dashed border-edge p-5 text-center">
        <h2 className="text-sm font-semibold">Patterns</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          Once two trackers have {data.minDays} days of history each, this looks
          for what moves with what — late nights against short sleep, the
          weekday a habit keeps falling over on.
          {data.qualifying === 1 && " One tracker is there already."}
        </p>
      </section>
    );
  }

  if (data.findings.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-edge p-5 text-center">
        <h2 className="text-sm font-semibold">Patterns</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          Nothing stands out across the last {data.days} days — no two trackers
          move together strongly enough to be worth reporting. That&apos;s a
          real answer, not a missing one.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-lg font-semibold">What goes with what</h2>
        <span className="text-xs text-muted">
          from the last {data.days} days
        </span>
      </div>
      <p className="mb-3 text-sm text-secondary">
        Where two of your trackers move together. The most impactful first —
        judged by how strongly they move, how big the difference is, and how
        many days back it up.
      </p>

      <ul className="stagger space-y-2">
        {data.findings.map((f, i) => {
          const tone = TONE[f.tone];
          return (
            <li
              key={i}
              className="flex gap-3 overflow-hidden rounded-xl border border-edge card shadow-sm"
            >
              <span className={`w-1 shrink-0 ${tone.bar}`} aria-hidden="true" />
              <div className="min-w-0 flex-1 py-3 pr-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">
                    <span className="mr-1 text-muted" aria-hidden="true">
                      {tone.icon}
                    </span>
                    {f.title}
                  </p>
                  <span className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {impactLabel(f)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-secondary">{f.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs text-muted">
        These are associations, not causes — two things moving together can
        share a third explanation, and a short stretch of days can agree by
        chance. Read them as somewhere to look.
      </p>
    </section>
  );
}
