"use client";

import Select from "@/components/Select";
import {
  PERIODS,
  periodEnd,
  periodLabel,
  periodOptions,
  periodStart,
  shiftPeriod,
  type Period,
} from "@/lib/dates";

/**
 * Which stretch of time you're looking at — and *which one*.
 *
 * Every period here is a calendar unit, so it has a name and holds still:
 * August is August, and picking it never quietly drags a week of September in
 * behind it. That is the whole reason this control exists in two halves —
 * the row of buttons chooses the *size* of the unit, the dropdown beside it
 * chooses *which* one, and the arrows step to the neighbour without opening
 * anything.
 *
 * Changing the size keeps the day you were looking at: leaving August on
 * Month and pressing Year lands on 2026, not on this year by accident.
 *
 * `anchor` is always the first day of the chosen unit — the same identity
 * the API uses — so a parent can hand it straight to `/api/stats?anchor=`.
 */
export default function PeriodPicker({
  period,
  anchor,
  today,
  firstLogged,
  options = PERIODS,
  onChange,
}: {
  period: Period;
  anchor: string;
  today: string;
  /** The first day ever logged; the dropdown stops there. */
  firstLogged: string | null;
  /** Which sizes to offer. Defaults to all of them. */
  options?: { value: Period; label: string }[];
  onChange: (period: Period, anchor: string) => void;
}) {
  const units = periodOptions(period, firstLogged ?? today, today);
  // The unit on screen may sit outside that list — a record that starts in
  // March still has a February if you step back into it — so it is added
  // rather than silently dropped, which would leave the dropdown blank.
  const listed = units.includes(anchor)
    ? units
    : [...units, anchor].sort().reverse();

  // Today when today is inside the unit on screen; otherwise the unit itself.
  const snapFrom =
    today >= anchor && today <= periodEnd(period, anchor) ? today : anchor;

  const previous = shiftPeriod(period, anchor, -1);
  const next = shiftPeriod(period, anchor, 1);
  const canGoNext = next <= today;
  const current = periodStart(period, today);
  const isCurrent = anchor === current;

  const step = (to: string) => onChange(period, to);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-edge card p-1 shadow-sm">
        {options.map((p) => (
          <button
            key={p.value}
            type="button"
            // Snap from the day you are actually looking at, not from the
            // unit's first day. On a week that began last month — 31 Aug to
            // 6 Sep, say — snapping from the anchor sent "Month" to August,
            // silently walking the reader back a month from the current
            // week. While the unit on screen is the live one, the day to
            // snap from is today.
            onClick={() => onChange(p.value, periodStart(p.value, snapFrom))}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => step(previous)}
          aria-label="Previous period"
          className="rounded-md border border-edge px-2 py-1.5 text-sm text-secondary hover:bg-surface-2"
        >
          ‹
        </button>

        <Select
          label="Which period"
          value={anchor}
          onChange={step}
          className="min-w-[11rem]"
          buttonClassName="font-medium"
          options={listed.map((unit) => ({
            value: unit,
            label: periodLabel(period, unit),
            hint: unit === current ? "now" : undefined,
          }))}
        />

        <button
          type="button"
          onClick={() => step(next)}
          disabled={!canGoNext}
          aria-label="Next period"
          className="rounded-md border border-edge px-2 py-1.5 text-sm text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ›
        </button>

        {!isCurrent && (
          <button
            type="button"
            onClick={() => step(current)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-accent hover:bg-surface-2"
          >
            Back to now
          </button>
        )}
      </div>
    </div>
  );
}
