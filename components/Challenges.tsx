"use client";

import Select from "@/components/Select";
import { useMemo, useState } from "react";
import Link from "next/link";
import { seriesColor } from "@/lib/palette";
import { useCached } from "@/lib/useCached";
import { isValidDateStr, prettyDate, toDateStr } from "@/lib/dates";
import { typeMeta, type Tracker, type TrackerType } from "@/lib/trackers";
import {
  CHALLENGE_LENGTHS,
  MAX_CHALLENGE_DAYS,
  challengeProgress,
  type ChallengeRow,
} from "@/lib/challenges";

/** Kinds where a daily bar ("at least 2 hours") makes sense. Checks and
 * clean streaks are already yes/no — logging the day *is* the bar. */
const TARGET_TYPES: TrackerType[] = [
  "duration",
  "sleep",
  "count",
  "measure",
  "scale",
  "prayer",
];

const NEW_TRACKER = "__new__";

type Form = {
  name: string;
  days: string;
  startDate: string;
  trackerId: string; // NEW_TRACKER = create a Yes/No tracker for it
  target: string;
  direction: "min" | "max";
};

/**
 * Take a challenge — "this, every day, for N days" — and watch it hold.
 *
 * A challenge doesn't log anything itself: it watches a tracker (an existing
 * one, or a Yes/No tracker it creates for you) and judges each day of its
 * window by what the daily log already holds. Giving up deletes only the
 * challenge; the tracker and its history stay.
 */
