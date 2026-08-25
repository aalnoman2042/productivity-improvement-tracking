"use client";

import { useEffect, useState } from "react";
import { useNearViewport } from "@/lib/useNearViewport";
import { useCached } from "@/lib/useCached";
import { prettyDate, toDateStr } from "@/lib/dates";
import { formatValue, type Tracker, type TrackerType } from "@/lib/trackers";
import { monthLabels, type PixelYear } from "@/lib/pixels";

/**
 * The year, one square a day.
 *
 * Hand-drawn SVG rather than a chart library, for the reason the 24-hour
 * dial is: this is 370 rectangles and a few labels, and recharts is 315KB.
 * It also has to work in both themes, which `currentColor` and opacity do
 * for free — the five levels are one accent colour at five strengths, so
 * nothing here needs a palette of its own.
 *
 * What it deliberately does *not* do is grade. No red, no "you missed 40
 * days", no streak counter: an empty square is drawn as an outline and a day
 * taken off on purpose gets its own quiet mark. The point is the shape of a
 * year, and a year is allowed to have gaps in it.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Square, gap and the room the labels need — one place, so nothing drifts. */
const CELL = 11;
const GAP = 2;
const TOP = 14;
const LEFT = 18;

type Payload = {
  tracker: { id: string; name: string; unit: string; type: string } | null;
  year: PixelYear;
};

export default function YearPixels() {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const today = toDateStr(new Date());
  const trackersQ = useCached<Tracker[]>("/api/trackers", "trackers");

  const [pick, setPick] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return;
    let live = true;
    fetch(`/api/stats/pixels?to=${today}${pick ? `&tracker=${pick}` : ""}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: Payload) => {
        if (!live) return;
        setData(body);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [near, today, pick]);

  // Everything computed before the early returns — see npm run check:shape.
  const trackers = (trackersQ.data ?? []).filter((t) => !t.archived);
  const year = data?.year ?? null;
  const weeks = year?.weeks ?? [];
  const labels = monthLabels(weeks);
  const width = LEFT + weeks.length * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const type = (data?.tracker?.type ?? "count") as TrackerType;
  const unit = data?.tracker?.unit ?? "";

  const say = (value: number) =>
    data?.tracker ? formatValue(value, type, unit) : `${value} logged`;

  return (
    <section
      ref={ref}
      className="animate-rise-in rounded-xl border border-edge card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div>
          <h2 className="font-semibold">🟩 The year, a day at a time</h2>
          <p className="mt-1 text-sm text-secondary">
            {data?.tracker
              ? `${data.tracker.name}, every day of the last year.`
              : "How many trackers you filled in each day. Not a grade — a record."}
          </p>
        </div>
        <label className="sr-only" htmlFor="pixel-tracker">
          Which tracker
        </label>
        <select
          id="pixel-tracker"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-md border border-edge bg-transparent px-2 py-1.5 text-sm"
        >
          <option value="">All days</option>
          {trackers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {failed ? (
        <p className="mt-3 text-sm text-muted">
          Couldn&apos;t draw the year. Everything else on this page is
          unaffected.
        </p>
      ) : !year ? (
        <div className="skeleton mt-3 h-28 rounded-lg" aria-hidden="true" />
      ) : (
        <>
          {/* Scrolls inside itself rather than pushing the page sideways —
              a year is wider than a phone and always will be. */}
          <div className="mt-3 overflow-x-auto">
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              className="text-accent"
              role="img"
              aria-label={`${year.logged} days logged between ${prettyDate(
                year.from
              )} and ${prettyDate(year.to)}`}
            >
              {weeks.map((week, x) => {
                const label = labels[x];
                return (
                  <g key={x}>
                    {label && (
                      <text
                        x={LEFT + x * (CELL + GAP)}
                        y={9}
                        className="fill-current text-[9px] opacity-50"
                      >
                        {MONTHS[Number(label.slice(5, 7)) - 1]}
                      </text>
                    )}
                    {week.map((day, y) => {
                      if (!day) return null;
                      const px = LEFT + x * (CELL + GAP);
                      const py = TOP + y * (CELL + GAP);
                      return (
                        <g key={day.date}>
                          <rect
                            x={px}
                            y={py}
                            width={CELL}
                            height={CELL}
                            rx={2}
                            className={
                              day.level === 0
                                ? "fill-current opacity-10"
                                : "fill-current"
                            }
                            opacity={day.level === 0 ? undefined : 0.2 + day.level * 0.2}
                          >
                            <title>
                              {`${prettyDate(day.date)} — ${
                                day.rest
                                  ? "a day off, on purpose"
                                  : day.value > 0
                                    ? say(day.value)
                                    : "nothing logged"
                              }`}
                            </title>
                          </rect>
                          {/* A planned day off is its own mark, so an empty
                              square that was chosen doesn't read the same as
                              one that just happened. */}
                          {day.rest && day.value === 0 && (
                            <circle
                              cx={px + CELL / 2}
                              cy={py + CELL / 2}
                              r={1.6}
                              className="fill-current opacity-60"
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {["M", "W", "F"].map((d, i) => (
                <text
                  key={d}
                  x={0}
                  y={TOP + (i * 2 + 1) * (CELL + GAP) - 3}
                  className="fill-current text-[9px] opacity-50"
                >
                  {d}
                </text>
              ))}
            </svg>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="tabular-nums">
              {year.logged} days logged
              {year.rested > 0 && ` · ${year.rested} taken off`}
            </span>
            <span className="ml-auto flex items-center gap-1">
              less
              {[0, 1, 2, 3, 4].map((l) => (
                <span
                  key={l}
                  aria-hidden="true"
                  className={`inline-block h-2.5 w-2.5 rounded-sm ${
                    l === 0 ? "bg-current opacity-10" : "bg-current"
                  } text-accent`}
                  style={l === 0 ? undefined : { opacity: 0.2 + l * 0.2 }}
                />
              ))}
              more
            </span>
          </div>
        </>
      )}
    </section>
  );
}
