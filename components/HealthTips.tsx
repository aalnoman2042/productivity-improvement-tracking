"use client";

import type { ReadyTip } from "@/lib/healthTips";

/**
 * What to actually do, ranked by what it is currently costing.
 *
 * Every tip carries the numbers it came from. That is the whole difference
 * between this list and the generic wellness advice everybody has already
 * ignored: "drink more water" is a poster, and "you are 3 glasses a day short
 * of the 8 your body weight works out to" is a fact about a Tuesday.
 *
 * The list is capped by `tipsFor`, not here — the honest number of things
 * worth changing at once is about three, and a screen of twenty is the same
 * as a screen of none.
 *
 * The first one is drawn larger because it is the one that matters. The rest
 * are there so the ranking can be argued with rather than taken on trust.
 */
export default function HealthTips({ tips }: { tips: ReadyTip[] }) {
  if (tips.length === 0) return null;

  const [first, ...rest] = tips;

  return (
    <section className="rounded-2xl border border-edge card p-5 shadow-md">
      <h2 className="font-semibold">What to change first</h2>
      <p className="mt-1 text-sm text-secondary">
        Ranked by what each one is costing you right now, not by how easy it is
        to say. Every line here is attached to a number above it.
      </p>

      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <p className="text-xs font-medium tracking-wide text-accent uppercase">
          <span aria-hidden className="mr-1">
            {first.icon}
          </span>
          {first.topic} · start here
        </p>
        <p className="mt-1 text-lg font-semibold">{first.title}</p>
        <p className="mt-2 text-sm text-secondary">{first.why}</p>
        <p className="mt-2 text-sm">
          <span className="font-medium">First step: </span>
          <span className="text-secondary">{first.how}</span>
        </p>
      </div>

      {/* The first tip stays full width because it is the one to act on. The
          rest tile — they are there so the ranking can be argued with, not so
          each gets a screen of its own. */}
      {rest.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {rest.map((tip) => (
            <li key={tip.id} className="rounded-lg border border-edge bg-surface-2 p-3">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">
                <span aria-hidden className="mr-1">
                  {tip.icon}
                </span>
                {tip.topic}
              </p>
              <p className="mt-0.5 font-medium">{tip.title}</p>
              <p className="mt-1 text-sm text-secondary">{tip.why}</p>
              <p className="mt-1 text-sm text-secondary">
                <span className="font-medium">First step: </span>
                {tip.how}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