export default function Challenges({
  trackers,
  onTrackerCreated,
  standalone = false,
}: {
  trackers: Tracker[] | null;
  onTrackerCreated: () => void;
  /** On its own view the page owns the heading, so this doesn't draw one. */
  standalone?: boolean;
}) {
  const today = toDateStr(new Date());
  const q = useCached<ChallengeRow[]>("/api/challenges", "challenges");
  const challenges = q.data ?? [];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Form>({
    name: "",
    days: "30",
    startDate: today,
    trackerId: NEW_TRACKER,
    target: "",
    direction: "min",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The challenge whose Give up button is waiting for its second tap. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const active = useMemo(
    () => (trackers ?? []).filter((t) => !t.archived),
    [trackers]
  );

  const picked = active.find((t) => t.id === form.trackerId) ?? null;
  const wantsTarget =
    picked !== null && TARGET_TYPES.includes(picked.type as TrackerType);
  const isTime = picked?.type === "duration" || picked?.type === "sleep";

  function setF<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openForm() {
    setForm({
      name: "",
      days: "30",
      startDate: today,
      trackerId: NEW_TRACKER,
      target: "",
      direction: "min",
    });
    setError("");
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");

    // Time targets are typed in hours but stored in minutes, same as goals.
    const raw = parseFloat(form.target);
    const target =
      wantsTarget && Number.isFinite(raw) && raw > 0
        ? isTime
          ? Math.round(raw * 60)
          : raw
        : null;

    const res = await fetch("/api/challenges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        days: parseInt(form.days, 10),
        startDate: form.startDate,
        trackerId: form.trackerId === NEW_TRACKER ? null : form.trackerId,
        target,
        direction: form.direction,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error ?? "Could not take the challenge");
      return;
    }
    setShowForm(false);
    void q.refresh();
    // A challenge without a tracker just created one — the lists that show
    // trackers need to hear about it.
    if (form.trackerId === NEW_TRACKER) onTrackerCreated();
  }

  async function giveUp(id: string) {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setConfirming(null);
    await fetch(`/api/challenges/${id}`, { method: "DELETE" });
    void q.refresh();
  }

  const daysNum = parseInt(form.days, 10);
  const daysOk =
    Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= MAX_CHALLENGE_DAYS;

  const field =
    "w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-accent";
  const chip = (on: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
      on
        ? "border-accent bg-accent text-white"
        : "border-edge text-secondary hover:bg-surface-2"
    }`;

  // Nothing yet and the form closed: just the invitation, not an empty list.
  if (!showForm && challenges.length === 0 && !q.loading) {
    return (
      <section className="rounded-lg border border-dashed border-edge p-5 text-center">
        <p className="font-medium">🏆 Take a challenge</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          Pick anything — 30 days of Quran, a week without junk food, 21 days
          of workouts — and watch every day of it land on the record.
        </p>
        <button
          onClick={openForm}
          className="mt-3 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Take a challenge
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {!standalone && (
          <h2 className="text-sm font-semibold text-secondary">🏆 Challenges</h2>
        )}
        {!showForm && (
          <button
            onClick={openForm}
            className="ml-auto rounded-md border border-edge px-3 py-1.5 text-sm font-medium text-secondary hover:bg-surface-2"
          >
            + Take a challenge
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="animate-rise-in space-y-4 rounded-xl border border-edge card p-4 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">
              What&apos;s the challenge?
            </label>
            <input
              required
              maxLength={60}
              value={form.name}
              onChange={(e) => setF("name", e.target.value)}
              placeholder="e.g. 30 days of Quran, No junk food week"
              className={field}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">How long?</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {CHALLENGE_LENGTHS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setF("days", String(n))}
                  className={chip(daysNum === n)}
                >
                  {n} days
                </button>
              ))}
              <input
                inputMode="numeric"
                value={form.days}
                onChange={(e) =>
                  setF("days", e.target.value.replace(/[^0-9]/g, "").slice(0, 3))
                }
                aria-label="Days"
                className="w-16 rounded-md border border-edge bg-transparent px-2 py-1.5 text-center text-sm outline-none focus:border-accent"
              />
              <span className="text-sm text-secondary">days</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Starting</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) =>
                isValidDateStr(e.target.value) && setF("startDate", e.target.value)
              }
              className={field}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              What counts as done each day?
            </label>
            <Select
              label="What counts as done each day?"
              value={form.trackerId}
              onChange={(v) => {
                setF("trackerId", v);
                setF("target", "");
              }}
              options={[
                {
                  value: NEW_TRACKER,
                  label: "✓ A new Yes/No tracker named after the challenge",
                },
                ...active.map((t) => ({
                  value: t.id,
                  label: t.name,
                  hint: typeMeta(t.type as TrackerType).label,
                })),
              ]}
            />
            {form.trackerId === NEW_TRACKER ? (
              <p className="mt-1 text-xs text-muted">
                It appears on the daily log under 🏆 Challenge — tap it done
                each day.
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted">
                Judged by what you already log on this tracker — nothing new
                to fill in.
              </p>
            )}
            {wantsTarget && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select
                  label="Target direction"
                  value={form.direction}
                  onChange={(v) => setF("direction", v as "min" | "max")}
                  className="w-28"
                  options={[
                    { value: "min", label: "At least" },
                    { value: "max", label: "At most" },
                  ]}
                />
                <input
                  inputMode="decimal"
                  value={form.target}
                  onChange={(e) => setF("target", e.target.value)}
                  placeholder={picked?.type === "prayer" ? "5" : "0"}
                  className="w-20 rounded-md border border-edge bg-transparent px-2 py-1.5 text-right"
                />
                <span className="text-sm text-secondary">
                  {isTime
                    ? "hours"
                    : picked?.type === "prayer"
                      ? "of 5 prayers"
                      : picked?.unit || "×"}{" "}
                  per day
                </span>
              </div>
            )}
            {wantsTarget && !form.target && form.direction === "min" && (
              <p className="mt-1 text-xs text-muted">
                No amount set: any log on that day counts.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !form.name.trim() || !daysOk}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Taking it…" : "Take the challenge"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md px-4 py-2 text-sm text-secondary hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {challenges.length > 0 && (
        <ul className="stagger space-y-2">
          {challenges.map((c) => {
            // A day marked off on purpose is not a day this fell over — the
            // rest days ride along with the row for exactly this.
            const p = challengeProgress(c, today, new Set(c.rest ?? []));
            const barColor =
              p.status === "completed"
                ? "bg-green-700"
                : p.status === "ended"
                  ? "bg-surface-2"
                  : "bg-brand-gradient";
            return (
              <li
                key={c.id}
                className="rounded-xl border border-edge card p-3 shadow-sm sm:p-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {c.name}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {p.status === "upcoming"
                      ? `Starts ${prettyDate(c.startDate)}`
                      : p.status === "completed"
                        ? "🏆 Completed"
                        : p.status === "ended"
                          ? "Ended"
                          : `Day ${p.dayNumber} of ${c.days}`}
                  </span>
                  <button
                    onClick={() => giveUp(c.id)}
                    onBlur={() => setConfirming(null)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                      confirming === c.id
                        ? "border-red-600 bg-red-600 text-white"
                        : "border-edge text-secondary hover:bg-surface-2"
                    }`}
                    title="Removes the challenge only — the tracker and its history stay"
                  >
                    {confirming === c.id
                      ? "Sure?"
                      : p.status === "completed" || p.status === "ended"
                        ? "Clear"
                        : "Give up"}
                  </button>
                </div>

                {c.tracker && (
                  <Link
                    href={`/tracker/${c.trackerId}`}
                    className="mt-1 inline-flex items-center gap-1.5 text-xs text-secondary hover:text-accent hover:underline"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: seriesColor(c.tracker.color) }}
                    />
                    {c.tracker.name}
                  </Link>
                )}

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="tabular-nums text-secondary">
                    {p.met}/{c.days} days done
                  </span>
                  {p.status === "active" && (
                    <span
                      className={
                        p.todayMet
                          ? "font-medium text-green-700 dark:text-green-500"
                          : "text-muted"
                      }
                    >
                      {p.todayMet ? "✓ Today done" : "Today not logged yet"}
                    </span>
                  )}
                  {p.missed > 0 && (
                    <span className="text-amber-700">
                      {p.missed} {p.missed === 1 ? "day" : "days"} missed
                    </span>
                  )}
                  {p.perfect && p.status === "active" && p.dayNumber > 1 && (
                    <span className="font-medium text-green-700 dark:text-green-500">
                      🔥 Perfect so far
                    </span>
                  )}
                  {p.status === "completed" && (
                    <span className="font-medium text-green-700 dark:text-green-500">
                      Every single day — done. 🎉
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
