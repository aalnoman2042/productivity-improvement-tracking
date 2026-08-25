"use client";

import { useEffect, useState } from "react";
import type { CronHealth } from "@/lib/cronLog";

/**
 * Whether the app is actually working, as opposed to merely being used.
 *
 * Two panels, both answering questions the account counts cannot.
 *
 * The schedule one matters most, and it matters because of how it fails:
 * every reminder depends on something *outside* this app calling its cron
 * endpoints, and when that something is missing nothing goes wrong. There is
 * no error and no exception — reminders simply never arrive, and the only
 * way to find out is to notice the absence of something you were not looking
 * at. A line saying "never ran" is worth more than any number on this page.
 */

type RecentRun = {
  job: string;
  startedAt: string | null;
  ok: boolean;
  tookMs: number | null;
  checked: number | null;
  notified: number | null;
  skipped: number | null;
  lapses: number | null;
  deferred: number | null;
  digests: number | null;
  error: string | null;
};

type Collection = {
  name: string;
  exists: boolean;
  hasValidator: boolean;
  datePatternOk: boolean | null;
  indexes: number;
  rows: number;
};

type Health = {
  schedule: {
    daily: CronHealth;
    perTracker: CronHealth;
    devices: number;
    accountsWithDailyOn: number;
    trackersWithTimes: number;
    recent: RecentRun[];
  };
  schema: { collections: Collection[] };
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/** One job, and the plainest possible sentence about it. */
function Job({ name, health }: { name: string; health: CronHealth }) {
  const state = !health.everRan
    ? { label: "never ran", tone: "text-red-600", dot: "bg-red-600" }
    : !health.lastRunOk
      ? { label: "last run failed", tone: "text-red-600", dot: "bg-red-600" }
      : health.overdue
        ? { label: "overdue", tone: "text-amber-700 dark:text-amber-500", dot: "bg-amber-500" }
        : { label: "healthy", tone: "text-green-700 dark:text-green-500", dot: "bg-green-600" };

  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${state.dot}`} />
      <span className="font-medium">{name}</span>
      <span className={`text-sm font-medium ${state.tone}`}>{state.label}</span>
      <span className="ml-auto text-xs text-muted">{ago(health.lastRunAt)}</span>
      {health.lastError && (
        <p className="w-full font-mono text-xs break-words text-red-600">
          {health.lastError}
        </p>
      )}
      {!health.everRan && (
        <p className="w-full text-xs text-secondary">
          Nothing has ever called this endpoint. Reminders only fire when the
          app is opened until a scheduler does — DEPLOY.md §3b-i.
        </p>
      )}
    </li>
  );
}

export default function AdminHealth() {
  const [data, setData] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/health")
      .then(async (res) => {
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = await res.json();
        if (!body?.schedule || !body?.schema) throw new Error("health: unexpected shape");
        return body as Health;
      })
      .then((h) => live && setData(h))
      .catch((err) => {
        console.error("Admin health:", err);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Everything computed before the early returns — see check:shape.
  const broken =
    data?.schema.collections.filter(
      (c) => c.exists && (!c.hasValidator || c.datePatternOk === false)
    ) ?? [];
  const reachable = data ? data.schedule.devices > 0 : false;

  if (failed) {
    return (
      <section className="rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">🩺 Health</h2>
        <p className="mt-1 text-sm text-secondary">
          Couldn&apos;t read the app&apos;s health. Everything else on this
          page is unaffected.
        </p>
      </section>
    );
  }

  if (!data) return <div className="skeleton h-52 rounded-xl" aria-hidden="true" />;

  return (
    <>
      <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
        <h2 className="font-semibold">⏱ The schedule</h2>
        <p className="mt-1 text-sm text-secondary">
          Every reminder depends on something outside this app calling it. When
          that stops, nothing breaks — the reminders just never arrive.
        </p>

        <ul className="mt-2 divide-y divide-edge">
          <Job name="Daily ask" health={data.schedule.daily} />
          <Job name="Per-tracker & prayer times" health={data.schedule.perTracker} />
        </ul>

        {/* A perfect schedule delivers nothing to nobody. */}
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-edge pt-3 text-center">
          <div>
            <p
              className={`text-lg font-bold tabular-nums ${reachable ? "" : "text-red-600"}`}
            >
              {data.schedule.devices}
            </p>
            <p className="text-xs text-muted">devices subscribed</p>
          </div>
          <div>
            <p className="text-lg font-bold tabular-nums">
              {data.schedule.accountsWithDailyOn}
            </p>
            <p className="text-xs text-muted">daily ask on</p>
          </div>
          <div>
            <p className="text-lg font-bold tabular-nums">
              {data.schedule.trackersWithTimes}
            </p>
            <p className="text-xs text-muted">trackers with times</p>
          </div>
        </div>

        {!reachable && (
          <p className="mt-2 text-xs text-red-600">
            No browser is subscribed, so nothing can be delivered even if the
            schedule is perfect.
          </p>
        )}

        {data.schedule.recent.length > 0 && (
          <div className="mt-3 border-t border-edge pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Last runs
            </p>
            <ul className="mt-1.5 space-y-1">
              {data.schedule.recent.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className={r.ok ? "text-green-700 dark:text-green-500" : "text-red-600"}>
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span className="font-medium">{r.job}</span>
                  <span className="text-muted">{ago(r.startedAt)}</span>
                  <span className="text-secondary">
                    {[
                      r.notified ? `${r.notified} sent` : null,
                      r.skipped ? `${r.skipped} skipped` : null,
                      r.lapses ? `${r.lapses} check-ins` : null,
                      // A poll that ran out of budget. Silence with a
                      // reason, which is the only kind worth having.
                      r.deferred ? `${r.deferred} deferred` : null,
                      r.digests ? `${r.digests} digests` : null,
                      r.tookMs != null ? `${r.tookMs}ms` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {r.error && (
                    <span className="w-full font-mono break-words text-red-600">
                      {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-semibold">🗄 Schema</h2>
          <span
            className={`text-xs font-medium ${
              broken.length === 0
                ? "text-green-700 dark:text-green-500"
                : "text-red-600"
            }`}
          >
            {broken.length === 0
              ? "all enforced"
              : `${broken.length} not enforced`}
          </span>
        </div>
        <p className="mt-1 text-sm text-secondary">
          What the database is really enforcing. A validator that quietly
          matches nothing rejects every write to its collection.
        </p>

        <ul className="mt-3 space-y-1 text-sm">
          {data.schema.collections.map((c) => {
            const bad = c.exists && (!c.hasValidator || c.datePatternOk === false);
            return (
              <li key={c.name} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={
                    !c.exists
                      ? "text-muted"
                      : bad
                        ? "text-red-600"
                        : "text-green-700 dark:text-green-500"
                  }
                >
                  {!c.exists ? "·" : bad ? "✗" : "✓"}
                </span>
                <span className={bad ? "font-medium text-red-600" : "font-medium"}>
                  {c.name}
                </span>
                <span className="ml-auto text-xs text-muted tabular-nums">
                  {c.exists
                    ? `${c.rows.toLocaleString()} rows · ${c.indexes} indexes`
                    : "not created yet"}
                </span>
              </li>
            );
          })}
        </ul>

        {broken.length > 0 && (
          <p className="mt-3 text-xs text-red-600">
            {broken.map((c) => c.name).join(", ")} —{" "}
            {broken.some((c) => c.datePatternOk === false)
              ? "a date pattern that matches nothing (its backslashes were lost)."
              : "no validator is being enforced."}{" "}
            Writes to these will fail or go unchecked.
          </p>
        )}
      </section>
    </>
  );
}
