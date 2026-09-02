"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MEAN_REFERENCE } from "@/lib/cortisol";
import type { LevelPoint } from "@/lib/health";

/**
 * The modelled level across the window, with the sleep that produced it.
 *
 * Two series on one chart because the claim is about the pair of them. The
 * bars are how long each night was; the line is the level the model gets from
 * that night's timing and that day's load. Read alone, a rising line is a
 * number going up for no stated reason — read against the bars, it usually
 * has one, and when it does not, that is worth knowing too.
 *
 * The reference band is drawn as a shaded region rather than described in a
 * caption underneath, because "is this normal" is the first question anybody
 * asks of a chart like this and it should be answerable by looking.
 *
 * A day with no clock times is a **gap**: `connectNulls` is off, so the line
 * breaks. A line drawn straight through a missing Tuesday is a claim about a
 * Tuesday nobody logged.
 */
export default function LevelTrend({
  points,
  height = 240,
}: {
  points: LevelPoint[];
  height?: number;
}) {
  const levels = points.map((p) => p.nmol).filter((v): v is number => v !== null);
  const top = Math.max(MEAN_REFERENCE.high + 2, ...levels.map((v) => v + 1));

  const axis = {
    tickLine: false,
    tick: { fill: "var(--ink-muted)", fontSize: 11 },
  };

  const label = (date: string) => date.slice(5).replace("-", "/");

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={label}
            axisLine={{ stroke: "var(--chart-axis)" }}
            interval="preserveStartEnd"
            minTickGap={18}
            {...axis}
          />
          {/* Left: the level. Right: hours slept, which is a different unit
              and would be a lie sharing an axis with nmol/L. */}
          <YAxis yAxisId="level" axisLine={false} width={38} domain={[0, top]} {...axis} />
          <YAxis
            yAxisId="sleep"
            orientation="right"
            axisLine={false}
            width={30}
            domain={[0, 12]}
            {...axis}
          />
          <ReferenceArea
            yAxisId="level"
            y1={MEAN_REFERENCE.low}
            y2={MEAN_REFERENCE.high}
            fill="var(--accent)"
            fillOpacity={0.08}
            stroke="none"
          />
          <Tooltip
            cursor={{ fill: "var(--chart-grid)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as LevelPoint;
              return (
                <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
                  <div className="font-medium">{point.date}</div>
                  <div className="text-secondary">
                    {point.nmol === null
                      ? "No clock times — nothing to model"
                      : `Level about ${point.nmol} nmol/L, est.`}
                  </div>
                  {point.sleepHours !== null && (
                    <div className="text-secondary">Slept {point.sleepHours} h</div>
                  )}
                  {point.rhythm !== null && (
                    <div className="text-muted">
                      Rhythm {point.rhythm} · load {point.load}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar
            yAxisId="sleep"
            dataKey="sleepHours"
            fill="var(--accent)"
            fillOpacity={0.18}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            yAxisId="level"
            type="monotone"
            dataKey="nmol"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
