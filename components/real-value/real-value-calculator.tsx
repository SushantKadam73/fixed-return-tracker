"use client";

import { useMemo, useState } from "react";
import { formatINR, formatINRCompact, formatRate, formatUSDCompact } from "@/lib/format";

type Point = [string, number];

export interface RealValueData {
  cpi: Point[]; // monthly, chained index
  gold: Point[]; // fiscal year → ₹ per 10 g
  income: Point[]; // fiscal year → ₹ per person per year
  usd: Point[]; // fiscal year → ₹ per US$
}

function fiscalYearOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

function lookup(points: Point[], key: string): number | null {
  const hit = points.find((p) => p[0] === key);
  return hit ? hit[1] : null;
}

function Anchors({ label, amount, fy, data }: { label: string; amount: number; fy: string; data: RealValueData }) {
  const gold = lookup(data.gold, fy);
  const income = lookup(data.income, fy);
  const usd = lookup(data.usd, fy);
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted">
        {label} · FY {fy}
      </p>
      <p className="num mt-1 text-xl font-semibold">{formatINRCompact(amount)}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li>
          <span className="text-muted">Gold it could buy: </span>
          {gold ? <span className="num">{((amount / gold) * 10).toLocaleString("en-IN", { maximumFractionDigits: 1 })} g</span> : <span className="text-muted italic">not reported</span>}
        </li>
        <li>
          <span className="text-muted">Years of average income: </span>
          {income ? <span className="num">{(amount / income).toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span> : <span className="text-muted italic">not reported</span>}
        </li>
        <li>
          <span className="text-muted">In US dollars: </span>
          {usd ? <span className="num">{formatUSDCompact(amount / usd)}</span> : <span className="text-muted italic">not reported</span>}
        </li>
      </ul>
    </div>
  );
}

function MonthPicker({ value, onChange, label, years }: { value: string; onChange: (v: string) => void; label: string; years: string[] }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex gap-2">
        <select className="rounded-md border border-border bg-bg px-2 py-2" value={value.slice(5)} onChange={(e) => onChange(`${value.slice(0, 4)}-${e.target.value}`)}>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((mm) => (
            <option key={mm} value={mm}>
              {new Date(2000, Number(mm) - 1, 1).toLocaleDateString("en-IN", { month: "short" })}
            </option>
          ))}
        </select>
        <select className="num rounded-md border border-border bg-bg px-2 py-2" value={value.slice(0, 4)} onChange={(e) => onChange(`${e.target.value}-${value.slice(5)}`)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function RealValueCalculator({ data }: { data: RealValueData }) {
  const months = data.cpi.map((p) => p[0]);
  const first = months[0];
  const last = months[months.length - 1];
  const [amount, setAmount] = useState(100000);
  const [from, setFrom] = useState("1990-04");
  const [to, setTo] = useState(last);

  const result = useMemo(() => {
    const a = lookup(data.cpi, from);
    const b = lookup(data.cpi, to);
    if (a === null || b === null || a <= 0) return null;
    const multiple = b / a;
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    const years = ty + (tm - 1) / 12 - (fy + (fm - 1) / 12);
    return { multiple, equivalent: amount * multiple, annual: years > 0 ? (Math.pow(multiple, 1 / years) - 1) * 100 : null, years };
  }, [amount, from, to, data.cpi]);

  const years = Array.from(new Set(months.map((m) => m.slice(0, 4))));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Amount</span>
          <input type="number" className="num w-full rounded-md border border-border bg-bg px-3 py-2" value={amount} min={1} onChange={(e) => setAmount(Number(e.target.value))} />
          <span className="text-xs text-muted">{formatINRCompact(amount)}</span>
        </label>
        <MonthPicker label="Money of" value={from} onChange={setFrom} years={years} />
        <MonthPicker label="Worth in" value={to} onChange={setTo} years={years} />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              {formatINR(amount)} in {monthLabel(from)} had the same buying power as
            </p>
            <p className="num text-3xl font-semibold">{formatINR(Math.round(result.equivalent))}</p>
            <p className="text-sm text-muted">
              in {monthLabel(to)} — prices rose {result.multiple.toLocaleString("en-IN", { maximumFractionDigits: 2 })}×
              {result.annual !== null ? `, about ${formatRate(result.annual)} a year on average` : ""}.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Inflation data covers {monthLabel(first)} to {monthLabel(last)}. Pick months inside that range.
          </p>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Anchors label={`${monthLabel(from)} money`} amount={amount} fy={fiscalYearOf(from)} data={data} />
        <Anchors label={`Same buying power in ${monthLabel(to)}`} amount={result ? result.equivalent : amount} fy={fiscalYearOf(to)} data={data} />
      </div>
    </div>
  );
}
