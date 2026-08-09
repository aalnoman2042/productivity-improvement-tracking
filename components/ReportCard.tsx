"use client";

import Link from "next/link";
import { formatMinutes, prettyDate } from "@/lib/dates";
import { categoryMeta } from "@/lib/trackers";
import { seriesColor } from "@/lib/palette";
import {
  BASIS_LABEL,
  gradeLetter,
  type ReportCard as Report,
} from "@/lib/report";

/** How each mark should look — the same scale everywhere on the card. */
function look(letter: string): { text: string; badge: string; bar: string } {
  if (letter === "A+" || letter === "A") {
    return {
      text: "text-green-700 dark:text-green-500",
      badge: "border-green-700/40 bg-green-700/10 text-green-700 dark:text-green-500",
      bar: "bg-green-600",
    };
  }
  if (letter === "B") {
    return {
      text: "text-accent",
      badge: "border-accent/40 bg-accent/10 text-accent",
      bar: "bg-accent",
    };
  }
  if (letter === "C") {
    return {
      text: "text-amber-700 dark:text-amber-500",
      badge: "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-500",
      bar: "bg-amber-500",
    };
  }
  return {
    text: "text-red-600",
    badge: "border-red-600/40 bg-red-600/10 text-red-600",
    bar: "bg-red-500",
  };
}

const pct = (score: number) => `${Math.round(score * 100)}%`;

/**
 * The whole account, graded — every day since the first one ever logged.
 *
 * The ranges above answer "how is this week going?"; this answers "who have
 * I been the whole time?". Subjects are the categories, each tracker marked
 * over its own lifetime on the fairest thing it offers: goals if it has
 * them, clean days for streaks, showing up for the rest. Weakest subject
 * first, because a report card is for knowing what to work on.
 */
export default function ReportCard({ report }: { report: Report | null }) {
  if (!report || !report.hasData) return null;

  const overallLetter = report.overall !== null ? gradeLetter(report.overall) : null;
  const showedUp = Math.round((report.daysLogged / report.spanDays) * 100);

  return (
    <section className="rounded-xl border border-edge card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">🎓 Report card</h2>
          <p className="mt-0.5 text-sm text-secondary">
            All time — every day since{" "}
            {report.firstDate ? prettyDate(report.firstDate) : "the start"}.
          </p>
        </div>
        {overallLetter && (
          <div
            className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border ${look(overallLetter).badge}`}
            title={report.overall !== null ? `Overall ${pct(report.overall)}` : undefined}
          >
            <span className="text-xl font-bold leading-none">{overallLetter}</span>
            <span className="mt-0.5 text-[10px] leading-none opacity-80">
              overall
            </span>
          </div>
        )}
      </div>

      {/* The record, in numbers */}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          {
            label: "Days logged",
            value: `${report.daysLogged}/${report.spanDays}`,
            hint: `showed up ${showedUp}%`,
          },
          {
            label: "Best streak",
            value: String(report.bestStreak),
            hint:
              report.currentStreak > 0
                ? `now on ${report.currentStreak}`
                : "days in a row",
          },
          {
            label: "Entries",
            value: report.totalEntries.toLocaleString(),
            hint: "on the record",
          },
          {
            label: "Time logged",
            value: report.timeMinutes > 0 ? formatMinutes(report.timeMinutes) : "—",
            hint: "on time trackers",
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-md border border-edge p-2.5">
            <dt className="text-xs text-secondary">{tile.label}</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums">{tile.value}</dd>
            <dd className="text-xs text-muted">{tile.hint}</dd>
          </div>
        ))}
      </dl>

      {report.challenges && (
        <p className="mt-2 text-sm text-secondary">
          🏆 Challenges:{" "}
          <strong className="tabular-nums">{report.challenges.completed}</strong>{" "}
          completed
          {report.challenges.running > 0 && (
            <> · {report.challenges.running} running</>
          )}
          {report.challenges.fell > 0 && <> · {report.challenges.fell} unfinished</>}
        </p>
      )}

      {/* The subjects */}
      {report.subjects.length > 0 && (
        <ul className="mt-4 space-y-3">
          {report.subjects.map((s) => {
            const meta = categoryMeta(s.category);
            const letter = gradeLetter(s.score);
            const l = look(letter);
            return (
              <li key={s.category.toLowerCase()}>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {meta.icon} {meta.label}
                  </span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">
                    {pct(s.score)}
                  </span>
                  <span
                    className={`w-8 shrink-0 rounded border text-center text-xs font-bold ${l.badge}`}
                  >
                    {letter}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${l.bar}`}
                    style={{ width: pct(s.score) }}
                  />
                </div>
                {/* Each tracker's own mark, and what it was marked on. */}
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  {s.trackers.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tracker/${t.id}`}
                      className="inline-flex items-center gap-1 hover:text-accent hover:underline"
                      title={`${BASIS_LABEL[t.basis]} ${pct(t.score)} over ${t.lifetime} days`}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: seriesColor(t.color) }}
                        aria-hidden="true"
                      />
                      {t.name}
                      <strong className={look(gradeLetter(t.score)).text}>
                        {gradeLetter(t.score)}
                      </strong>
                    </Link>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {report.ungraded.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          Too new to grade (needs a week):{" "}
          {report.ungraded.map((t) => t.name).join(", ")}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        Each tracker is graded over its own lifetime — goals hit where a goal
        is set, days clean for streaks, days logged for the rest. Archived
        trackers still count in the numbers, but aren&apos;t graded.
      </p>
    </section>
  );
}
