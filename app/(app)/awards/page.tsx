"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import LoadError from "@/components/LoadError";
import { useMounted } from "@/lib/useMounted";
import { prettyDate, toDateStr } from "@/lib/dates";
import { seriesColor } from "@/lib/palette";
import { RANKS, type Awards } from "@/lib/awards";

/**
 * The trophy cabinet.
 *
 * Every other screen in this app is an assessment — a score, a grade, a
 * percentage, a thing you are behind on. This one has no judgement on it
 * anywhere, by design: nothing here can fall, nothing is red, and an award
 * once earned is never taken back by a bad month, because the month it
 * happened in still happened.
 *
 * Reached from Account rather than from the bottom nav, deliberately. It is
 * a page you visit on purpose, on a day you want to see it, not a fifth tab
 * competing with the four screens that are actually for logging.
 */

/** How the ladder is drawn — the rung you are on, filled. */
function Ladder({ step }: { step: number }) {
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Ranks">
      {RANKS.map((r, i) => (
        <li
          key={r.name}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            i < step
              ? "bg-surface-2 text-secondary"
              : i === step
                ? "bg-accent text-white"
                : "border border-dashed border-edge text-muted"
          }`}
          aria-current={i === step ? "step" : undefined}
        >
          {r.name}
        </li>
      ))}
    </ol>
  );
}

export default function AwardsPage() {
  // The clock is a client fact. `today` only ever reaches a query string
  // here, never rendered text, but the dates that come back are rendered —
  // so the whole body waits for mount rather than painting the build's idea
  // of "today" onto the CDN. See the gotcha in the brief.
  const mounted = useMounted();

  // Read once when the page opens, deliberately NOT through `useCached`.
  //
  // This route reads every entry the account has ever written and then runs
  // the whole report-card grader over them — the heaviest read in the app —
  // and `useCached` would re-run it every 60 seconds for as long as the page
  // sits open. An award is earned by something that already happened; the
  // answer cannot change while you are looking at it. (The cache layer itself
  // is untouched by this: the page simply does not opt into a poll it has no
  // use for.)
  const [data, setData] = useState<Awards | null>(null);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed("");
    try {
      const res = await fetch(`/api/awards?today=${toDateStr(new Date())}`);
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Awards);
    } catch {
      setFailed("Couldn't load — check your connection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Out of the effect's synchronous phase — the lint rule this repo enforces.
    void Promise.resolve().then(load);
  }, [load]);
  const earned = (data?.awards ?? []).filter((a) => a.earned);
  const locked = (data?.awards ?? []).filter((a) => !a.earned);
  // A locked award with the most progress is the interesting one, so the
  // "not yet" row reads as a shortlist rather than a backlog.
  const nextUp = [...locked].sort((a, b) => b.progress - a.progress);
  const hours = Math.round((data?.timeMinutes ?? 0) / 60);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🏅 My awards</h1>
        <p className="mt-1 text-sm text-secondary">
          Everything that has gone right. No grades on this page.
        </p>
      </div>

      {!mounted || (!data && loading) ? (
        <div className="skeleton h-48 w-full" aria-hidden="true" />
      ) : !data ? (
        <LoadError message={failed} onRetry={() => void load()} what="your awards" />
      ) : !data.hasData ? (
        <div className="rounded-xl border border-dashed border-edge p-8 text-center">
          <p className="text-sm font-medium">Nothing to celebrate yet</p>
          <p className="mt-1 text-sm text-secondary">
            Log a few days and the first award turns up on its own.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white"
          >
            Log today
          </Link>
        </div>
      ) : (
        <>
          {/* The rank. The one thing on the page that is a title rather than
              a count — and it is still only ever a description of days that
              are on the record. */}
          <section className="rounded-2xl border border-edge card p-5 shadow-md">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Your rank
            </p>
            <h2 className="text-brand-gradient mt-1 text-3xl font-bold tracking-tight">
              {data.rank.name}
            </h2>
            <p className="mt-2 text-sm text-secondary">{data.rank.blurb}</p>

            <Ladder step={data.rank.step} />

            {data.rank.next && (
              <div className="mt-4 rounded-lg border border-edge bg-surface-2 p-3">
                <p className="text-sm font-medium">
                  To reach {data.rank.next.name}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm text-secondary">
                  {data.rank.next.needs.map((n) => (
                    <li key={n}>· {n}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Awards earned. */}
          <section className="space-y-2">
            <h2 className="font-semibold">
              Earned{" "}
              <span className="text-sm font-normal text-muted">
                {earned.length} of {data.awards.length}
              </span>
            </h2>
            {earned.length === 0 ? (
              <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-secondary">
                The first one is seven days on the record.
              </p>
            ) : (
              <ul className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
                {earned.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col items-center gap-1 rounded-xl border border-edge card p-4 text-center shadow-sm"
                  >
                    <span className="text-3xl" aria-hidden="true">
                      {a.icon}
                    </span>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-xs text-secondary">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Not yet — shown as distance, never as failure. */}
          {nextUp.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Still to come</h2>
              <ul className="space-y-2">
                {nextUp.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 rounded-xl border border-edge card p-3 shadow-sm"
                  >
                    <span className="text-2xl opacity-40" aria-hidden="true">
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-secondary">
                        {a.detail}
                      </span>
                      <span
                        className="mt-1.5 block h-1 rounded-full bg-surface-2"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-1 rounded-full bg-accent"
                          style={{ width: `${Math.round(a.progress * 100)}%` }}
                        />
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {Math.round(a.progress * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Records. */}
          <section className="space-y-2">
            <h2 className="font-semibold">Records</h2>
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded-xl border border-edge card p-3 shadow-sm">
                <p className="text-xs text-muted">Longest run</p>
                <p className="text-xl font-semibold tabular-nums">
                  {data.standing.bestRun}{" "}
                  <span className="text-sm font-normal text-secondary">days</span>
                </p>
              </li>
              <li className="rounded-xl border border-edge card p-3 shadow-sm">
                <p className="text-xs text-muted">Days on the record</p>
                <p className="text-xl font-semibold tabular-nums">
                  {data.standing.daysLogged}
                </p>
              </li>
              {data.bestMonth && (
                <li className="rounded-xl border border-edge card p-3 shadow-sm">
                  <p className="text-xs text-muted">Best month</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {data.bestMonth.days}{" "}
                    <span className="text-sm font-normal text-secondary">days</span>
                  </p>
                  <p className="text-xs text-secondary">{data.bestMonth.month}</p>
                </li>
              )}
              {data.fullestDay && (
                <li className="rounded-xl border border-edge card p-3 shadow-sm">
                  <p className="text-xs text-muted">Fullest day</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {data.fullestDay.count}
                    <span className="text-sm font-normal text-secondary">
                      /{data.fullestDay.of}
                    </span>
                  </p>
                  <p className="text-xs text-secondary">
                    {prettyDate(data.fullestDay.date)}
                  </p>
                </li>
              )}
              {hours > 0 && (
                <li className="rounded-xl border border-edge card p-3 shadow-sm">
                  <p className="text-xs text-muted">Time tracked</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {hours.toLocaleString()}{" "}
                    <span className="text-sm font-normal text-secondary">h</span>
                  </p>
                </li>
              )}
            </ul>
          </section>

          {/* Personal bests, one line per tracker. */}
          {data.bests.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">Your best day at each of these</h2>
              <ul className="divide-y divide-edge rounded-xl border border-edge card shadow-sm">
                {data.bests.map((b) => (
                  <li
                    key={b.trackerId}
                    className="flex items-center gap-2 px-3 py-2.5"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(b.color) }}
                    />
                    <Link
                      href={`/tracker/${b.trackerId}`}
                      className="min-w-0 flex-1 truncate hover:text-accent"
                    >
                      {b.name}
                    </Link>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {b.value}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted sm:inline">
                      {prettyDate(b.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
