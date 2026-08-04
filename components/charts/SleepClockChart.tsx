"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "@/lib/palette";
import { nightLabel, nightTick, nightTicks } from "@/lib/clock";
import { formatMinutes } from "@/lib/dates";

/** One night: where the bar starts and where it ends, on the night axis. */
export type ClockPoint = {
  label: string;
  range: [number, number] | null;
  nights: number;
};

function ClockTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: { payload: ClockPoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point?.range) return null;
  const [bed, wake] = point.range;
  return (
    <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
      <div className="font-medium">{label}</div>
      <div className="text-secondary">
        Bed {nightLabel(bed)} → woke {nightLabel(wake)}
      </div>
      <div className="text-muted text-xs">
        {formatMinutes(wake - bed)} in bed
        {point.nights > 1 && ` · average of ${point.nights} nights`}
      </div>
    </div>
  );
}

/**
 * The night as a bar: the bottom of it is when you went to bed, the top is
 * when you got up. Hours slept already have their own chart — this one exists
 * to answer a different question, which is whether the whole night is drifting
 * later.
 */
export default function SleepClockChart({
  data,
  color,
  avgBed,
  height = 180,
}: {
  data: ClockPoint[];
  color: string;
  /** Dashed line at the period's average bedtime. */
  avgBed?: number | null;
  height?: number;
}) {
  const fill = seriesColor(color);
  const spans = data.map((d) => d.range).filter(Boolean) as [number, number][];

  if (spans.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted" style={{ minHeight: height }}>
        No bedtimes logged in this period
      </p>
    );
  }

  // Pad out to whole hours so the ticks land on the hour and the bars aren't
  // pressed against the edges.
  const lo = Math.floor((Math.min(...spans.map((s) => s[0])) - 20) / 60) * 60;
  const hi = Math.ceil((Math.max(...spans.map((s) => s[1])) + 20) / 60) * 60;
  const axis = {
    tickLine: false,
    tick: { fill: "var(--ink-muted)", fontSize: 11 },
  };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            {...axis}
            axisLine={{ stroke: "var(--chart-axis)" }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            {...axis}
            axisLine={false}
            width={56}
            domain={[lo, hi]}
            ticks={nightTicks(lo, hi)}
            tickFormatter={(v: number) => nightTick(v)}
          />
          <Tooltip
            cursor={{ fill: "var(--edge)" }}
            content={<ClockTooltip />}
          />
          {avgBed != null && (
            <ReferenceLine
              y={avgBed}
              stroke="var(--ink-muted)"
              strokeDasharray="4 4"
              label={{
                value: `avg ${nightLabel(avgBed)}`,
                position: "insideTopRight",
                fill: "var(--ink-muted)",
                fontSize: 11,
              }}
            />
          )}
          <Bar
            dataKey="range"
            fill={fill}
            stroke="var(--surface)"
            strokeWidth={1}
            radius={4}
            maxBarSize={26}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
