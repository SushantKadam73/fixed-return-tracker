"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Override the chart-wide step setting for this series (e.g. inflation drawn as a smooth line). */
  step?: boolean;
  /** Points must be sorted by date. `value: null` breaks the line (never interpolated). */
  points: Array<{ date: string; value: number | null }>;
}

function toTime(date: string): number {
  const d = /^\d{4}$/.test(date) ? `${date}-01-01` : /^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date;
  return new Date(`${d}T00:00:00+05:30`).getTime();
}

const yearFmt = (t: number) => new Date(t).getFullYear().toString();
const dateFmt = (t: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(t));

/**
 * Step chart of rate history: rates stay flat until the next published change, which is
 * how administered and card rates actually behave.
 */
export function RateHistoryChart({
  series,
  height = 300,
  unit = "%",
  step = true,
  yDomain,
}: {
  series: ChartSeries[];
  height?: number;
  unit?: string;
  step?: boolean;
  yDomain?: [number | "auto", number | "auto"];
}) {
  // Merge all series onto one time axis.
  const byTime = new Map<number, Record<string, number | null>>();
  for (const s of series) {
    for (const p of s.points) {
      const t = toTime(p.date);
      const row = byTime.get(t) ?? {};
      row[s.key] = p.value;
      byTime.set(t, row);
    }
  }
  const data = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, row]) => ({ t, ...row }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={yearFmt}
            stroke="var(--muted)"
            fontSize={12}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--muted)"
            fontSize={12}
            width={44}
            domain={yDomain ?? ["auto", "auto"]}
            tickFormatter={(v: number) => `${v}${unit}`}
          />
          <Tooltip
            labelFormatter={(t) => dateFmt(Number(t))}
            formatter={(value, name) => [value === null || value === undefined ? "not reported" : `${Number(value).toFixed(2)}${unit}`, String(name)]}
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--text)" }}
          />
          {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type={(s.step ?? step) ? "stepAfter" : "linear"}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
