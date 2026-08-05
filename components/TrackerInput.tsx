"use client";

import Timer from "@/components/Timer";
import { EMPTY, digits, isLogged, type Draft } from "@/lib/draft";
import type { Prefill } from "@/lib/prefill";
import {
  PRAYERS,
  PRAYER_KEYS,
  formatValue,
  minutesBetween,
  orderPrayers,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

/**
 * The controls for one tracker, whatever kind it is.
 *
 * Lifted out of the daily log so the quick log can use exactly the same
 * inputs at a larger size — two ways of typing the same day should not be two
 * implementations of what a "count" or a "streak" means.
 */

export type InputSize = "row" | "large";

export default function TrackerInput({
  tracker,
  draft,
  set,
  date,
  onTimerSaved,
  size = "row",
  prefill,
}: {
  tracker: Tracker;
  draft: Draft | undefined;
  set: (id: string, patch: Partial<Draft>) => void;
  date: string;
  /** The stopwatch writes straight to the server, so the page must re-read. */
  onTimerSaved?: () => void | Promise<void>;
  size?: InputSize;
  /** The usual answer, offered as one tap while the row is still empty. */
  prefill?: Prefill;
}) {
  const t = tracker;
  const dr = draft ?? EMPTY;
  const type = t.type as TrackerType;
  const big = size === "large";

  // The offer disappears the moment anything real is entered — it's a way to
  // skip typing, not a value competing with what you typed.
  const offer = prefill && !isLogged(type, dr) ? prefill : null;
  const offerChip = offer ? (
    <button
      type="button"
      onClick={() => set(t.id, offer.patch)}
      className={`rounded-full border border-dashed border-edge text-muted transition-colors hover:border-accent hover:text-accent ${
        big ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-xs"
      }`}
      title={`Fill in: ${offer.label}`}
    >
      ↺ {offer.label}
    </button>
  ) : null;

  const field = `rounded-md border border-edge bg-transparent outline-none focus:border-accent ${
    big ? "px-3 py-3 text-lg text-center" : "px-2 py-1.5 text-right"
  }`;
  // Big enough to hit with a thumb in the quick log, compact in the list.
  const cell = big ? "h-12 w-12 text-base" : "h-7 w-7 text-sm";
  const chip = big
    ? "px-4 py-3 text-base font-medium"
    : "px-2.5 py-1.5 text-sm font-medium";
  const wrap = `flex flex-wrap items-center gap-2 ${
    big ? "justify-center" : "justify-end"
  }`;

  if (type === "duration") {
    return (
      <div
        className={`flex flex-wrap items-center gap-1.5 ${
          big ? "justify-center" : "justify-end"
        }`}
      >
        {offerChip}
        <Timer
          trackerId={t.id}
          date={date}
          onSaved={() => void onTimerSaved?.()}
        />
        <input
          inputMode="numeric"
          placeholder={offer?.patch.h || "0"}
          value={dr.h}
          onChange={(e) => set(t.id, { h: digits(e.target.value, 2) })}
          className={`${field} ${big ? "w-16" : "w-12"}`}
          aria-label={`${t.name} hours`}
        />
        <span className={big ? "text-base text-muted" : "text-sm text-muted"}>h</span>
        <input
          inputMode="numeric"
          placeholder={offer?.patch.m || "0"}
          value={dr.m}
          onChange={(e) => set(t.id, { m: digits(e.target.value, 3) })}
          className={`${field} ${big ? "w-16" : "w-12"}`}
          aria-label={`${t.name} minutes`}
        />
        <span className={big ? "text-base text-muted" : "text-sm text-muted"}>m</span>
      </div>
    );
  }

  if (type === "sleep") {
    const mins = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
    return (
      <div className={wrap}>
        {offerChip}
        <label className="flex items-center gap-1 text-sm text-muted">
          Slept
          <input
            type="time"
            value={dr.start}
            onChange={(e) => set(t.id, { start: e.target.value })}
            className={`${field} text-center`}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-muted">
          Woke
          <input
            type="time"
            value={dr.end}
            onChange={(e) => set(t.id, { end: e.target.value })}
            className={`${field} text-center`}
          />
        </label>
        {mins > 0 && (
          <span className="rounded-md bg-surface-2 px-2 py-1 text-sm font-medium tabular-nums">
            {formatValue(mins, "sleep", "min")}
          </span>
        )}
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set(t.id, { quality: dr.quality === n ? null : n })}
              className={`rounded-md border ${cell} ${
                (dr.quality ?? 0) >= n
                  ? "border-accent bg-accent text-white"
                  : "border-edge text-muted hover:bg-surface-2"
              }`}
              title={`Sleep quality ${n}/5`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (type === "prayer") {
    const done = new Set(dr.parts);
    const all = done.size === PRAYERS.length;
    return (
      <div className={`flex flex-wrap items-center gap-1 ${big ? "justify-center" : "justify-end"}`}>
        {PRAYERS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={done.has(p.key)}
            onClick={() =>
              set(t.id, {
                parts: orderPrayers(
                  done.has(p.key)
                    ? dr.parts.filter((k) => k !== p.key)
                    : [...dr.parts, p.key]
                ),
              })
            }
            className={
              done.has(p.key)
                ? `rounded-md border border-green-700 bg-green-700 text-white ${chip}`
                : `rounded-md border border-edge text-secondary hover:bg-surface-2 ${chip}`
            }
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => set(t.id, { parts: all ? [] : [...PRAYER_KEYS] })}
          className={`rounded-md border border-edge text-muted hover:bg-surface-2 ${chip}`}
        >
          {all ? "Clear" : "All 5"}
        </button>
        <span className="ml-1 text-sm font-medium tabular-nums text-secondary">
          {done.size}/5
        </span>
      </div>
    );
  }

  if (type === "streak") {
    return (
      <div className={`flex items-center gap-1.5 ${big ? "justify-center" : ""}`}>
        <button
          type="button"
          onClick={() => set(t.id, { status: dr.status === "clean" ? null : "clean" })}
          className={`rounded-md border ${chip} ${
            dr.status === "clean"
              ? "border-green-700 bg-green-700 text-white"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          ✓ Clean
        </button>
        <button
          type="button"
          onClick={() => set(t.id, { status: dr.status === "slip" ? null : "slip" })}
          className={`rounded-md border ${chip} ${
            dr.status === "slip"
              ? "border-red-600 bg-red-600 text-white"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          Slipped
        </button>
      </div>
    );
  }

  if (type === "count") {
    const n = parseFloat(dr.num) || 0;
    return (
      <div
        className={`flex flex-wrap items-center gap-1.5 ${
          big ? "justify-center" : "justify-end"
        }`}
      >
        {offerChip}
        <button
          type="button"
          onClick={() => set(t.id, { num: String(Math.max(0, n - 1)) })}
          className={`rounded-md border border-edge leading-none hover:bg-surface-2 ${
            big ? "h-12 w-12 text-2xl" : "h-8 w-8 text-lg"
          }`}
          aria-label={`Decrease ${t.name}`}
        >
          −
        </button>
        <input
          inputMode="numeric"
          placeholder={offer?.patch.num || "0"}
          value={dr.num}
          onChange={(e) => set(t.id, { num: digits(e.target.value, 4) })}
          className={`${field} text-center ${big ? "w-20" : "w-14"}`}
          aria-label={t.name}
        />
        <button
          type="button"
          onClick={() => set(t.id, { num: String(n + 1) })}
          className={`rounded-md border border-edge leading-none hover:bg-surface-2 ${
            big ? "h-12 w-12 text-2xl" : "h-8 w-8 text-lg"
          }`}
          aria-label={`Increase ${t.name}`}
        >
          +
        </button>
        {t.unit && (
          <span className={big ? "text-base text-muted" : "text-sm text-muted"}>
            {t.unit}
          </span>
        )}
      </div>
    );
  }

  if (type === "scale") {
    const current = parseFloat(dr.num) || 0;
    return (
      <div className={`flex items-center gap-1 ${big ? "justify-center" : ""}`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => set(t.id, { num: current === n ? "" : String(n) })}
            className={`rounded-md border ${big ? "h-12 w-12 text-base" : "h-8 w-8 text-sm"} ${
              current === n
                ? "border-accent bg-accent text-white"
                : "border-edge text-secondary hover:bg-surface-2"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  if (type === "check") {
    return (
      <div className={big ? "flex justify-center" : ""}>
        <button
          type="button"
          onClick={() => set(t.id, { checked: !dr.checked })}
          className={`rounded-md border ${big ? "px-8 py-3 text-base font-medium" : "px-4 py-1.5 text-sm font-medium"} ${
            dr.checked
              ? "border-green-700 bg-green-700 text-white"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          {dr.checked ? "✓ Done" : "Mark done"}
        </button>
      </div>
    );
  }

  // measure
  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        big ? "justify-center" : "justify-end"
      }`}
    >
      {offerChip}
      <input
        inputMode="decimal"
        placeholder={offer?.patch.num || "0"}
        value={dr.num}
        onChange={(e) =>
          set(t.id, { num: e.target.value.replace(/[^0-9.]/g, "").slice(0, 7) })
        }
        className={`${field} ${big ? "w-28" : "w-20"}`}
        aria-label={t.name}
      />
      {t.unit && (
        <span className={big ? "text-base text-muted" : "text-sm text-muted"}>
          {t.unit}
        </span>
      )}
    </div>
  );
}
