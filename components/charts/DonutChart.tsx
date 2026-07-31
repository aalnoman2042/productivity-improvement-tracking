"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatValue } from "@/lib/trackers";
import { seriesColor } from "@/lib/palette";

export type Slice = { id: string; name: string; color: string; minutes: number };

const formatMinutes = (m: number) => formatValue(m, "duration", "min");

function SliceTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: { payload: Slice }[];
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  const pct = total > 0 ? Math.round((s.minutes / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-edge bg-surface px-3 py-2 text-sm shadow-lg">
      <div className="flex items-center gap-2 font-medium">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: seriesColor(s.color) }}
        />
        {s.name}
      </div>
      <div className="text-secondary">
        {formatMinutes(s.minutes)} · {pct}%
      </div>
    </div>
  );
}

export default function DonutChart({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.minutes, 0);

  return (
    <div>
      <div className="relative mx-auto h-56 w-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="minutes"
              nameKey="name"
              innerRadius="62%"
              outerRadius="95%"
              strokeWidth={2}
              stroke="var(--surface)"
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.id} fill={seriesColor(d.color)} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{formatMinutes(total)}</span>
          <span className="text-xs text-muted">total</span>
        </div>
      </div>

      {/* Legend: identity is never color-alone */}
      <ul className="mt-4 space-y-1.5">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.minutes / total) * 100) : 0;
          return (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: seriesColor(d.color) }}
              />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-secondary">{formatMinutes(d.minutes)}</span>
              <span className="w-10 text-right text-muted">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
