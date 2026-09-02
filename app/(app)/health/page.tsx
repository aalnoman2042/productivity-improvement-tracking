"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CardBoundary from "@/components/CardBoundary";
import CortisolCheckup from "@/components/CortisolCheckup";
import CortisolProfile from "@/components/CortisolProfile";
import HealthRisks from "@/components/HealthRisks";
import HealthTips from "@/components/HealthTips";
import LoadError from "@/components/LoadError";
import TrackerRoles from "@/components/TrackerRoles";
import { CortisolCurve, LevelTrend } from "@/components/charts";
import { toDateStr } from "@/lib/dates";
import { useMounted } from "@/lib/useMounted";
import {
  CORTISOL_CAVEAT,
  MEAN_REFERENCE,
  clockText,
  type Coverage,
  type CortisolProfile as Profile,
  type CortisolReport,
} from "@/lib/cortisol";
import { FLAGGED_NOTE, monthTitle, type Answers } from "@/lib/cortisolCheck";
import {
  REFERENCES,
  type Balance,
  type Domain,
  type HealthMetrics,
  type LevelPoint,
  type Timing,
} from "@/lib/health";
import { RISK_CAVEAT, type Forecast, type Risk } from "@/lib/healthRisk";
import type { ReadyTip } from "@/lib/healthTips";
import type { MissingRole } from "@/lib/trackerRoles";

/**
 * The health page.
 *
 * It was the cortisol page first, and cortisol is still on it — but a curve
 * modelled from sleep, food and movement was never really a page about one
 * hormone. It was a page about the handful of things that hormone is a proxy
 * for, and this is those things said directly: how much sleep you are
 * actually getting against the seven-to-nine hours the reference asks for,
 * how far off your own body-weight water target you are, whether the week has
 * 150 minutes of movement in it, how many hours a day you spend in a chair and
 * how much of that arrives unbroken, what that predicts about your back and
 * your eyes, and where the weight is heading.
 *
 * Three rules it inherits and keeps:
 *
 * 1. **It models, it never measures.** Every figure is derived from what you
 *    logged plus a questionnaire, every reference band is printed beside the
 *    number it judges, and the caveat sits above the fold rather than under
 *    the chart where caveats go to be ignored.
 * 2. **No number here is written by an AI.** The model's only job is reading
 *    what your trackers are called (`lib/roleAI`) — which is what makes the
 *    rest possible, because nobody names their trackers the same way. All the
 *    arithmetic is in `lib/health.ts` where it is tested.
 * 3. **A missing input is missing.** Anything the page cannot see is dropped
 *    from the weighting and named at the bottom, never scored as a good day.
 *
 * The **cortisol half specifically** still waits for a complete monthly
 * check-up, which is the rule it was built with: a partly-filled sheet scores
 * perfectly well, and that is the problem — it makes one month incomparable
 * with the next. Everything derived from the log alone works from day one.
 */

type Payload = {
  days: number;
  from: string;
  to: string;
  metrics: HealthMetrics;
  domains: Domain[];
  balance: Balance;
  timings: Timing[];
  levels: LevelPoint[];
  risks: Risk[];
  forecasts: Forecast[];
  tips: ReadyTip[];
  cortisol: CortisolReport;
  coverage: { roles: number; missing: MissingRole[]; cortisol: Coverage };
  roles: { assignments: unknown[]; aiAt: string | null; stale: boolean; never: boolean };
  check: {
    month: string | null;
    complete: boolean;
    due: boolean;
    thisMonth: string;
    score: number | null;
    confident: boolean;
  };
};

type CheckState = {
  month: string;
  due: boolean;
  complete: boolean;
  answers: Answers;
  prefilledFrom: string | null;
};

/** One domain, with what it measured and what it was measured against. */
function DomainCard({ domain }: { domain: Domain }) {
  const score = domain.score;
  const tone =
    score === null
      ? "text-muted"
      : score >= 70
        ? "text-green-700 dark:text-green-500"
        : score >= 55
          ? "text-secondary"
          : "text-amber-700 dark:text-amber-500";

  return (
    <div className="rounded-xl border border-edge card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">
          <span aria-hidden className="mr-1">
            {domain.icon}
          </span>
          {domain.label}
        </p>
        <p className={`shrink-0 text-2xl font-bold tabular-nums ${tone}`}>
          {score === null ? "—" : score}
        </p>
      </div>
      <p className="mt-1 text-sm font-medium">{domain.value}</p>
      <p className={`mt-0.5 text-sm ${tone}`}>{domain.band}</p>
      {/* The reference is not a footnote. A score with no band beside it is a
          mood, and this is the line that stops it being one. */}
      <p className="mt-2 border-t border-edge pt-2 text-xs text-muted">
        Against: {domain.reference}
      </p>
      <p className="mt-1 text-sm text-secondary">{domain.note}</p>
    </div>
  );
}

