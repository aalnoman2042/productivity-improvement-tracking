"use client";

import { useEffect, useState } from "react";
import { prettyDate, toDateStr } from "@/lib/dates";
import { useCached } from "@/lib/useCached";
import {
  COACH_COOLDOWN_MS,
  type CoachReview,
  type CoachSnapshot,
} from "@/lib/coach";

type Stored = {
  review: CoachReview | null;
  text: string;
  snapshot?: CoachSnapshot | null;
  today: string | null;
  createdAt: string;
} | null;

/**
 * 🧠 Life right now — the AI coach's read of the whole picture.
 *
 * Strictly on demand, once every 8 hours: the page only ever *reads* the
 * last stored analysis (free, instant, works offline); the AI runs when the
 * button is pressed and the server allows it. Only numbers and tracker
 * names are sent — no notes.
 *
 * The card is built to be understood in about ten seconds: the score, which
 * way it's moving and the last two weeks as bars come first — all computed
 * by the app, so they're true regardless of how the model wrote that day —
 * and the AI's words sit underneath them.
 */

/** Score bands, shared by the ring, the bars and the number. */
function tone(score: number): { text: string; fill: string; label: string } {
  if (score >= 80)
    return { text: "text-green-700 dark:text-green-500", fill: "bg-green-600", label: "Strong day" };
  if (score >= 60)
    return { text: "text-accent", fill: "bg-accent", label: "Decent day" };
  if (score >= 40)
    return { text: "text-amber-700 dark:text-amber-500", fill: "bg-amber-500", label: "Shaky day" };
  return { text: "text-red-600", fill: "bg-red-500", label: "Rough day" };
}

const MOMENTUM: Record<
  NonNullable<CoachSnapshot["momentum"]>,
  { icon: string; word: string; className: string }
> = {
  rising: {
    icon: "↗",
    word: "Rising",
    className: "border-green-700/40 bg-green-700/10 text-green-700 dark:text-green-500",
  },
  steady: {
    icon: "→",
    word: "Steady",
    className: "border-edge bg-surface-2 text-secondary",
  },
  slipping: {
    icon: "↘",
    word: "Slipping",
    className: "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500",
  },
};

/** "25 Jul" — the weekday is already obvious from the bar's position. */
const shortDay = (date: string) => prettyDate(date).split(" ").slice(1).join(" ");

/** The score, as a ring you can read without reading the number. */
function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative h-17 w-17 shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          className="stroke-edge"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          className={`${tone(score).text} transition-[stroke-dasharray] duration-700`}
          stroke="currentColor"
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums ${tone(score).text}`}
      >
        {score}
      </span>
    </div>
  );
}

/**
 * The verdict before the reading.
 *
 * Four words, one colour each — because the first question is "am I alright?"
 * and making someone parse three sentences to answer it is the thing this
 * card kept getting wrong.
 */
const STATE_LOOK: Record<string, { label: string; className: string }> = {
  thriving: {
    label: "Thriving",
    className: "border-green-700/40 bg-green-700/10 text-green-700 dark:text-green-500",
  },
  steady: {
    label: "Steady",
    className: "border-accent/40 bg-accent/10 text-accent",
  },
  slipping: {
    label: "Slipping",
    className: "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500",
  },
  stalled: {
    label: "Stalled",
    className: "border-red-600/40 bg-red-600/10 text-red-600",
  },
};

function StateChip({ state }: { state: string }) {
  const look = STATE_LOOK[state];
  if (!look) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${look.className}`}
    >
      {look.label}
    </span>
  );
}

