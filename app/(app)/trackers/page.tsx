"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SERIES_PALETTE, seriesColor } from "@/lib/palette";
import { useCached } from "@/lib/useCached";
import Challenges from "@/components/Challenges";
import MotivationLine from "@/components/MotivationLine";
import { cacheRemove } from "@/lib/sync";
import { PERIODS, prettyDate } from "@/lib/dates";
import {
  CATEGORIES,
  TEMPLATE_PACKS,
  TRACKER_TYPES,
  categoryMeta,
  deletePhrase,
  hasFixedUnit,
  orderCategories,
  typeMeta,
  type Category,
  type Goal,
  type Habit,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

const NEW_CATEGORY = "__new__";

/** What `GET /api/trackers/:id` reports about what a delete would cost. */
type Usage = {
  id: string;
  name: string;
  entries: number;
  days: number;
  first: string | null;
  last: string | null;
};

type Form = {
  name: string;
  type: TrackerType;
  category: Category;
  unit: string;
  color: string;
  habit: Habit;
  goalOn: boolean;
  goalTarget: string;
  goalPeriod: "day" | "week";
  goalDirection: "min" | "max";
  remindOn: boolean;
  remindTimes: string[];
};

const BLANK: Form = {
  name: "",
  type: "duration",
  category: "study",
  unit: "min",
  color: SERIES_PALETTE[0].light,
  habit: "good",
  goalOn: false,
  goalTarget: "",
  goalPeriod: "day",
  goalDirection: "min",
  remindOn: false,
  remindTimes: ["20:00"],
};

/** Goal targets for time trackers are typed in hours but stored in minutes. */
function goalFromForm(f: Form): Goal {
  if (!f.goalOn || f.type === "streak") return null;
  const raw = parseFloat(f.goalTarget);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const isTime = f.type === "duration" || f.type === "sleep";
  return {
    target: isTime ? Math.round(raw * 60) : raw,
    period: f.goalPeriod,
    direction: f.goalDirection,
  };
}

function goalToForm(t: Tracker): Partial<Form> {
  if (!t.goal) return { goalOn: false, goalTarget: "" };
  const isTime = t.type === "duration" || t.type === "sleep";
  return {
    goalOn: true,
    goalTarget: String(isTime ? t.goal.target / 60 : t.goal.target),
    goalPeriod: t.goal.period,
    goalDirection: t.goal.direction,
  };
}

function goalLabel(t: Tracker): string | null {
  if (!t.goal) return null;
  const isTime = t.type === "duration" || t.type === "sleep";
  const amount = isTime
    ? `${Math.round((t.goal.target / 60) * 10) / 10}h`
    : `${t.goal.target}${t.unit ? " " + t.unit : ""}`;
  const verb = t.goal.direction === "min" ? "at least" : "at most";
  return `Goal: ${verb} ${amount} / ${t.goal.period}`;
}

export default function TrackersPage() {
  const [form, setForm] = useState<Form>(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [customCategory, setCustomCategory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPacks, setShowPacks] = useState(false);
  /** The tracker waiting on a delete confirmation, with what it would cost. */
  const [pending, setPending] = useState<Usage | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [query, setQuery] = useState("");

  const trackersQ = useCached<Tracker[]>("/api/trackers", "trackers");
  const trackers = trackersQ.data;
  const load = trackersQ.refresh;

  function setF<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Switching type swaps in that type's natural unit.
      if (key === "type") next.unit = typeMeta(value as TrackerType).defaultUnit;
      return next;
    });
  }

  function openAdd() {
    const used = new Set((trackers ?? []).map((t) => t.color.toLowerCase()));
    const free = SERIES_PALETTE.find((p) => !used.has(p.light.toLowerCase()));
    setForm({ ...BLANK, color: free?.light ?? SERIES_PALETTE[0].light });
    setEditingId(null);
    setCustomCategory(false);
    setShowForm(true);
    setError("");
    setDone("");
  }

  function openEdit(t: Tracker) {
    setForm({
      ...BLANK,
      name: t.name,
      type: t.type as TrackerType,
      category: t.category as Category,
      unit: t.unit,
      color: t.color,
      habit: t.habit ?? "good",
      remindOn: Boolean(t.reminder?.length),
      remindTimes: t.reminder?.length ? t.reminder : ["20:00"],
      ...goalToForm(t),
    } as Form);
    setEditingId(t.id);
    setCustomCategory(false);
    setShowForm(true);
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const payload = {
      name: form.name,
      type: form.type,
      category: form.category,
      unit: form.unit,
      color: form.color,
      habit: form.habit,
      goal: goalFromForm(form),
      reminder: form.remindOn ? form.remindTimes : null,
      // Minutes east of UTC — how the server knows when "18:00" is for you.
      tzOffset: -new Date().getTimezoneOffset(),
    };
    const res = await fetch(
      editingId ? `/api/trackers/${editingId}` : "/api/trackers",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Could not save");
      return;
    }
    setShowForm(false);
    setEditingId(null);
    load();
  }

  async function addPack(id: string) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/trackers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: id }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Could not add that pack");
      return;
    }
    const { added, skipped } = (await res.json()) as {
      added: number;
      skipped: number;
    };
    if (added === 0 && skipped > 0) setError("You already have all of those");
    setShowPacks(false);
    load();
  }

  async function patch(id: string, body: object) {
    await fetch(`/api/trackers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  /**
   * Ask the server what this tracker is actually holding before offering to
   * delete it. Nobody should confirm a deletion whose size they haven't seen.
   */
  async function askDelete(t: Tracker) {
    setError("");
    setDone("");
    setConfirmText("");
    setPending({ id: t.id, name: t.name, entries: 0, days: 0, first: null, last: null });
    setChecking(true);
    try {
      const res = await fetch(`/api/trackers/${t.id}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not check that tracker");
      setPending(data as Usage);
    } catch (err) {
      setPending(null);
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to delete a tracker"
      );
    } finally {
      setChecking(false);
    }
  }

  async function confirmDelete() {
    if (!pending || checking || busy) return;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({
        entries: String(pending.entries),
        confirm: confirmText.trim().toLowerCase(),
      });
      const res = await fetch(`/api/trackers/${pending.id}?${query}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // The count moved under us — re-read it so the dialog shows what's
        // really there now, and make them confirm against the new number.
        if (res.status === 409) {
          void askDelete({ id: pending.id, name: pending.name } as Tracker);
        }
        throw new Error(data?.error ?? "Could not delete");
      }

      // The dashboard reads from its own cached copies, which still have this
      // tracker in them — drop those so it doesn't reappear until the next
      // refresh lands.
      PERIODS.forEach((p) => cacheRemove(`stats:${p.value}`));
      setPending(null);
      setConfirmText("");
      setDone(
        pending.entries > 0
          ? `Deleted “${pending.name}” and ${pending.entries} ${pending.entries === 1 ? "entry" : "entries"}.`
          : `Deleted “${pending.name}”.`
      );
      load();
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to delete a tracker"
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Name, category or kind — whichever you remember. "sleep" finds the sleep
   * tracker and everything filed under Sleep; "streak" finds the clean
   * streaks. Archived rows are searched too, since a name you can't find is
   * often one you archived and forgot.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (t: Tracker) =>
      t.name.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      typeMeta(t.type as TrackerType).label.toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q);
  }, [query]);

  const active = useMemo(
    () => (trackers ?? []).filter((t) => !t.archived && (!matches || matches(t))),
    [trackers, matches]
  );
  const archived = useMemo(
    () => (trackers ?? []).filter((t) => t.archived && (!matches || matches(t))),
    [trackers, matches]
  );

  const total = (trackers ?? []).length;
  const shown = active.length + archived.length;
  // Below a certain number you can just look, and a search box is clutter.
  const searchable = total > 8 || query !== "";
  /** Suggested categories plus every one already in use. */
  const categoryOptions = useMemo(
    () =>
      orderCategories([
        ...CATEGORIES.map((c) => c.value),
        ...(trackers ?? []).map((t) => t.category),
      ]),
    [trackers]
  );

  const grouped = orderCategories(active.map((t) => t.category))
    .map((value) => ({
      value,
      ...categoryMeta(value),
      items: active.filter(
        (t) => t.category.toLowerCase() === value.toLowerCase()
      ),
    }))
    .filter((g) => g.items.length > 0);

  const isTimeType = form.type === "duration" || form.type === "sleep";
  const field =
    "w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trackers</h1>
          <p className="mt-1 text-sm text-secondary">
            Everything you want to keep an eye on — time, habits, sleep, health.
          </p>
        </div>
        {!showForm && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowPacks((v) => !v)}
              className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2"
            >
              Ready-made packs
            </button>
            <button
              onClick={openAdd}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
            >
              + New tracker
            </button>
          </div>
        )}
      </div>

      {/* "This, every day, for N days" — challenges watch a tracker over a
          window, so they live with the trackers they're judged by. */}
      {!showForm && <Challenges trackers={trackers} onTrackerCreated={load} />}

      {showPacks && !showForm && (
        <div className="animate-rise-in grid gap-3 sm:grid-cols-2">
          {TEMPLATE_PACKS.map((pack) => (
            <section
              key={pack.id}
              className="rounded-xl border border-edge card p-4 shadow-sm"
            >
              <h2 className="font-semibold">{pack.label}</h2>
              <p className="mt-1 text-sm text-secondary">{pack.hint}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {pack.items.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-xs"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: seriesColor(item.color) }}
                    />
                    {item.name}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => addPack(pack.id)}
                disabled={busy}
                className="mt-4 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "Adding…" : `Add ${pack.label.toLowerCase()}`}
              </button>
              <p className="mt-2 text-xs text-muted">
                Anything you already have is skipped.
              </p>
            </section>
          ))}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-edge card p-4 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              required
              maxLength={60}
              value={form.name}
              onChange={(e) => setF("name", e.target.value)}
              placeholder="e.g. Self study, Sleep, Water"
              className={field}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">What kind of thing is it?</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRACKER_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  disabled={Boolean(editingId)}
                  onClick={() => setF("type", t.value)}
                  className={`rounded-md border p-2.5 text-left disabled:opacity-50 ${
                    form.type === t.value
                      ? "border-accent bg-accent/5"
                      : "border-edge hover:bg-surface-2"
                  }`}
                >
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
                </button>
              ))}
            </div>
            {editingId && (
              <p className="mt-1 text-xs text-muted">
                The type can&apos;t change after creation — it would break past entries.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Category</label>
              <select
                value={customCategory ? NEW_CATEGORY : form.category}
                onChange={(e) => {
                  if (e.target.value === NEW_CATEGORY) {
                    setCustomCategory(true);
                    setF("category", "");
                  } else {
                    setCustomCategory(false);
                    setF("category", e.target.value);
                  }
                }}
                className={field}
              >
                {categoryOptions.map((value) => {
                  const meta = categoryMeta(value);
                  return (
                    <option key={value} value={value}>
                      {meta.icon} {meta.label}
                    </option>
                  );
                })}
                <option value={NEW_CATEGORY}>＋ New category…</option>
              </select>
              {customCategory && (
                <input
                  value={form.category}
                  onChange={(e) => setF("category", e.target.value)}
                  placeholder="e.g. Skincare, Prayer, Side project"
                  maxLength={30}
                  autoFocus
                  className={`${field} mt-2`}
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Unit</label>
              <input
                value={form.unit}
                onChange={(e) => setF("unit", e.target.value)}
                placeholder="glasses, kg, ×"
                disabled={hasFixedUnit(form.type)}
                className={`${field} disabled:opacity-50`}
              />
            </div>
          </div>

          {/* Streaks are avoidance by definition and prayers are plainly
              good, so neither needs to be asked. */}
          {form.type !== "streak" && form.type !== "prayer" && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                Which way does it count?
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setF("habit", "good")}
                  className={`rounded-md border p-2.5 text-left ${
                    form.habit === "good"
                      ? "border-green-700 bg-green-700/5"
                      : "border-edge hover:bg-surface-2"
                  }`}
                >
                  <div className="text-sm font-medium">🌱 Good habit</div>
                  <div className="mt-0.5 text-xs text-muted">
                    Building it up — more is the win. Study, workout, water.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setF("habit", "bad")}
                  className={`rounded-md border p-2.5 text-left ${
                    form.habit === "bad"
                      ? "border-red-600 bg-red-600/5"
                      : "border-edge hover:bg-surface-2"
                  }`}
                >
                  <div className="text-sm font-medium">🚫 Bad habit</div>
                  <div className="mt-0.5 text-xs text-muted">
                    Cutting it down — less is the win. If it grows, Status
                    will call it out.
                  </div>
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Color</label>
            <div className="flex flex-wrap gap-2">
              {SERIES_PALETTE.map((p) => (
                <button
                  key={p.light}
                  type="button"
                  title={p.name}
                  onClick={() => setF("color", p.light)}
                  className={`h-7 w-7 rounded-full border-2 ${
                    form.color.toLowerCase() === p.light.toLowerCase()
                      ? "border-foreground"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: seriesColor(p.light) }}
                />
              ))}
            </div>
          </div>

          {/* A clean streak has no target to hit — the streak is the point. */}
          <div
            className={`rounded-md border border-edge p-3 ${
              form.type === "streak" ? "hidden" : ""
            }`}
          >
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.goalOn}
                onChange={(e) => setF("goalOn", e.target.checked)}
              />
              Set a goal
            </label>
            {form.goalOn && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={form.goalDirection}
                  onChange={(e) =>
                    setF("goalDirection", e.target.value as "min" | "max")
                  }
                  className="rounded-md border border-edge bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="min">At least</option>
                  <option value="max">At most</option>
                </select>
                <input
                  inputMode="decimal"
                  value={form.goalTarget}
                  onChange={(e) => setF("goalTarget", e.target.value)}
                  placeholder="0"
                  className="w-20 rounded-md border border-edge bg-transparent px-2 py-1.5 text-right"
                />
                <span className="text-sm text-secondary">
                  {isTimeType ? "hours" : form.unit || "×"}
                </span>
                <select
                  value={form.goalPeriod}
                  onChange={(e) =>
                    setF("goalPeriod", e.target.value as "day" | "week")
                  }
                  className="rounded-md border border-edge bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="day">per day</option>
                  <option value="week">per week</option>
                </select>
              </div>
            )}
          </div>

          <div className="rounded-md border border-edge p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.remindOn}
                onChange={(e) => setF("remindOn", e.target.checked)}
              />
              Daily reminder
            </label>
            {form.remindOn && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {form.remindTimes.map((tm, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <input
                        type="time"
                        required
                        value={tm}
                        onChange={(e) =>
                          setF(
                            "remindTimes",
                            form.remindTimes.map((x, j) => (j === i ? e.target.value : x))
                          )
                        }
                        className="rounded-md border border-edge bg-transparent px-2 py-1.5 text-sm"
                      />
                      {form.remindTimes.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remove this time"
                          onClick={() =>
                            setF(
                              "remindTimes",
                              form.remindTimes.filter((_, j) => j !== i)
                            )
                          }
                          className="rounded-md px-1.5 py-1 text-sm text-secondary hover:bg-surface-2"
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                  {form.remindTimes.length < 5 && (
                    <button
                      type="button"
                      onClick={() => setF("remindTimes", [...form.remindTimes, ""])}
                      className="rounded-md border border-edge px-3 py-1.5 text-sm text-secondary hover:bg-surface-2"
                    >
                      + Add a time
                    </button>
                  )}
                </div>
                <p className="text-sm text-secondary">
                  {form.type === "prayer"
                    ? "One per waqt — up to five. Each fires until that day's prayers are all logged."
                    : "A push at each time, every day this isn't logged yet."}
                </p>
                <p className="text-xs text-muted">
                  Uses the same notifications as the nightly reminder — turn
                  those on in Account on each device you want nudged.
                </p>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !form.name.trim()}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {editingId ? "Save changes" : "Add tracker"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="rounded-md px-4 py-2 text-sm text-secondary hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {searchable && !showForm && (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden="true"
            >
              🔍
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, category or kind…"
              aria-label="Search trackers"
              autoComplete="off"
              className="w-full rounded-md border border-edge card py-2 pl-9 pr-3 shadow-sm outline-none focus:border-accent"
            />
          </div>
          {query && (
            <>
              <span className="shrink-0 text-sm tabular-nums text-muted">
                {shown}/{total}
              </span>
              <button
                onClick={() => setQuery("")}
                className="shrink-0 rounded-md border border-edge px-3 py-2 text-sm text-secondary hover:bg-surface-2"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {trackersQ.loading ? (
        <div className="space-y-2">
          <div aria-hidden="true" className="space-y-2">
            <div className="skeleton h-16 w-full rounded-lg" />
            <div className="skeleton h-16 w-full rounded-lg" />
          </div>
          <MotivationLine className="pt-3" />
        </div>
      ) : query && shown === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center">
          <p className="text-sm text-secondary">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
          <button
            onClick={() => setQuery("")}
            className="mt-3 rounded-md border border-edge px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Show all {total}
          </button>
        </div>
      ) : active.length === 0 && !showForm && !showPacks && total === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center">
          <p className="text-lg font-medium">Start with a ready-made pack</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
            The essentials — sleep, study, work, workout, water, food and weight
            — or faith &amp; discipline: namaz, Quran and a clean streak. You can
            rename, delete or add your own afterwards.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {TEMPLATE_PACKS.map((pack) => (
              <button
                key={pack.id}
                onClick={() => addPack(pack.id)}
                disabled={busy}
                className="rounded-lg bg-brand-gradient px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "Adding…" : `Add ${pack.label.toLowerCase()}`}
              </button>
            ))}
          </div>
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
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-edge card p-3 shadow-sm sm:p-4"
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(t.color) }}
                    />
                    <div className="min-w-0 flex-1">
                      {/* The name opens the tracker's own page — its whole
                          history, streak and notes — not the edit form. */}
                      <Link
                        href={`/tracker/${t.id}`}
                        className="block truncate font-medium hover:text-accent hover:underline"
                      >
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {typeMeta(t.type as TrackerType).label}
                        {goalLabel(t) ? ` · ${goalLabel(t)}` : ""}
                        {t.reminder?.length
                          ? ` · ⏰ ${
                              t.reminder.length === 1
                                ? t.reminder[0]
                                : `${t.reminder.length}× daily`
                            }`
                          : ""}
                      </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded-md border border-edge px-2.5 py-1 text-sm text-secondary hover:bg-surface-2"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => patch(t.id, { archived: true })}
                        className="rounded-md border border-edge px-2.5 py-1 text-sm text-secondary hover:bg-surface-2"
                        title="Hide from the log, keep history"
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => askDelete(t)}
                        className="rounded-md border border-edge px-2.5 py-1 text-sm text-red-600 hover:bg-surface-2"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {archived.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted">Archived</h2>
              <ul className="stagger space-y-2">
                {archived.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-xl border border-edge card p-4 opacity-60 shadow-sm"
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(t.color) }}
                    />
                    <span className="flex-1 truncate font-medium">{t.name}</span>
                    <button
                      onClick={() => patch(t.id, { archived: false })}
                      className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-surface-2"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {error && !showForm && !pending && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      {done && (
        <p className="animate-fade-in text-sm font-medium text-green-700 dark:text-green-500">
          {done}
        </p>
      )}

      {pending && (
        <DeleteDialog
          usage={pending}
          checking={checking}
          busy={busy}
          error={error}
          confirmText={confirmText}
          onConfirmText={setConfirmText}
          onCancel={() => {
            setPending(null);
            setConfirmText("");
            setError("");
          }}
          onArchive={() => {
            setPending(null);
            setConfirmText("");
            setDone(`Archived “${pending.name}” — its history is still there.`);
            void patch(pending.id, { archived: true });
          }}
          onDelete={confirmDelete}
        />
      )}
    </div>
  );
}