export default function HealthPage() {
  const router = useRouter();
  // The clock is a client fact and the dates that come back are rendered, so
  // the body waits for mount rather than painting the build's "today".
  const mounted = useMounted();

  const [data, setData] = useState<Payload | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [days, setDays] = useState(14);
  const [failed, setFailed] = useState("");
  const [loading, setLoading] = useState(true);
  const [retaking, setRetaking] = useState(false);
  const [showRefs, setShowRefs] = useState(false);

  const load = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setFailed("");
      const today = toDateStr(new Date());
      try {
        const [res, checkRes] = await Promise.all([
          fetch(`/api/health?today=${today}&days=${windowDays}`),
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

  const reload = useCallback(() => {
    void load(days);
  }, [load, days]);

  function onProfileSaved(next: Profile) {
    // The curve is drawn partly from age and sex, so a save redraws it.
    if (data) setData({ ...data, cortisol: { ...data.cortisol, profile: next } });
    reload();
  }

  // Everything computed before the first early return — see check:shape.
  const metrics = data?.metrics ?? null;
  const cortisol = data?.cortisol ?? null;
  const curve = cortisol?.curve ?? null;
  const balance = data?.balance ?? null;
  // The cortisol half waits for a complete sheet; the rest never did. The
  // filtering happens on the server (see /api/health) so that the balance
  // above is an average of exactly the cards below it — this is just the name.
  const cortisolReady = data?.check.complete === true;
  const logDomains = data?.domains ?? [];
  const nothingYet = data !== null && data.domains.length === 0;
  const takingCheck = retaking || (check !== null && !check.complete);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🩺 Health</h1>
        <p className="mt-1 text-sm text-secondary">
          What your own log says about your sleep, hydration, movement, sitting,
          food and rhythm — each one against the reference band it is judged by.
        </p>
      </div>

      {/* Above everything, deliberately. A caveat under a graph is a caveat
          nobody reads, and this is the one thing here that must not be. */}
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-secondary">
        <span className="font-semibold text-amber-700 dark:text-amber-500">
          Calculated, not diagnosed.{" "}
        </span>
        Everything here is arithmetic on numbers you typed, compared with
        published reference ranges. A reference range describes most people; it
        is not a statement about you, and none of this is medical advice.{" "}
        {CORTISOL_CAVEAT}
      </p>

      {!mounted || (!data && loading) ? (
        <div className="skeleton h-64 w-full" aria-hidden="true" />
      ) : !data || !metrics || !balance ? (
        <LoadError message={failed} onRetry={reload} what="your health report" />
      ) : (
        <>
          {/* The headline. Renormalised over the domains that exist, and it
              says how many those are rather than implying it saw everything. */}
          <section className="rounded-2xl border border-edge card p-5 shadow-md">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  Overall balance
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-brand-gradient text-4xl font-bold tabular-nums">
                    {balance.score ?? "—"}
                  </span>
                  <span className="text-lg text-secondary">/ 100</span>
                  <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-muted">
                    {balance.band}
                  </span>
                </p>
                <p className="mt-2 text-sm text-secondary">
                  Across {balance.scored} of {balance.possible} areas this page
                  can score. The others are not counted as zero — they are not
                  counted at all, which is why adding a tracker moves this.
                </p>
              </div>
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

            {balance.weakest.length > 0 && (
              <p className="mt-3 text-sm">
                <span className="font-medium">Weakest: </span>
                <span className="text-secondary">
                  {balance.weakest.map((d) => `${d.label} (${d.score})`).join(", ")}
                  {/* `strongest` comes back best-first, so index 0 is the
                      best one — reading the last element named the runner-up
                      on every account with more than one scored domain. */}
                  {balance.strongest.length > 0 &&
                    !balance.weakest.some((w) => w.id === balance.strongest[0].id) && (
                      <>
                        {" — strongest is "}
                        {balance.strongest[0].label}.
                      </>
                    )}
                </span>
              </p>
            )}
          </section>

          {nothingYet ? (
            <div className="rounded-xl border border-dashed border-edge p-8 text-center">
              <p className="text-sm font-medium">Nothing to read yet</p>
              <p className="mt-1 text-sm text-secondary">
                This page is built entirely from your own trackers. Add a sleep
                tracker first — the whole rhythm hangs off when you wake — then
                whatever else you want measured.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link
                  href="/trackers"
                  className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white"
                >
                  Add a tracker
                </Link>
                {!takingCheck && (
                  <button
                    type="button"
                    onClick={() => setRetaking(true)}
                    className="rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
                  >
                    {check?.complete ? "Answer the check-up again" : "Take the monthly check-up"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Every domain, each with its reference band printed on it.
                  Three across where there is room: ten of these stacked is a
                  scroll, and the whole value of a dashboard is seeing the set
                  at once rather than remembering the one above. */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {logDomains.map((d) => (
                  <DomainCard key={d.id} domain={d} />
                ))}
              </div>

              {data.timings.length > 0 && (
                <section className="rounded-2xl border border-edge card p-5 shadow-md">
                  <h2 className="font-semibold">Your clock, worked out</h2>
                  <p className="mt-1 text-sm text-secondary">
                    Subtractions from your own median night rather than advice
                    for a person in general. If you are up at{" "}
                    {clockText(metrics.sleep.medianWake)}, these are the times
                    that follow from it.
                  </p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data.timings.map((t) => (
                      <li
                        key={t.id}
                        className="rounded-lg border border-edge bg-surface-2 p-3"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium tracking-wide text-muted uppercase">
                            {t.label}
                          </span>
                          <span className="font-semibold tabular-nums text-accent">
                            {t.time}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-secondary">{t.why}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <HealthTips tips={data.tips} />

              <HealthRisks
                risks={data.risks}
                forecasts={data.forecasts}
                caveat={RISK_CAVEAT}
              />

              {/* ---------------------------- cortisol ---------------------- */}
              {!cortisolReady ? (
                <section className="rounded-2xl border border-edge card p-5 shadow-md">
                  <h2 className="font-semibold">🧪 The cortisol estimate is waiting</h2>
                  <p className="mt-2 text-sm text-secondary">
                    Everything above comes from your daily log. The cortisol
                    curve also needs the monthly check-up — the things no
                    tracker can see: how long sleep takes to arrive, whether
                    your morning has daylight in it, when the last coffee was,
                    whether you work shifts.
                  </p>
                  <p className="mt-2 text-sm text-secondary">
                    It has to be answered in full, and that is deliberate. A
                    half-filled sheet scores perfectly well, which is exactly
                    the problem: it would make this month incomparable with the
                    next one.
                  </p>
                  {!takingCheck && (
                    <button
                      type="button"
                      onClick={() => setRetaking(true)}
                      className="mt-4 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white"
                    >
                      Take the check-up
                    </button>
                  )}
                </section>
              ) : (
                <>
                  <section className="rounded-2xl border border-edge card p-5 shadow-md">
                    <p className="text-xs font-medium tracking-wide text-muted uppercase">
                      Modelled cortisol, average across the day
                    </p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-2">
                      <span className="text-brand-gradient text-4xl font-bold tabular-nums">
                        {cortisol?.meanNmol ?? "—"}
                      </span>
                      <span className="text-lg text-secondary">nmol/L</span>
                      <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-muted">
                        estimated
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-secondary">
                      A healthy adult&apos;s daily mean usually sits between{" "}
                      {MEAN_REFERENCE.low} and {MEAN_REFERENCE.high} nmol/L in
                      saliva — never serum, which differs about twentyfold and
                      would read as a blood test.
                    </p>
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-muted">Morning peak</dt>
                        <dd className="font-medium tabular-nums">
                          {cortisol?.peakNmol ?? "—"} nmol/L
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Evening (10 pm)</dt>
                        <dd className="font-medium tabular-nums">
                          {cortisol?.eveningNmol ?? "—"} nmol/L
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Check-up</dt>
                        <dd className="font-medium tabular-nums">
                          {data.check.score ?? "—"} / 100
                        </dd>
                      </div>
                    </dl>
                  </section>

                  {!data.check.confident && (
                    <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-secondary">
                      <span className="font-semibold text-amber-700 dark:text-amber-500">
                        Read this with care.{" "}
                      </span>
                      {FLAGGED_NOTE}
                    </p>
                  )}

                  {/* Both charts in one row on a wide screen. Recharts sizes
                      itself to the container, so the only thing that decides
                      whether they fit is whether the axis labels still read —
                      hence 2-up only past xl. */}
                  <div className="grid gap-3 xl:grid-cols-2">
                  {data.levels.some((p) => p.nmol !== null) && (
                    <CardBoundary title="The level, day by day">
                      <section className="rounded-2xl border border-edge card p-5 shadow-md">
                        <h2 className="font-semibold">The trend, against your sleep</h2>
                        <p className="mt-1 text-sm text-secondary">
                          The line is the modelled level for each day; the bars
                          are how long you slept that night. The shaded band is
                          the {MEAN_REFERENCE.low}-{MEAN_REFERENCE.high} nmol/L
                          reference. The trend is the honest half of this page —
                          an absolute level is a guess, but the direction of a
                          fortnight where the wake time stopped moving is not.
                        </p>
                        <div className="mt-3">
                          <LevelTrend points={data.levels} />
                        </div>
                        <p className="mt-3 text-sm text-secondary">
                          A day with no bedtime and wake time on it is a gap
                          rather than a zero — the line breaks instead of
                          drawing straight through a night nobody logged.
                        </p>
                      </section>
                    </CardBoundary>
                  )}

                  {curve && (
                    <CardBoundary title="The curve">
                      <section className="rounded-2xl border border-edge card p-5 shadow-md">
                        <h2 className="font-semibold">A typical recent day</h2>
                        <p className="mt-1 text-sm text-secondary">
                          Anchored to your usual{" "}
                          {clockText(cortisol?.medianWake ?? null)} wake — the
                          peak lands about 35 minutes after it, wherever on the
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
                          The swing — {curve.swing}× between peak and trough —
                          is the number worth watching. A flattened day keeps
                          its floor up, and that shows here as a smaller
                          multiple rather than as a lower morning.
                        </p>
                      </section>
                    </CardBoundary>
                  )}
                  </div>

                  <section className="rounded-xl border border-edge card p-4 shadow-sm">
                    <h2 className="font-semibold">Monthly check-up</h2>
                    <p className="mt-1 text-sm text-secondary">
                      {data.check.month
                        ? `Answered in full for ${monthTitle(data.check.month)}, scoring ${data.check.score ?? "—"} out of 100. The next one comes due when the month turns.`
                        : "Answered in full."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRetaking(true)}
                      className="mt-3 rounded-lg border border-edge px-4 py-2 text-sm text-secondary hover:bg-surface-2"
                    >
                      Answer again
                    </button>
                  </section>
                </>
              )}

            </>
          )}

          {/* Outside both branches on purpose. It used to live inside the
              "has data" one, which meant an account with an empty window —
              a returning user, a new account — saw "Nothing to read yet" and
              had no way to reach the check-up at all. /cortisol used to be
              that escape hatch and now redirects here, so this is the only
              door there is. */}
          {takingCheck && check && (
            <CortisolCheckup
              month={check.month}
              initial={check.answers}
              prefilledFrom={check.prefilledFrom}
              onSaved={() => {
                setRetaking(false);
                reload();
              }}
              onCancel={retaking ? () => setRetaking(false) : undefined}
            />
          )}

          {/* What each tracker was read as, and the AI button that improves it. */}
          <TrackerRoles onChanged={reload} />

          <CortisolProfile
            profile={data.cortisol.profile}
            onSaved={onProfileSaved}
          />

          {/* Every band on this page, with where it came from. */}
          <section className="rounded-xl border border-edge card p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setShowRefs((v) => !v)}
              className="text-sm font-semibold text-accent underline underline-offset-2"
            >
              {showRefs ? "Hide the reference values" : "Where every band on this page comes from"}
            </button>
            {showRefs && (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {REFERENCES.map((r) => (
                  <li key={r.id} className="rounded-lg border border-edge bg-surface-2 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{r.label}</span>
                      <span className="text-sm text-accent">{r.band}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-secondary">{r.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
