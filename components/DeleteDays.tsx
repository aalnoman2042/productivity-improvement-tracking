"use client";

import { useState } from "react";
import { cacheRemove, dropQueuedDays } from "@/lib/sync";
import { prettyDate } from "@/lib/dates";

type Summary = {
  from: string;
  to: string;
  days: number;
  entries: number;
  dates: string[];
};

const dateCls =
  "rounded-md border border-edge bg-transparent px-2 py-1.5 outline-none focus:border-accent";

/**
 * Wipe a day, a week or a whole month of logs.
 *
 * Deleting is the one thing here that can't be undone, so it happens in two
 * steps: check the range first, then type back the number of days it found.
 * You can't confirm a deletion you haven't looked at.
 */
export default function DeleteDays({
  date,
  onDeleted,
}: {
  date: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const phrase = summary
    ? `delete ${summary.days} ${summary.days === 1 ? "day" : "days"}`
    : "";
  const armed = summary !== null && confirm.trim().toLowerCase() === phrase;

  function reset() {
    setSummary(null);
    setConfirm("");
    setError("");
  }

  async function check() {
    setBusy(true);
    setError("");
    setDone("");
    setSummary(null);
    setConfirm("");
    try {
      const res = await fetch(
        `/api/entries/range?from=${from}&to=${to}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not check that range");
      if (data.days === 0) {
        setError("Nothing is logged in that range.");
      } else {
        setSummary(data as Summary);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to delete days"
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!summary || !armed) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/entries/range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: summary.from,
          to: summary.to,
          days: summary.days,
          confirm: confirm.trim().toLowerCase(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not delete");

      // Drop the local copies too, or the deleted days would reappear
      // offline — and a save queued earlier would restore them for real.
      const dates: string[] = data.dates ?? [];
      dates.forEach((dt) => cacheRemove(`entries:${dt}`));
      dropQueuedDays(dates);

      setDone(
        `Deleted ${data.entries} ${data.entries === 1 ? "entry" : "entries"} across ${data.days} ${data.days === 1 ? "day" : "days"}.`
      );
      reset();
      onDeleted();
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to delete days"
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="pt-2 text-center">
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-muted underline underline-offset-4 hover:text-red-600"
        >
          Delete logged days
        </button>
      </div>
    );
  }

  return (
    <section className="animate-rise-in rounded-lg border border-red-600/40 card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-red-600">Delete logged days</h2>
          <p className="mt-1 text-sm text-secondary">
            Removes every entry between the two dates — one day, a weekend, a
            whole month. This can&apos;t be undone.
          </p>
        </div>
        <button
          onClick={() => {
            setOpen(false);
            reset();
            setDone("");
          }}
          className="rounded-md border border-edge px-2 py-1 text-sm text-secondary hover:bg-surface-2"
        >
          Close
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-secondary">From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              if (e.target.value) setFrom(e.target.value);
              reset();
            }}
            className={dateCls}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-secondary">To</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              if (e.target.value) setTo(e.target.value);
              reset();
            }}
            className={dateCls}
          />
        </label>
        <button
          onClick={check}
          disabled={busy || from > to}
          className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-2 disabled:opacity-40"
        >
          {busy && !summary ? "Checking…" : "Check this range"}
        </button>
      </div>

      {summary && (
        <div className="animate-fade-in mt-4 rounded-md border border-edge bg-surface-2 p-3">
          <p className="text-sm">
            <strong className="tabular-nums">{summary.days}</strong>{" "}
            {summary.days === 1 ? "day has" : "days have"} data —{" "}
            <strong className="tabular-nums">{summary.entries}</strong>{" "}
            {summary.entries === 1 ? "entry" : "entries"} in total.
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.dates.slice(0, 6).map(prettyDate).join(", ")}
            {summary.dates.length > 6 &&
              ` and ${summary.dates.length - 6} more`}
          </p>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-secondary">
              To confirm, type{" "}
              <code className="rounded bg-surface px-1 font-semibold">
                {phrase}
              </code>
            </span>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={phrase}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-edge bg-transparent px-3 py-2 outline-none focus:border-red-600"
            />
          </label>

          <button
            onClick={remove}
            disabled={!armed || busy}
            className="mt-3 w-full rounded-md bg-red-600 px-4 py-2.5 font-medium text-white hover:bg-red-700 disabled:opacity-40 sm:w-auto"
          >
            {busy ? "Deleting…" : `Permanently delete ${summary.days === 1 ? "this day" : `these ${summary.days} days`}`}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {done && (
        <p className="animate-fade-in mt-3 text-sm font-medium text-green-700 dark:text-green-500">
          {done}
        </p>
      )}
    </section>
  );
}
