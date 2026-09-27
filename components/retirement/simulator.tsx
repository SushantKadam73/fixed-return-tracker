"use client";

import { useMemo, useState } from "react";
import { RateHistoryChart } from "@/components/charts/rate-history-chart";
import { addMonths, epfMonthlyFromPay, fyOf, monthsBetween, simulateEPF, simulateNPS, simulatePPF, type RatePeriod, type SimResult } from "@/lib/calc/retirement";
import { formatINR, formatINRCompact } from "@/lib/format";

export interface SimulatorData {
  today: string; // YYYY-MM
  ppf: RatePeriod[];
  epf: RatePeriod[];
  nps: { E: Array<[string, number]>; C: Array<[string, number]>; G: Array<[string, number]> };
  cpi: Array<[string, number]>; // monthly chained CPI-IW
  latest: { ppf: number | null; epf: number | null };
}

function Field({ label, value, onChange, step = 1, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center rounded-md border border-border bg-bg">
        <input type="number" step={step} className="num w-full bg-transparent px-3 py-2 outline-none" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix ? <span className="pr-3 text-muted">{suffix}</span> : null}
      </div>
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function MonthField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <input type="month" className="num w-full rounded-md border border-border bg-bg px-3 py-2" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

/** Deflate an amount at month `m` into money of `base` month: actual CPI where known, assumed inflation beyond. */
function toBaseMoney(amount: number, m: string, base: string, cpi: Map<string, number>, lastCpiMonth: string, inflation: number): number {
  const idx = (month: string) => {
    const known = cpi.get(month);
    if (known !== undefined) return known;
    const last = cpi.get(lastCpiMonth) ?? 100;
    const k = monthsBetween(lastCpiMonth, month);
    return k > 0 ? last * Math.pow(1 + inflation / 100, k / 12) : null;
  };
  const a = idx(m);
  const b = idx(base);
  return a && b ? (amount * b) / a : amount;
}

function Summary({ title, r, note, value, caption }: { title: string; r: SimResult; note: string; value: number; caption: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium">{title}</p>
      {r.gap ? (
        <p className="mt-2 text-sm text-warning">{r.gap}. Choose a later start month.</p>
      ) : (
        <>
          <p className="num mt-2 text-2xl font-semibold">{formatINRCompact(value)}</p>
          <p className="text-xs text-muted">{caption}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">You put in</dt>
              <dd className="num">{formatINRCompact(r.contributed)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Growth</dt>
              <dd className="num">{formatINRCompact(r.balance - r.contributed)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">
            {note}
            {r.usedAssumption ? " Includes your assumptions for future years." : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function RetirementSimulator({ data }: { data: SimulatorData }) {
  const [start, setStart] = useState(data.today);
  const [end, setEnd] = useState(addMonths(data.today, 12 * 25 - 1));
  const [ppfMonthly, setPpfMonthly] = useState(12500);
  const [ppfRate, setPpfRate] = useState(data.latest.ppf ?? 7.1);
  const [pay, setPay] = useState(50000);
  const [raise, setRaise] = useState(5);
  const [vpf, setVpf] = useState(0);
  const [epfRate, setEpfRate] = useState(data.latest.epf ?? 8.25);
  const [npsMonthly, setNpsMonthly] = useState(5000);
  const [alloc, setAlloc] = useState({ E: 50, C: 30, G: 20 });
  const [ret, setRet] = useState({ E: 10, C: 8, G: 7.5 });
  const [inflation, setInflation] = useState(5);
  const [real, setReal] = useState(false);

  const cpiMap = useMemo(() => new Map(data.cpi), [data.cpi]);
  const lastCpi = data.cpi.at(-1)?.[0] ?? data.today;

  const results = useMemo(() => {
    const valid = monthsBetween(start, end) >= 0;
    if (!valid) return null;
    const ppf = simulatePPF({ start, end, monthly: ppfMonthly, periods: data.ppf, futureRate: ppfRate });
    const epf = simulateEPF({
      start,
      end,
      periods: data.epf,
      futureRate: epfRate,
      monthlyIntoEpf: (m) => {
        const years = Math.floor(monthsBetween(start, m) / 12);
        return epfMonthlyFromPay(pay * Math.pow(1 + raise / 100, years), vpf).intoEpf;
      },
    });
    const total = alloc.E + alloc.C + alloc.G || 1;
    const nps = simulateNPS({
      start,
      end,
      monthly: npsMonthly,
      allocation: (["E", "C", "G"] as const).filter((k) => alloc[k] > 0).map((k) => ({ key: `Scheme ${k}`, weight: alloc[k] / total, navs: data.nps[k], futureReturn: ret[k] })),
    });
    return { ppf, epf, nps };
  }, [start, end, ppfMonthly, ppfRate, pay, raise, vpf, epfRate, npsMonthly, alloc, ret, data]);

  const baseMonth = data.today;
  const show = (amount: number, month: string) => (real ? toBaseMoney(amount, month, baseMonth, cpiMap, lastCpi, inflation) : amount);
  const fyEndMonth = (fy: string) => `${Number(fy.slice(0, 4)) + 1}-03`;


  const series = results
    ? ([
        ["ppf", "PPF", "var(--accent)", results.ppf],
        ["epf", "EPF + VPF", "#6d8fd8", results.epf],
        ["nps", "NPS", "#d9822b", results.nps],
      ] as const).map(([key, label, color, r]) => ({ key, label, color, step: false, points: r.rows.map((row) => ({ date: `${fyEndMonth(row.fy)}-31`, value: Math.round(show(row.balance, fyEndMonth(row.fy)) / 1e5) / 10 })) }))
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <MonthField label="Start" value={start} onChange={setStart} />
        <MonthField label="Retire / stop" value={end} onChange={setEnd} />
        <Field label="Future inflation (assumed)" value={inflation} onChange={setInflation} step={0.25} suffix="%" />
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Show in today&apos;s money
        </label>
      </div>
      <p className="text-xs text-muted">Start in the past to see what savings would have become using the rates actually notified each year. Months after the latest notified rate use the assumptions you set.</p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="font-medium">PPF</p>
          <Field label="Monthly deposit" value={ppfMonthly} onChange={setPpfMonthly} step={500} suffix="₹" hint="Max ₹1.5 lakh a year; 15-year lock-in (extendable)" />
          <Field label="Rate after the latest notification" value={ppfRate} onChange={setPpfRate} step={0.05} suffix="%" hint={`Latest notified: ${data.latest.ppf ?? "—"}%`} />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="font-medium">EPF + VPF</p>
          <Field label="Basic + DA per month" value={pay} onChange={setPay} step={1000} suffix="₹" hint="12% from you; employer 12% minus the pension (EPS) share" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Yearly raise" value={raise} onChange={setRaise} step={0.5} suffix="%" />
            <Field label="VPF (extra)" value={vpf} onChange={setVpf} step={1} suffix="% of pay" />
          </div>
          <Field label="Rate after the latest declaration" value={epfRate} onChange={setEpfRate} step={0.05} suffix="%" hint={`Latest declared: ${data.latest.epf ?? "—"}% (VPF earns the same)`} />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="font-medium">NPS (market-linked)</p>
          <Field label="Monthly contribution" value={npsMonthly} onChange={setNpsMonthly} step={500} suffix="₹" />
          <div className="grid grid-cols-3 gap-2">
            {(["E", "C", "G"] as const).map((k) => (
              <Field key={k} label={`${k} %`} value={alloc[k]} onChange={(v) => setAlloc({ ...alloc, [k]: v })} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["E", "C", "G"] as const).map((k) => (
              <Field key={k} label={`${k} return`} value={ret[k]} onChange={(v) => setRet({ ...ret, [k]: v })} step={0.25} suffix="%" />
            ))}
          </div>
          <p className="text-xs text-muted">E = equity, C = corporate bonds, G = Government bonds. Past months use SBI Pension Fund Tier I NAVs; future returns are your assumptions, not promises.</p>
        </div>
      </div>

      {results ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Summary title="PPF" r={results.ppf} value={show(results.ppf.balance, end)} caption={real ? `in ${baseMonth} rupees` : `at ${end}`} note="Government-backed; tax-free interest under current rules." />
            <Summary title="EPF + VPF" r={results.epf} value={show(results.epf.balance, end)} caption={real ? `in ${baseMonth} rupees` : `at ${end}`} note="Employer share included; pension (EPS) not included." />
            <Summary title="NPS" r={results.nps} value={show(results.nps.balance, end)} caption={real ? `in ${baseMonth} rupees` : `at ${end}`} note="Market value; at exit part must buy an annuity." />
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="mb-2 text-sm font-medium">Balance by year ({real ? "₹ lakh, today's money" : "₹ lakh"})</p>
            <RateHistoryChart series={series} unit="L" step={false} height={300} />
          </div>
          <details className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">Year-by-year table</summary>
            <div className="scroll-x mt-3">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1 pr-4">Year</th>
                    <th className="py-1 pr-4">PPF</th>
                    <th className="py-1 pr-4">PPF rate</th>
                    <th className="py-1 pr-4">EPF + VPF</th>
                    <th className="py-1 pr-4">EPF rate</th>
                    <th className="py-1 pr-4">NPS</th>
                  </tr>
                </thead>
                <tbody>
                  {results.ppf.rows.map((row, i) => (
                    <tr key={row.fy} className="border-t border-border">
                      <td className="num py-1 pr-4">{row.fy}</td>
                      <td className="num py-1 pr-4">{formatINR(Math.round(show(row.balance, fyEndMonth(row.fy))))}</td>
                      <td className="py-1 pr-4 text-xs text-muted">{row.rateNote}</td>
                      <td className="num py-1 pr-4">{results.epf.rows[i] ? formatINR(Math.round(show(results.epf.rows[i].balance, fyEndMonth(row.fy)))) : "—"}</td>
                      <td className="py-1 pr-4 text-xs text-muted">{results.epf.rows[i]?.rateNote ?? ""}</td>
                      <td className="num py-1 pr-4">{results.nps.rows[i] ? formatINR(Math.round(show(results.nps.rows[i].balance, fyEndMonth(row.fy)))) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="text-xs text-muted">FY runs April–March. {fyOf(start)} to {fyOf(end)}. Estimates only; actual crediting, charges and tax rules may differ.</p>
        </>
      ) : (
        <p className="text-sm text-warning">The stop month must be after the start month.</p>
      )}
    </div>
  );
}
