"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "@/lib/palette";

export type Point = { label: string; value: number | null };

function ValueTooltip({
  active,
  label,
  payload,
  format,
  title,
}: {
  active?: boolean;
  label?: string;
  payload?: { value: number }[];
  format: (v: number) => string;
  title: string;
}) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
      <div className="font-medium">{label}</div>
      <div className="text-secondary">
        {title}: {format(payload[0].value)}
      </div>
    </div>
  );
}

/**
 * One tracker, one measure, one axis — used for sleep hours, water per day,
 * mood ratings and body weight. `kind` is "bar" for things that accumulate
 * and "line" for things that drift up and down.
 */
export default function SeriesChart({
  data,
  color,
  kind,
  title,
  format,
  tickFormat,
  goal,
  goalLabel,
  domain,
  height = 180,
}: {
  data: Point[];
  color: string;
  kind: "bar" | "line";
  title: string;
  format: (v: number) => string;
  /** Shorter labels for the axis, when the tooltip wants the long form. */
  tickFormat?: (v: number) => string;
  goal?: number | null;
  goalLabel?: string;
  domain?: [number, number];
  height?: number;
}) {
  const tick = tickFormat ?? format;
  const stroke = seriesColor(color);
  const axis = {
    tickLine: false,
    tick: { fill: "var(--ink-muted)", fontSize: 11 },
  };

  const common = (
    <>
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
        width={44}
        domain={domain ?? [0, "auto"]}
        tickFormatter={(v: number) => tick(v)}
      />
      <Tooltip
        cursor={{ fill: "var(--edge)", stroke: "var(--chart-axis)" }}
        content={<ValueTooltip format={format} title={title} />}
      />
      {goal != null && (
        <ReferenceLine
          y={goal}
          stroke="var(--ink-muted)"
          strokeDasharray="4 4"
          label={{
            value: goalLabel ?? "goal",
            position: "insideTopRight",
            fill: "var(--ink-muted)",
            fontSize: 11,
          }}
        />
      )}
    </>
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
            {common}
            <Bar
              dataKey="value"
              fill={stroke}
              stroke="var(--surface)"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
              isAnimationActive={false}
            />
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
            {common}
            <Line
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              dot={{ r: 3, fill: stroke, stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