/**
 * Deleting a tracker takes its whole history with it, so this is the one place
 * in the app that stands in the way rather than getting out of it: it names
 * what will be lost, offers archiving as the way out, and — once there's
 * anything to lose — only unlocks once the phrase has been typed back.
 */
function DeleteDialog({
  usage,
  checking,
  busy,
  error,
  confirmText,
  onConfirmText,
  onCancel,
  onArchive,
  onDelete,
}: {
  usage: Usage;
  checking: boolean;
  busy: boolean;
  error: string;
  confirmText: string;
  onConfirmText: (v: string) => void;
  onCancel: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const phrase = deletePhrase(usage.name);
  const hasHistory = usage.entries > 0;
  const armed =
    !checking && (!hasHistory || confirmText.trim().toLowerCase() === phrase);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${usage.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="animate-rise-in w-full max-w-md rounded-xl border border-red-600/40 card p-5 shadow-lg">
        <h2 className="text-lg font-semibold text-red-600">
          Delete “{usage.name}”?
        </h2>

        {checking ? (
          <p className="mt-3 text-sm text-secondary">
            Checking what this tracker is holding…
          </p>
        ) : hasHistory ? (
          <>
            <p className="mt-2 text-sm text-secondary">
              This also deletes{" "}
              <strong className="tabular-nums text-foreground">
                {usage.entries}
              </strong>{" "}
              {usage.entries === 1 ? "entry" : "entries"} across{" "}
              <strong className="tabular-nums text-foreground">
                {usage.days}
              </strong>{" "}
              {usage.days === 1 ? "day" : "days"}
              {usage.first && usage.last && (
                <>
                  , from {prettyDate(usage.first)} to {prettyDate(usage.last)}
                </>
              )}
              . It can&apos;t be undone.
            </p>
            <p className="mt-2 text-sm text-secondary">
              If you just want it off your daily log,{" "}
              <strong className="text-foreground">archive</strong> it instead —
              that keeps every day you&apos;ve logged.
            </p>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block text-secondary">
                To confirm, type{" "}
                <code className="rounded bg-surface-2 px-1 font-semibold">
                  {phrase}
                </code>
              </span>
              <input
                value={confirmText}
                onChange={(e) => onConfirmText(e.target.value)}
                placeholder={phrase}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-red-600"
              />
            </label>
          </>
        ) : (
          <p className="mt-2 text-sm text-secondary">
            Nothing has ever been logged against it, so nothing else goes with
            it.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onDelete}
            disabled={!armed || busy}
            className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
          >
            {busy
              ? "Deleting…"
              : hasHistory
                ? `Delete it and ${usage.days} ${usage.days === 1 ? "day" : "days"} of history`
                : "Delete tracker"}
          </button>
          {hasHistory && (
            <button
              onClick={onArchive}
              disabled={busy}
              className="rounded-md border border-edge px-4 py-2.5 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
            >
              Archive instead
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={busy}
            className="ml-auto rounded-md px-4 py-2.5 text-sm text-secondary hover:bg-surface-2 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
