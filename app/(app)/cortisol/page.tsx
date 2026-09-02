"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CardBoundary from "@/components/CardBoundary";
import CortisolCheckup from "@/components/CortisolCheckup";
import CortisolProfile from "@/components/CortisolProfile";
import LoadError from "@/components/LoadError";
import { CortisolCurve } from "@/components/charts";
import { toDateStr } from "@/lib/dates";
import { useMounted } from "@/lib/useMounted";
import {
  CORTISOL_CAVEAT,
  MEAN_REFERENCE,
  clockText,
  coverageOf,
  loadBand,
  meanBand,
  rhythmBand,
  summaryLine,
  type CortisolProfile as Profile,
  type CortisolReport,
  type Suggestion,
} from "@/lib/cortisol";
import {
  FLAGGED_NOTE,
  monthTitle,
  type Answers,
} from "@/lib/cortisolCheck";

/**
 * The cortisol page.
 *
 * **A model, and it says so before it says anything else.** Cortisol is
 * measured in saliva, blood or urine and this app touches none of them. What
 * it does is take the day's own record — when you slept and how steadily,
 * what you ate, whether you moved — together with a monthly check-up that
 * asks the things a tracker cannot know, and draw the diurnal curve those
 * inputs usually produce. The average of that curve is the headline, because
 * an average level is the number people actually want; it is printed with
 * "est." beside it every single time, and the caveat sits above the chart
 * rather than under it, where caveats go to be ignored.
 *
 * The trend is the honest half. An absolute level is a guess. The direction
 * of a fortnight where the wake time stopped moving is not.
 *
 * **The check-up gates the page.** Nothing is shown until every question of
 * this month's form is answered — not because the model cannot run on less,
 * but because it can, and a score built from a partly-filled sheet is not
 * comparable with last month's or with anybody else's. There is no skip.
 *
 * Reached from Account rather than the nav, like the awards page, and gated
 * while it is in testing (`lib/admin`) — a decision about who may see the
 * page, never about whose data it reads. It has only ever read your own.
 */

type Payload = {
  report: CortisolReport;
  days: number;
  from: string;
  to: string;
  due: boolean;
};

type CheckState = {
  month: string;
  due: boolean;
  complete: boolean;
  answers: Answers;
  prefilledFrom: string | null;
};

/** A score out of 100, with which way is good made explicit. */
function Score({
  label,
  value,
  band,
  previous,
  goodIsHigh,
}: {
  label: string;
  value: number | null;
  band: string;
  previous: number | null;
  goodIsHigh: boolean;
}) {
  const delta = value !== null && previous !== null ? value - previous : null;
  // Up is not always good: a rising rhythm score is progress, a rising load
  // is not, so the colour follows the meaning rather than the arrow.
  const better = delta === null ? null : goodIsHigh ? delta > 0 : delta < 0;

  return (
    <div className="rounded-xl border border-edge card p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums">
        {value === null ? "—" : value}
        {value !== null && (
          <span className="text-base font-normal text-muted"> / 100</span>
        )}
      </p>
      <p className="mt-1 text-sm text-secondary">{band}</p>
      {delta !== null && Math.abs(delta) >= 1 && (
        <p
          className={`mt-2 text-sm font-medium ${
            better
              ? "text-green-700 dark:text-green-500"
              : "text-amber-700 dark:text-amber-500"
          }`}
        >
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs the first half
        </p>
      )}
    </div>
  );
}

