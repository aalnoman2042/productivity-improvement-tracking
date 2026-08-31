"use client";

import { formatMinutes } from "@/lib/dates";
import { DAY_MINUTES, timeSlices, type Draft } from "@/lib/draft";
import { seriesColor } from "@/lib/palette";
import { useMinutesElapsed } from "@/lib/useElapsed";
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
 * The ring is always out of 24 hours, so it is only full when the day is
 * fully accounted for. But a day in progress is not a day that failed: at 1pm
 * you have had thirteen hours, not twenty-four, and ten of them logged is a
 * complete record so far. So the hours already lived are drawn as a paler
 * band underneath with a mark at *now*, and the caption counts against them —
 * "10h of 13h so far". At midnight the two denominators become the same one
 * and this quietly turns back into what it always was.
 *
 * Each time tracker gets its own arc in its own colour, so a day that reads
 * 18h is also visibly three things rather than one. Drawn by hand in SVG:
 * this sits on the page that must open instantly, and a chart library is a
 * lot of kilobytes for one circle.
 */

/** The circle, in CSS pixels. Big enough to read across a room. */
const SIZE = 108;
const STROKE = 11;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MID = SIZE / 2;

/** A point on the ring, `at` minutes into the day, `out` px off the radius. */
function onRing(at: number, out = 0) {
  const angle = ((at / DAY_MINUTES) * 2 - 0.5) * Math.PI; // midnight at the top
  return {
    x: MID + (RADIUS + out) * Math.cos(angle),
    y: MID + (RADIUS + out) * Math.sin(angle),
  };
}

export default function DayDial({
  trackers,
  draft,
  date,
}: {
  trackers: Tracker[];
  draft: Record<string, Draft>;
  /** Which day is on screen — the clock only counts for today's. */
  date: string;
}) {
  const elapsed = useMinutesElapsed(date);
  const slices = timeSlices(trackers, draft);
  const total = slices.reduce((sum, s) => sum + s.minutes, 0);
  const over = total > DAY_MINUTES;
  const left = Math.max(0, DAY_MINUTES - total);

  // What the day is measured against *right now*: the hours it has had.
  // Never below what's logged — an early start is not a day 110% accounted
  // for, it is a night that belongs to this morning.
  const somuch = elapsed === null ? DAY_MINUTES : Math.max(elapsed, total);

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

  const lived = elapsed === null ? null : (elapsed / DAY_MINUTES) * CIRCUMFERENCE;
  const mark = elapsed === null ? null : { in: onRing(elapsed, -STROKE / 2 - 1), out: onRing(elapsed, STROKE / 2 + 1) };

  const label = over
    ? `${formatMinutes(total)} logged — more than a day has`
    : elapsed === null
      ? `${formatMinutes(total)} of 24h logged, ${formatMinutes(left)} unaccounted`
      : `${formatMinutes(total)} logged of the ${formatMinutes(somuch)} today has had so far`;

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
        <g transform={`rotate(-90 ${MID} ${MID})`}>
          <circle
            cx={MID}
            cy={MID}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            // The unaccounted part of the day. Straight from the theme
            // variable rather than a utility class, because an SVG with no
            // stroke colour draws nothing at all — a silent failure in dark
            // mode is not worth the tidier markup.
            stroke={over ? "color-mix(in srgb, red 25%, transparent)" : "var(--surface-2)"}
          />

          {/* The hours already lived, under everything else: the part of the
              ring that is even *available* to account for yet. */}
          {!over && lived !== null && (
            <circle
              cx={MID}
              cy={MID}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              stroke="color-mix(in srgb, var(--foreground) 10%, transparent)"
              strokeDasharray={`${lived} ${CIRCUMFERENCE - lived}`}
              className="transition-[stroke-dasharray] duration-500 ease-out"
            />
          )}

          {over ? (
            <circle
              cx={MID}
              cy={MID}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-red-600"
            />
          ) : (
            arcs.map((a) => (
              <circle
                key={a.id}
                cx={MID}
                cy={MID}
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

        {/* Now: a notch across the ring, drawn last so an arc can't bury it.
            Outside the rotated group — `onRing` already puts midnight up. */}
        {mark && (
          <line
            x1={mark.in.x}
            y1={mark.in.y}
            x2={mark.out.x}
            y2={mark.out.y}
            strokeWidth={2}
            strokeLinecap="round"
            stroke="var(--foreground)"
            opacity={0.55}
          />
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-lg leading-none font-bold tabular-nums ${
            over ? "text-red-600" : ""
          }`}
        >
          {formatMinutes(total)}
        </span>
        {/* Whole hours only: "of 13h so far" is the sentence a person says,
            and "of 13h 47m" does not fit inside a 108px circle. The exact
            figure is in the label a screen reader gets. */}
        <span className="mt-1 text-[10px] leading-none text-muted">
          {elapsed === null
            ? "of 24h"
            : `of ${Math.floor(somuch / 60)}h so far`}
        </span>
      </div>
    </div>
  );
}
