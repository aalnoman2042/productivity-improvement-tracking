"use client";

import { formatMinutes } from "@/lib/dates";
import { DAY_MINUTES, timeSlices, type Draft } from "@/lib/draft";
import { seriesColor } from "@/lib/palette";
import type { Tracker } from "@/lib/trackers";

/**
 * The day as a clock face: twenty-four hours, and how much of them you have
 * actually accounted for.
 *
 * The bottom bar has always said "time logged: 14h 20m", and a number like
 * that is hard to feel. A ring is not: the gap left in it *is* the part of
 * the day nobody wrote down, which is the question this answers — sleep
 * included, because eight hours of it is a third of the circle and pretending
 * otherwise would make every day look half empty.
 *
 * Each time tracker gets its own arc in its own colour, so a day that reads
 * 18h is also visibly three things rather than one. Drawn by hand in SVG:
 * this sits on the page that must open instantly, and a chart library is a
 * lot of kilobytes for one circle.
 */

/** The circle, in CSS pixels. Big enough to read across a room. */
const SIZE = 96;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function DayDial({
  trackers,
  draft,
}: {
  trackers: Tracker[];
  draft: Record<string, Draft>;
}) {
  const slices = timeSlices(trackers, draft);
  const total = slices.reduce((sum, s) => sum + s.minutes, 0);
  const over = total > DAY_MINUTES;
  const left = Math.max(0, DAY_MINUTES - total);

  // Past 24 hours the arcs would wrap around and lie about the day, so the
  // ring goes solid red instead and the numbers do the talking.
  let offset = 0;
  const arcs = over
    ? []
    : slices.map((s) => {
        const length = (s.minutes / DAY_MINUTES) * CIRCUMFERENCE;
        const arc = {
          id: s.id,
          color: seriesColor(s.color),
          length,
          offset,
          title: `${s.name}: ${formatMinutes(s.minutes)}`,
        };
        offset += length;
        return arc;
      });

  const label = over
    ? `${formatMinutes(total)} logged — more than a day has`
    : `${formatMinutes(total)} of 24h logged, ${formatMinutes(left)} unaccounted`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Midnight at the top, running clockwise, like every other clock. */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            // The unaccounted part of the day. Straight from the theme
            // variable rather than a utility class, because an SVG with no
            // stroke colour draws nothing at all — a silent failure in dark
            // mode is not worth the tidier markup.
            stroke={over ? "color-mix(in srgb, red 25%, transparent)" : "var(--surface-2)"}
          />
          {over ? (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-red-600"
            />
          ) : (
            arcs.map((a) => (
              <circle
                key={a.id}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={a.color}
                strokeWidth={STROKE}
                strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
                strokeDashoffset={-a.offset}
                className="transition-[stroke-dasharray,stroke-dashoffset] duration-500 ease-out"
              >
                <title>{a.title}</title>
              </circle>
            ))
          )}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-base leading-none font-bold tabular-nums ${
            over ? "text-red-600" : ""
          }`}
        >
          {formatMinutes(total)}
        </span>
        <span className="mt-0.5 text-[10px] leading-none text-muted">of 24h</span>
      </div>
    </div>
  );
}
