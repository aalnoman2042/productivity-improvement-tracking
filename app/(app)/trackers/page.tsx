"use client";

import { useEffect, useMemo, useState } from "react";
import { SERIES_PALETTE, seriesColor } from "@/lib/palette";
import {
  CATEGORIES,
  TRACKER_TYPES,
  categoryMeta,
  orderCategories,
  typeMeta,
  type Category,
  type Goal,
  type Tracker,
  type TrackerType,
} from "@/lib/trackers";

const NEW_CATEGORY = "__new__";

type Form = {
  name: string;
  type: TrackerType;
  category: Category;
  unit: string;
  color: string;
  goalOn: boolean;
  goalTarget: string;
  goalPeriod: "day" | "week";
  goalDirection: "min" | "max";
};

const BLANK: Form = {
  name: "",
  type: "duration",
  category: "study",
  unit: "min",
  color: SERIES_PALETTE[0].light,
  goalOn: false,
  goalTarget: "",
  goalPeriod: "day",
  goalDirection: "min",
};

/** Goal targets for time trackers are typed in hours but stored in minutes. */
function goalFromForm(f: Form): Goal {
  if (!f.goalOn) return null;
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
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [customCategory, setCustomCategory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/trackers");
    if (res.status === 401) return location.assign("/login");
    setTrackers(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

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
  }

  function openEdit(t: Tracker) {
    setForm({
      ...BLANK,
      name: t.name,
      type: t.type as TrackerType,
      category: t.category as Category,
      unit: t.unit,
      color: t.color,
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
      goal: goalFromForm(form),
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

  async function addStarterPack() {
    setBusy(true);
    await fetch("/api/trackers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: true }),
    });
    setBusy(false);
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

  async function remove(id: string) {
    const res = await fetch(`/api/trackers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Could not delete");
      return;
    }
    load();
  }

  const active = useMemo(
    () => (trackers ?? []).filter((t) => !t.archived),
    [trackers]
  );
  const archived = useMemo(
    () => (trackers ?? []).filter((t) => t.archived),
    [trackers]
  );
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
          <button
            onClick={openAdd}
            className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          >
            + New tracker
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-lg border border-edge card p-4 shadow-sm"
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
                      : "border-edge hover:bg-background"
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
                disabled={isTimeType || form.type === "check"}
                className={`${field} disabled:opacity-50`}
              />
            </div>
          </div>

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

          <div className="rounded-md border border-edge p-3">
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !form.name.trim()}
              className="rounded-md bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {editingId ? "Save changes" : "Add tracker"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
              className="rounded-md px-4 py-2 text-sm text-secondary hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {trackers === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : active.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center">
          <p className="text-lg font-medium">Start with the essentials</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
            Add a ready-made set — sleep, self study, work, workout, water, junk
            food, diet quality and weight. You can rename, delete or add your own
            afterwards.
          </p>
          <button
            onClick={addStarterPack}
            disabled={busy}
            className="mt-5 rounded-md bg-brand-gradient px-5 py-2.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add starter pack"}
          </button>
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
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-edge card p-4 shadow-sm"
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(t.color) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="text-xs text-muted">
                        {typeMeta(t.type as TrackerType).label}
                        {goalLabel(t) ? ` · ${goalLabel(t)}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => openEdit(t)}
                      className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-background"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => patch(t.id, { archived: true })}
                      className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-background"
                      title="Hide from the log, keep history"
                    >
                      Archive
                    </button>
                    <button
                      onClick={() => remove(t.id)}
                      className="rounded-md px-2 py-1 text-sm text-red-600 hover:bg-background"
                    >
                      Delete
                    </button>
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
                    className="flex items-center gap-3 rounded-lg border border-edge card p-4 opacity-60 shadow-sm"
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(t.color) }}
                    />
                    <span className="flex-1 truncate font-medium">{t.name}</span>
                    <button
                      onClick={() => patch(t.id, { archived: false })}
                      className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-background"
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

      {error && !showForm && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
