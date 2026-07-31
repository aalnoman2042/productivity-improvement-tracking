"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatValue } from "@/lib/trackers";
import { seriesColor } from "@/lib/palette";

type SeriesMeta = { id: string; name: string; color: string };
export type Bucket = { label: string; values: Record<string, number> };

function yTick(v: number): string {
  if (v === 0) return "0";
  return v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${v}m`;
}

function StackTooltip({
  active,
  label,
  payload,
  series,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number }[];
  series: SeriesMeta[];
}) {
  if (!active || !payload?.length) return null;
  const byId = new Map(series.map((s) => [s.id, s]));
  const rows = payload.filter((p) => p.value > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
      <div className="font-medium">{label}</div>
      <div className="mb-1 text-xs text-muted">
        {formatValue(total, "duration", "min")} total
      </div>
      {rows.map((p) => {
        const s = byId.get(p.dataKey);
        if (!s) return null;
        return (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: seriesColor(s.color) }}
            />
            <span className="flex-1 pr-3">{s.name}</span>
            <span className="tabular-nums text-secondary">
              {formatValue(p.value, "duration", "min")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Stacked time-per-bucket chart for the "time spent" trackers. */
export default function TrendChart({
  buckets,
  series,
}: {
  buckets: Bucket[];
  series: SeriesMeta[];
}) {
  const drawn = series.filter((s) =>
    buckets.some((b) => (b.values[s.id] ?? 0) > 0)
  );

  const data = buckets.map((b) => {
    const row: Record<string, number | string> = { label: b.label };
    for (const s of drawn) row[s.id] = b.values[s.id] ?? 0;
    return row;
  });

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              tickFormatter={yTick}
              width={44}
            />
            <Tooltip
              cursor={{ fill: "var(--edge)" }}
              content={<StackTooltip series={drawn} />}
            />
            {drawn.map((s) => (
              <Bar
                key={s.id}
                dataKey={s.id}
                stackId="t"
                fill={seriesColor(s.color)}
                stroke="var(--surface)"
                strokeWidth={1}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {drawn.length >= 2 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {drawn.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-1.5 text-xs text-secondary"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: seriesColor(s.color) }}
              />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