/** The window as bars: two weeks of days, tallest is best. */
function Sparkline({ days }: { days: CoachSnapshot["days"] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-11 items-end gap-0.75">
        {days.map((d, i) => {
          const last = i === days.length - 1;
          return (
            <div
              key={d.date}
              title={`${prettyDate(d.date)} — ${d.score === null ? "nothing logged" : `${d.score}/100`}`}
              className="flex h-full flex-1 items-end"
            >
              {d.score === null ? (
                <div className="h-0.75 w-full rounded-full bg-edge" />
              ) : (
                <div
                  style={{ height: `${Math.max(8, d.score)}%` }}
                  className={`w-full rounded-sm ${tone(d.score).fill} ${
                    last ? "ring-2 ring-accent/40 ring-offset-1 ring-offset-transparent" : ""
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{days.length > 0 ? shortDay(days[0].date) : ""}</span>
        <span>Last {days.length} days</span>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-edge bg-surface-2 px-2.5 py-1 text-xs font-medium text-secondary">
      {children}
    </span>
  );
}

/** The whole picture in one strip — no model involved in any of these. */
function Snapshot({ s }: { s: CoachSnapshot }) {
  const m = s.momentum ? MOMENTUM[s.momentum] : null;
  const delta =
    s.avg7 !== null && s.prevAvg7 !== null ? s.avg7 - s.prevAvg7 : null;

  return (
    <div className="rounded-xl border border-edge bg-surface-2/60 p-3">
      <div className="flex items-center gap-3">
        {s.score !== null ? (
          <ScoreRing score={s.score} />
        ) : (
          <div className="flex h-17 w-17 shrink-0 items-center justify-center rounded-full border-4 border-edge text-lg font-bold text-muted">
            —
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">
              {s.score !== null ? tone(s.score).label : "Nothing scored yet"}
            </span>
            {m && (
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${m.className}`}
              >
                {m.icon} {m.word}
                {delta !== null && delta !== 0
                  ? ` ${delta > 0 ? "+" : ""}${delta}`
                  : ""}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {s.scoreDate ? `Day score, ${shortDay(s.scoreDate)}` : "Day score"}
            {s.avg7 !== null ? ` · ${s.avg7} avg this week` : ""}
            {s.prevAvg7 !== null ? ` · ${s.prevAvg7} the week before` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Sparkline days={s.days} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Chip>
          📆 {s.daysLogged}/{s.windowDays} days logged
        </Chip>
        {s.streak > 0 && <Chip>🔥 {s.streak}-day logging streak</Chip>}
        {s.grade && <Chip>🎓 {s.grade} overall</Chip>}
        {s.sleep && <Chip>😴 {s.sleep}</Chip>}
      </div>
    </div>
  );
}

function PointList({
  title,
  tint,
  points,
}: {
  title: string;
  tint: "good" | "warn";
  points: CoachReview["working"];
}) {
  const skin =
    tint === "good"
      ? {
          box: "border-green-700/30 bg-green-700/5",
          head: "text-green-700 dark:text-green-500",
          dot: "bg-green-600",
        }
      : {
          box: "border-amber-600/30 bg-amber-600/5",
          head: "text-amber-700 dark:text-amber-500",
          dot: "bg-amber-500",
        };
  return (
    <div className={`rounded-xl border p-3 ${skin.box}`}>
      <h3 className={`flex items-center gap-1.5 text-sm font-bold ${skin.head}`}>
        {title}
        <span className="rounded-full bg-surface px-1.5 py-px text-[11px] font-semibold tabular-nums text-secondary">
          {points.length}
        </span>
      </h3>
      <ul className="mt-2 space-y-2.5">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${skin.dot}`} />
            <span className="min-w-0">
              <span className="font-medium">{p.point}</span>
              {p.evidence && (
                <span className="mt-0.5 block text-xs tabular-nums text-muted">
                  {p.evidence}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LifeNow() {
  const q = useCached<Stored>("/api/coach", "aiReview");
  const stored = q.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A clock the countdown can read *purely* — same pattern as the timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The countdown the server will enforce anyway, shown up front.
  const waitMs = stored
    ? new Date(stored.createdAt).getTime() + COACH_COOLDOWN_MS - now
    : 0;
  const coolingDown = waitMs > 0;
  const waitLabel = (() => {
    const h = Math.floor(waitMs / 3_600_000);
    const m = Math.ceil((waitMs % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  async function analyze() {
    if (busy || coolingDown) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ today: toDateStr(new Date()) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not analyze");
      q.update(data as Stored);
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "Failed to fetch"
          ? err.message
          : "You need to be online to run the analysis"
      );
    } finally {
      setBusy(false);
    }
  }

  const review = stored?.review ?? null;
  const snapshot = stored?.snapshot ?? null;

  return (
    <section className="overflow-hidden rounded-2xl border border-accent/40 card shadow-sm">
      {/* The band: what this is, and the one button that runs it. */}
      <div className="bg-brand-gradient px-4 py-3.5 text-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-bold tracking-tight">
              <span className="text-lg leading-none">🧠</span> Life right now
            </h2>
            <p className="mt-0.5 text-xs text-white/80">
              {stored
                ? `AI read of your own numbers${stored.today ? `, as of ${prettyDate(stored.today)}` : ""}`
                : "An honest AI read of your whole record, in one card"}
            </p>
          </div>
          <button
            onClick={analyze}
            disabled={busy || coolingDown}
            title={coolingDown ? "The coach reads your life once every 8 hours" : undefined}
            className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 backdrop-blur hover:bg-white/25 disabled:opacity-60"
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-white/40 border-t-white" />
                Reading…
              </span>
            ) : coolingDown ? (
              `Next read in ${waitLabel}`
            ) : stored ? (
              "Analyze again"
            ) : (
              "Analyze my life"
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3.5 p-4">
        {error && (
          <p className="rounded-lg border border-red-600/40 bg-red-600/5 p-2.5 text-sm text-red-600">
            {error}
          </p>
        )}

        {busy && !stored && (
          <div className="space-y-3" aria-hidden="true">
            <div className="skeleton h-28 rounded-xl" />
            <div className="skeleton h-16 rounded-xl" />
          </div>
        )}

        {/* The numbers first — these are the app's, not the model's. */}
        {snapshot && <Snapshot s={snapshot} />}

        {review ? (
          <div className="stagger space-y-3.5">
            <div>
              {review.state && (
                <div className="mb-2">
                  <StateChip state={review.state} />
                </div>
              )}
              <p className="text-brand-gradient text-lg font-extrabold leading-snug tracking-tight">
                {review.headline}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-secondary">
                {review.verdict}
              </p>
            </div>

            {(review.working.length > 0 || review.slipping.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {review.working.length > 0 && (
                  <PointList title="✓ Working" tint="good" points={review.working} />
                )}
                {review.slipping.length > 0 && (
                  <PointList title="⚠ Slipping" tint="warn" points={review.slipping} />
                )}
              </div>
            )}

            <div className="rounded-xl border border-accent/50 bg-accent/5 p-3">
              <h3 className="text-sm font-bold text-accent">🎯 Fix this first</h3>
              <p className="mt-1 text-sm font-medium">{review.fix.what}</p>

              <p className="mt-2.5 rounded-lg border border-accent/30 bg-surface px-2.5 py-2 text-sm">
                <span className="font-semibold text-accent">Tonight · </span>
                {review.fix.tonight}
              </p>

              {review.week && review.week.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    Rest of the week
                  </p>
                  <ol className="mt-1.5 space-y-1.5">
                    {review.week.map((move, i) => (
                      <li key={i} className="flex gap-2 text-sm text-secondary">
                        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
                          {i + 1}
                        </span>
                        <span className="min-w-0">{move}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </div>
        ) : (
          stored?.text && (
            // An older plain-text review (or one the parser couldn't read).
            <div className="space-y-3">
              {stored.text
                .split(/\n+/)
                .map((p) => p.trim())
                .filter(Boolean)
                .map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed text-secondary">
                    {paragraph}
                  </p>
                ))}
            </div>
          )
        )}

        {!stored && !busy && (
          <div className="rounded-xl border border-edge bg-surface-2/60 p-3">
            <p className="text-sm text-secondary">
              One tap reads everything you&apos;ve logged and answers three
              questions:
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              <li>✓ What&apos;s genuinely working</li>
              <li>⚠ What&apos;s quietly slipping</li>
              <li>🎯 The one thing to fix first — starting tonight</li>
            </ul>
          </div>
        )}

        <p className="text-xs text-muted">
          A personal AI model reads your lifestyle — it only ever sees your
          numbers and tracker names, never your notes. Once every 8 hours.
        </p>
      </div>
    </section>
  );
}
