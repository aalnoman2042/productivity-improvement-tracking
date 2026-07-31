"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Timer from "@/components/Timer";
import { cacheSet, getCached, post } from "@/lib/sync";
import { addDays, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import {
  categoryMeta,
  formatValue,
  minutesBetween,
  orderCategories,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

type Draft = {
  h: string;
  m: string;
  num: string;
  start: string;
  end: string;
  quality: number | null;
  checked: boolean;
};

type Entry = {
  trackerId: string;
  value: number;
  meta: { start?: string | null; end?: string | null; quality?: number | null } | null;
};

const EMPTY: Draft = {
  h: "",
  m: "",
  num: "",
  start: "",
  end: "",
  quality: null,
  checked: false,
};

function toDraft(type: TrackerType, entry: Entry | undefined): Draft {
  if (!entry) return { ...EMPTY };
  if (type === "duration") {
    return {
      ...EMPTY,
      h: String(Math.floor(entry.value / 60) || ""),
      m: String(Math.round(entry.value % 60) || ""),
    };
  }
  if (type === "sleep") {
    return {
      ...EMPTY,
      start: entry.meta?.start ?? "",
      end: entry.meta?.end ?? "",
      quality: entry.meta?.quality ?? null,
    };
  }
  if (type === "check") return { ...EMPTY, checked: entry.value > 0 };
  return { ...EMPTY, num: String(entry.value) };
}

/** Turn what's typed into the value + meta the API stores. */
function draftToEntry(type: TrackerType, dr: Draft) {
  if (type === "duration") {
    const value = (parseInt(dr.h, 10) || 0) * 60 + (parseInt(dr.m, 10) || 0);
    return { value, meta: null };
  }
  if (type === "sleep") {
    const value = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
    const meta =
      dr.start || dr.end || dr.quality
        ? { start: dr.start || null, end: dr.end || null, quality: dr.quality }
        : null;
    return { value, meta };
  }
  if (type === "check") return { value: dr.checked ? 1 : 0, meta: null };
  const n = parseFloat(dr.num);
  return { value: Number.isFinite(n) && n > 0 ? n : 0, meta: null };
}

const inputCls =
  "rounded-md border border-edge bg-transparent px-2 py-1.5 text-right outline-none focus:border-accent";

export default function TodayPage() {
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");

  const today = toDateStr(new Date());

  useEffect(() => {
    getCached<Tracker[]>("/api/trackers", "trackers").then(({ data }) => {
      if (data) setTrackers(data.filter((t) => !t.archived));
    });
  }, []);

  const loadDay = useCallback(async (d: string, list: Tracker[] | null) => {
    if (!list) return;
    const { data } = await getCached<Entry[]>(
      `/api/entries?date=${d}`,
      `entries:${d}`
    );
    const byId = new Map((data ?? []).map((r) => [r.trackerId, r]));
    const next: Record<string, Draft> = {};
    for (const t of list) next[t.id] = toDraft(t.type as TrackerType, byId.get(t.id));
    setDraft(next);
    setSaved(false);
  }, []);

  useEffect(() => {
    loadDay(date, trackers);
  }, [date, trackers, loadDay]);

  function set(id: string, patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...patch } }));
    setSaved(false);
  }

  function digits(raw: string, max: number) {
    return raw.replace(/[^0-9]/g, "").slice(0, max);
  }

  async function save() {
    if (!trackers) return;
    setSaving(true);
    setError("");
    setQueued(false);
    const entries = trackers.map((t) => ({
      trackerId: t.id,
      ...draftToEntry(t.type as TrackerType, draft[t.id] ?? EMPTY),
    }));
    try {
      const result = await post("/api/entries", { date, entries });
      // Keep the local copy in step so this day still reads back offline.
      cacheSet(
        `entries:${date}`,
        entries
          .filter((e) => e.value > 0 || e.meta)
          .map((e) => ({ ...e, note: null }))
      );
      setSaved(true);
      setQueued(result === "queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  // Group trackers by category — presets first, then any custom ones.
  const grouped = useMemo(() => {
    if (!trackers) return [];
    return orderCategories(trackers.map((t) => t.category))
      .map((value) => ({
        value,
        ...categoryMeta(value),
        items: trackers.filter(
          (t) => t.category.toLowerCase() === value.toLowerCase()
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [trackers]);

  const dayTotalMinutes = useMemo(() => {
    if (!trackers) return 0;
    return trackers
      .filter((t) => t.type === "duration")
      .reduce(
        (s, t) => s + draftToEntry("duration", draft[t.id] ?? EMPTY).value,
        0
      );
  }, [trackers, draft]);

  function renderInput(t: Tracker) {
    const dr = draft[t.id] ?? EMPTY;
    const type = t.type as TrackerType;

    if (type === "duration") {
      return (
        <div className="flex items-center gap-1.5">
          <Timer
            trackerId={t.id}
            date={date}
            onSaved={() => loadDay(date, trackers)}
          />
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.h}
            onChange={(e) => set(t.id, { h: digits(e.target.value, 2) })}
            className={`${inputCls} w-12`}
            aria-label={`${t.name} hours`}
          />
          <span className="text-sm text-muted">h</span>
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.m}
            onChange={(e) => set(t.id, { m: digits(e.target.value, 3) })}
            className={`${inputCls} w-12`}
            aria-label={`${t.name} minutes`}
          />
          <span className="text-sm text-muted">m</span>
        </div>
      );
    }

    if (type === "sleep") {
      const mins = dr.start && dr.end ? minutesBetween(dr.start, dr.end) : 0;
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1 text-sm text-muted">
            Slept
            <input
              type="time"
              value={dr.start}
              onChange={(e) => set(t.id, { start: e.target.value })}
              className={`${inputCls} text-center`}
            />
          </label>
          <label className="flex items-center gap-1 text-sm text-muted">
            Woke
            <input
              type="time"
              value={dr.end}
              onChange={(e) => set(t.id, { end: e.target.value })}
              className={`${inputCls} text-center`}
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
                className={`h-7 w-7 rounded-md border text-sm ${
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

    if (type === "count") {
      const n = parseFloat(dr.num) || 0;
      return (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => set(t.id, { num: String(Math.max(0, n - 1)) })}
            className="h-8 w-8 rounded-md border border-edge text-lg leading-none hover:bg-surface-2"
            aria-label={`Decrease ${t.name}`}
          >
            −
          </button>
          <input
            inputMode="numeric"
            placeholder="0"
            value={dr.num}
            onChange={(e) => set(t.id, { num: digits(e.target.value, 4) })}
            className={`${inputCls} w-14 text-center`}
            aria-label={t.name}
          />
          <button
            type="button"
            onClick={() => set(t.id, { num: String(n + 1) })}
            className="h-8 w-8 rounded-md border border-edge text-lg leading-none hover:bg-surface-2"
            aria-label={`Increase ${t.name}`}
          >
            +
          </button>
          {t.unit && <span className="text-sm text-muted">{t.unit}</span>}
        </div>
      );
    }

    if (type === "scale") {
      const current = parseFloat(dr.num) || 0;
      return (
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set(t.id, { num: current === n ? "" : String(n) })}
              className={`h-8 w-8 rounded-md border text-sm ${
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
        <button
          type="button"
          onClick={() => set(t.id, { checked: !dr.checked })}
          className={`rounded-md border px-4 py-1.5 text-sm font-medium ${
            dr.checked
              ? "border-green-700 bg-green-700 text-white"
              : "border-edge text-secondary hover:bg-surface-2"
          }`}
        >
          {dr.checked ? "✓ Done" : "Mark done"}
        </button>
      );
    }

    // measure
    return (
      <div className="flex items-center gap-1.5">
        <input
          inputMode="decimal"
          placeholder="0"
          value={dr.num}
          onChange={(e) =>
            set(t.id, { num: e.target.value.replace(/[^0-9.]/g, "").slice(0, 7) })
          }
          className={`${inputCls} w-20`}
          aria-label={t.name}
        />
        {t.unit && <span className="text-sm text-muted">{t.unit}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily log</h1>
        <p className="mt-1 text-sm text-secondary">
          Fill in what you did — leave anything blank if it doesn&apos;t apply.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2"
          aria-label="Previous day"
        >
          ←
        </button>
        <div className="flex-1">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-full rounded-md border border-edge card px-3 py-2 text-center shadow-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-center text-xs text-muted">
            {date === today ? "Today" : date === addDays(today, -1) ? "Yesterday" : ""}
          </p>
        </div>
        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          disabled={date >= today}
          className="rounded-md border border-edge card px-3 py-2 shadow-sm hover:bg-surface-2 disabled:opacity-30"
          aria-label="Next day"
        >
          →
        </button>
      </div>

      {trackers === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : trackers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-secondary">
          You don&apos;t have any trackers yet.{" "}
          <Link href="/trackers" className="font-medium text-accent underline">
            Set them up
          </Link>{" "}
          to start logging.
        </div>
      ) : (
        <>
          {grouped.map((group) => (
            <section key={group.value}>
              <h2 className="mb-2 text-sm font-semibold text-secondary">
                {group.icon} {group.label}
              </h2>
              <ul className="stagger space-y-2">
                {group.items.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-edge card p-3 shadow-sm"
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(t.color) }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {t.name}
                    </span>
                    {/* Inputs sit beside the name on a wide screen and drop to
                        their own full-width row on a phone. */}
                    <div className="flex w-full justify-end sm:ml-auto sm:w-auto">
                      {renderInput(t)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-edge card p-3 shadow-md sm:bottom-4">
            <span className="text-sm text-secondary">
              Time logged:{" "}
              <strong className="tabular-nums">
                {formatValue(dayTotalMinutes, "duration", "min")}
              </strong>
            </span>
            {saved && !saving && (
              <span
                className={`animate-fade-in text-sm font-medium ${
                  queued ? "text-amber-700" : "text-green-700"
                }`}
              >
                {queued ? "✓ Saved on device — will sync" : "✓ Saved"}
              </span>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button
              onClick={save}
              disabled={saving}
              className="ml-auto rounded-md bg-brand-gradient px-6 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save day"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
