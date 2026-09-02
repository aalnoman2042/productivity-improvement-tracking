"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { clockText, type CurvePoint } from "@/lib/cortisol";

/**
 * The modelled day, drawn on the clock.
 *
 * An area rather than a line because what this chart is *about* is the shape
 * underneath — the height of the morning and, much more importantly, how far
 * the evening comes back down. A flattened rhythm and a healthy one can have
 * the same peak; they never have the same silhouette.
 *
 * Wake and bed are marked because the curve means nothing without them. A
 * peak at half eleven is early for someone who got up at eleven, and this is
 * the only thing on the chart that says so.
 */
export default function CortisolCurve({
  points,
  wake,
  bed,
  peakMinute,
  height = 240,
}: {
  points: CurvePoint[];
  wake: number;
  bed: number;
  peakMinute: number;
  height?: number;
}) {
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]);
  const top = Math.ceil(peak.value / 20) * 20;

  const axis = {
    tickLine: false,
    tick: { fill: "var(--ink-muted)", fontSize: 11 },
  };

  const marker = (minute: number, label: string) => (
    <ReferenceLine
      key={label}
      x={minute}
      stroke="var(--chart-axis)"
      strokeDasharray="3 4"
      label={{
        value: label,
        position: "insideTop",
        fill: "var(--ink-muted)",
        fontSize: 11,
      }}
    />
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 16, right: 10, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="cortisol-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.38} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="minute"
            type="number"
            domain={[0, 1440]}
            ticks={[0, 240, 480, 720, 960, 1200, 1440]}
            tickFormatter={(m: number) => clockText(m % 1440).replace(":00", "")}
            axisLine={{ stroke: "var(--chart-axis)" }}
            {...axis}
          />
          <YAxis {...axis} axisLine={false} width={40} domain={[0, top]} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as CurvePoint;
              return (
                <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
                  <div className="font-medium">{clockText(point.minute)}</div>
                  <div className="text-secondary">
                    Modelled level: {point.value}
                  </div>
                </div>
              );
            }}
          />
          {marker(wake, "wake")}
          {marker(bed, "bed")}
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#cortisol-fill)"
            isAnimationActive={false}
          />
          <ReferenceDot
            x={peakMinute}
            y={peak.value}
            r={4}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
