"use client";

import { useState } from "react";
import type { Forecast, Risk } from "@/lib/healthRisk";

/**
 * The predictions, with their arithmetic one tap away.
 *
 * A percentage on a health page is the easiest thing in the world to write
 * and the hardest to trust, so every one of these carries three things the
 * reader can check: **what fed it** (the drivers, with the share each one
 * contributed), **how it was worked out** (the formula, in words), and **what
 * would move it** (calculated from this account's own numbers, not chosen
 * from a list of platitudes).
 *
 * The working is collapsed rather than hidden. Nobody wants five formulas on
 * screen at once, and a formula nobody can reach is the same as not having
 * one.
 *
 * Colour follows severity and stops at amber. Nothing on this page is a
 * diagnosis, and a red banner about somebody's back would be claiming to be.
 */

function tone(pct: number): string {
  if (pct >= 60) return "text-amber-700 dark:text-amber-500";
  if (pct >= 40) return "text-secondary";
  return "text-green-700 dark:text-green-500";
}

function bar(pct: number): string {
  if (pct >= 60) return "bg-amber-500";
  if (pct >= 40) return "bg-accent";
  return "bg-green-600";
}

const CONFIDENCE: Record<Risk["confidence"], string> = {
  good: "read from most of the window",
  fair: "read from part of the window",
  low: "read from very few days — direction only",
};

function RiskCard({ risk }: { risk: Risk }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="flex flex-col rounded-xl border border-edge bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            <span aria-hidden className="mr-1.5">
              {risk.icon}
            </span>
            {risk.label}
          </p>
          <p className="mt-1 text-sm text-secondary">{risk.headline}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-2xl font-bold tabular-nums ${tone(risk.pct)}`}>
            {risk.pct}
            <span className="text-sm font-normal">%</span>
          </p>
          <p className="text-xs text-muted">{risk.band}</p>
        </div>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full ${bar(risk.pct)}`}
          style={{ width: `${risk.pct}%` }}
        />
      </div>

      <p className="mt-3 text-sm">
        <span className="font-medium">Do this: </span>
        <span className="text-secondary">{risk.lever}</span>
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs font-medium text-accent underline underline-offset-2"
      >
        {open ? "Hide the working" : "Show the working"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-edge bg-surface p-3">
          <ul className="space-y-2">
            {risk.drivers.map((d) => (
              <li key={d.label}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{d.label}</span>
                  <span className="text-secondary tabular-nums">{d.value}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${d.share < 0 ? "bg-green-600" : "bg-amber-500"}`}
                    style={{ width: `${Math.min(100, Math.abs(d.share) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{risk.math}</p>
          <p className="text-xs text-muted">
            Confidence: {CONFIDENCE[risk.confidence]}.
          </p>
        </div>
      )}
    </li>
  );
}

export default function HealthRisks({
  risks,
  forecasts,
  caveat,
}: {
  risks: Risk[];
  forecasts: Forecast[];
  caveat: string;
}) {
  if (risks.length === 0 && forecasts.length === 0) return null;

  return (
    <>
      {risks.length > 0 && (
        <section className="rounded-2xl border border-edge card p-5 shadow-md">
          <h2 className="font-semibold">What the log predicts</h2>
          <p className="mt-1 text-sm text-secondary">{caveat}</p>
          {/* Two across from md up. Each card is self-contained — a heading,
              a number, a bar and a lever — so they tile without the reader
              losing which working belongs to which claim. */}
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {risks.map((r) => (
              <RiskCard key={r.id} risk={r} />
            ))}
          </ul>
        </section>
      )}

      {forecasts.length > 0 && (
        <section className="rounded-2xl border border-edge card p-5 shadow-md">
          <h2 className="font-semibold">If nothing changes</h2>
          <p className="mt-1 text-sm text-secondary">
            Straight lines through what you have logged. A projection is a
            description of the present tense — the only thing it genuinely
            proves is which way the last few weeks pointed.
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {forecasts.map((f) => (
              <li key={f.id} className="rounded-xl border border-edge bg-surface-2 p-4">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  <span aria-hidden className="mr-1">
                    {f.icon}
                  </span>
                  {f.label}
                </p>
                <p
                  className={`mt-1 font-semibold ${
                    f.direction === "good"
                      ? "text-green-700 dark:text-green-500"
                      : f.direction === "watch"
                        ? "text-amber-700 dark:text-amber-500"
                        : ""
                  }`}
                >
                  {f.headline}
                </p>
                <p className="mt-1 text-sm text-secondary">{f.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