/** A day of the window as one bar, so a fortnight reads at a glance. */
function Strip({
  title,
  values,
  goodIsHigh,
}: {
  title: string;
  values: { date: string; value: number | null }[];
  goodIsHigh: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 flex h-16 items-end gap-1">
        {values.map((d) => {
          const v = d.value;
          // A day with nothing on it is drawn as a gap, never as a zero —
          // the same rule the rest of the app keeps about blank days.
          if (v === null) {
            return (
              <div
                key={d.date}
                className="flex-1 rounded-sm border border-dashed border-edge"
                style={{ height: 6 }}
                title={`${d.date} — nothing logged`}
              />
            );
          }
          const strong = goodIsHigh ? v >= 65 : v <= 40;
          return (
            <div
              key={d.date}
              className={`flex-1 rounded-sm ${strong ? "bg-accent" : "bg-amber-500"}`}
              style={{ height: `${Math.max(6, (v / 100) * 64)}px` }}
              title={`${d.date} — ${v}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * What to log next, worst gap first.
 *
 * Deliberately specific and deliberately reasoned: "add a diet tracker"
 * without saying what it would change is a chore, and "your rhythm is
 * modelled from four nights" is a reason. Each one says what it would buy.
 */
function Suggestions({
  items,
  pct,
  label,
}: {
  items: Suggestion[];
  pct?: number;
  label?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-edge card p-5 shadow-md">
      <h2 className="font-semibold">To make this a better estimate</h2>
      {pct !== undefined && (
        <>
          <p className="mt-1 text-sm text-secondary">
            The model can see <span className="font-medium tabular-nums">{pct}%</span>{" "}
            of what it asks for — {label}.
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
      <ul className="mt-4 space-y-3">
        {items.map((s) => (
          <li key={s.id} className="rounded-lg border border-edge bg-surface-2 p-3">
            <Link
              href={s.href}
              className="text-sm font-medium text-accent underline underline-offset-2"
            >
              {s.title}
            </Link>
            <p className="mt-1 text-sm text-secondary">{s.why}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Whether one input was found, said plainly. */
function Source({
  label,
  id,
  extra,
}: {
  label: string;
  id: string | null;
  extra?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={id ? "text-green-700 dark:text-green-500" : "text-muted"}>
        {id ? (extra ?? "found") : "not found"}
      </span>
    </li>
  );
}

export default function CortisolPage() {
  const router = useRouter();
  // The clock is a client fact, and the dates that come back are rendered —
  // so the body waits for mount rather than painting the build's "today".
  const mounted = useMounted();

  const [data, setData] = useState<Payload | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [days, setDays] = useState(14);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(true);
  /** Set when the reader asks to answer again on a month already done. */
  const [retaking, setRetaking] = useState(false);

  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setFailed("");
      const today = toDateStr(new Date());
      try {
        const [res, checkRes] = await Promise.all([
          fetch(`/api/cortisol?today=${today}&days=${windowDays}`),
          fetch(`/api/cortisol/check?today=${today}`),
        ]);
        if (res.status === 401) {
          window.location.assign("/login");
          return;
        }
        // 404 is how the gate answers someone this page isn't for — the
        // endpoint's existence is itself part of what is gated.
        if (res.status === 404) {
          router.replace("/settings");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as Payload);
        if (checkRes.ok) setCheck((await checkRes.json()) as CheckState);
      } catch {
        setFailed("Couldn't load — check your connection");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    // Out of the effect's synchronous phase — the lint rule this repo enforces.
    void Promise.resolve().then(() => load(days));
  }, [load, days]);

  const report = data?.report ?? null;
  const curve = report?.curve ?? null;
  const answeredCheck = report?.check ?? null;
  const coverage = report && data ? coverageOf(report, data.days) : null;

  function onProfileSaved(next: Profile) {
    // The curve is drawn partly from age and sex, so a save redraws it.
    if (report && data) setData({ ...data, report: { ...report, profile: next } });
    void load(days);
  }

  // The form is the page until this month's sheet is complete. No skip, no
  // partial read — that is the whole point of requiring all of it.
  const showForm = retaking || !check?.complete;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🧪 Cortisol</h1>
        <p className="mt-1 text-sm text-secondary">
          The average level and daily rhythm your sleep, food, movement and
          monthly check-up together imply.
        </p>
      </div>

      {/* Above everything, deliberately. A caveat under a graph is a caveat
          nobody reads, and this is the one thing here that must not be. */}
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-secondary">
        <span className="font-semibold text-amber-700 dark:text-amber-500">
          Estimate, not a measurement.{" "}
        </span>
        {CORTISOL_CAVEAT}
      </p>

      {!mounted || (!data && loading) ? (
        <div className="skeleton h-64 w-full" aria-hidden="true" />
      ) : !report ? (
        <LoadError
          message={failed}
          onRetry={() => void load(days)}
          what="your cortisol estimate"
        />
      ) : showForm && check ? (
        <CortisolCheckup
          month={check.month}
          initial={check.answers}
          prefilledFrom={check.prefilledFrom}
          onSaved={() => {
            setRetaking(false);
            void load(days);
          }}
          onCancel={retaking ? () => setRetaking(false) : undefined}
        />
      ) : report.nightsRead === 0 ? (
        <>
          <div className="rounded-xl border border-dashed border-edge p-8 text-center">
            <p className="text-sm font-medium">Not enough on record yet</p>
            <p className="mt-1 text-sm text-secondary">
              The whole curve is anchored to when you woke up, so it needs a
              sleep tracker with bedtimes and wake times on it — a nightly
              total alone cannot place a rhythm on the clock.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white"
            >
              Log a night
            </Link>
          </div>
          {coverage && (
            <Suggestions
              items={coverage.suggestions}
              pct={coverage.pct}
              label={coverage.label}
            />
          )}
        </>
      ) : (
        <>
          {/* The headline: an average level, which is the number that was
              actually asked for. Reference band beside it, because 6.4 means
              nothing to anybody without one. */}
          <section className="rounded-2xl border border-edge card p-5 shadow-md">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Average level across the day
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-brand-gradient text-4xl font-bold tabular-nums">
                {report.meanNmol ?? "—"}
              </span>
              <span className="text-lg text-secondary">nmol/L</span>
              <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-muted">
                estimated
              </span>
            </p>
            <p className="mt-2 text-sm text-secondary">
              {meanBand(report.meanNmol)} — a healthy adult&apos;s daily mean
              usually sits between {MEAN_REFERENCE.low} and{" "}
              {MEAN_REFERENCE.high} nmol/L in saliva.
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-muted">Morning peak</dt>
                <dd className="font-medium tabular-nums">
                  {report.peakNmol ?? "—"} nmol/L
                </dd>
              </div>
              <div>
                <dt className="text-muted">Evening (10 pm)</dt>
                <dd className="font-medium tabular-nums">
                  {report.eveningNmol ?? "—"} nmol/L
                </dd>
              </div>
              <div>
                <dt className="text-muted">Cortisol health</dt>
                <dd className="font-medium tabular-nums">
                  {report.health ?? "—"} / 100
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm">{summaryLine(report)}</p>
          </section>

          {coverage && coverage.suggestions.length > 0 && (
            <Suggestions
              items={coverage.suggestions}
              pct={coverage.pct}
              label={coverage.label}
            />
          )}

          {answeredCheck && !answeredCheck.confident && (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-secondary">
              <span className="font-semibold text-amber-700 dark:text-amber-500">
                Read this with care.{" "}
              </span>
              {FLAGGED_NOTE}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Score
              label="Rhythm"
              value={report.rhythm}
              band={rhythmBand(report.rhythm)}
              previous={report.previousRhythm}
              goodIsHigh
            />
            <Score
              label="Load on it"
              value={report.load}
              band={loadBand(report.load)}
              previous={report.previousLoad}
              goodIsHigh={false}
            />
          </div>

          {curve && (
            <CardBoundary title="The curve">
              <section className="rounded-2xl border border-edge card p-5 shadow-md">
                <h2 className="font-semibold">A typical recent day</h2>
                <p className="mt-1 text-sm text-secondary">
                  Anchored to your usual {clockText(report.medianWake)} wake —
                  the peak lands about 35 minutes after it, wherever on the
                  clock that falls.
                </p>
                <div className="mt-3">
                  <CortisolCurve
                    points={curve.points}
                    wake={curve.wake}
                    bed={curve.bed}
                    peakMinute={curve.peakMinute}
                  />
                </div>
                <p className="mt-3 text-sm text-secondary">
                  The swing — {curve.swing}× between peak and trough — is the
                  number worth watching. A well-defined day falls a long way by
                  evening; a flattened one keeps its floor up, and that shows
                  here as a smaller multiple rather than as a lower morning.
                </p>
              </section>
            </CardBoundary>
          )}

          <section className="rounded-2xl border border-edge card p-5 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Across the window</h2>
              <div className="flex gap-1">
                {[7, 14, 30].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDays(n)}
                    className={`rounded-md px-2.5 py-1 text-sm ${
                      days === n
                        ? "bg-accent text-white"
                        : "border border-edge text-secondary hover:bg-surface-2"
                    }`}
                  >
                    {n}d
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <Strip
                title="Rhythm, day by day"
                values={report.days.map((d) => ({ date: d.date, value: d.rhythm }))}
                goodIsHigh
              />
              <Strip
                title="Load, day by day"
                values={report.days.map((d) => ({ date: d.date, value: d.load }))}
                goodIsHigh={false}
              />
            </div>

            <p className="mt-4 text-sm text-secondary">
              {report.nightsRead} night
              {report.nightsRead === 1 ? "" : "s"} with clock times out of{" "}
              {data?.days} days.
            </p>
          </section>

          {report.drivers.length > 0 && (
            <section className="rounded-2xl border border-edge card p-5 shadow-md">
              <h2 className="font-semibold">What is pushing hardest</h2>
              <p className="mt-1 text-sm text-secondary">
                Averaged across the window, not taken from one day — the
                question is what keeps happening.
              </p>
              <ul className="mt-3 space-y-3">
                {report.drivers.map((d) => (
                  <li key={d.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{d.label}</span>
                      <span className="text-sm text-secondary">{d.note}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${Math.round(d.value * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">Monthly check-up</h2>
            <p className="mt-1 text-sm text-secondary">
              {answeredCheck
                ? `Answered in full for ${monthTitle(answeredCheck.month)}, scoring ${answeredCheck.score ?? "—"} out of 100. The next one comes due when the month turns.`
                : "Answered in full."}
            </p>
            <button
              type="button"
              onClick={() => setRetaking(true)}
              className="mt-3 rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
            >
              {answeredCheck ? "Answer again" : "Take the check-up"}
            </button>
          </section>

          <CortisolProfile profile={report.profile} onSaved={onProfileSaved} />

          <section className="rounded-xl border border-edge card p-4 shadow-sm">
            <h2 className="font-semibold">What it read</h2>
            <ul className="mt-2 space-y-1 text-sm text-secondary">
              <Source label="Sleep" id={report.sources.sleepId} />
              <Source label="Diet quality" id={report.sources.dietId} />
              <Source label="Junk food" id={report.sources.junkId} />
              <Source
                label="Movement"
                id={report.sources.exerciseIds[0] ?? null}
                extra={
                  report.sources.exerciseIds.length > 1
                    ? `${report.sources.exerciseIds.length} trackers`
                    : undefined
                }
              />
              <Source label="Mood" id={report.sources.moodId} />
            </ul>
            <p className="mt-3 text-sm text-secondary">
              A source it could not find is left out of the model entirely
              rather than scored as a good day — which is why adding the
              missing tracker changes the numbers here, and why it should.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
