"use client";

import { useMemo, useState } from "react";
import { fdMaturity, fdPayout, rdMaturity } from "@/lib/calc/deposits";
import { formatINR, formatINRCompact, formatRate } from "@/lib/format";
import { bucketForDays } from "@/lib/tenure";

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center rounded-md border border-border bg-bg focus-within:border-accent">
        <input
          type="number"
          inputMode="decimal"
          className="num w-full bg-transparent px-3 py-2 outline-none"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix ? <span className="pr-3 text-muted">{suffix}</span> : null}
      </div>
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Result({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`num ${strong ? "text-lg font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

export function FdCalculator() {
  const [principal, setPrincipal] = useState(100000);
  const [rate, setRate] = useState(7);
  const [years, setYears] = useState(1);
  const [months, setMonths] = useState(0);
  const [days, setDays] = useState(0);
  const tenureDays = Math.round(years * 365 + months * (365 / 12) + days);
  const result = useMemo(() => {
    try {
      return principal > 0 && rate > 0 && tenureDays > 0 ? fdMaturity(principal, rate, tenureDays) : null;
    } catch {
      return null;
    }
  }, [principal, rate, tenureDays]);
  const bucket = bucketForDays(tenureDays);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <NumberField label="Deposit amount" value={principal} onChange={setPrincipal} step={1000} suffix="₹" hint={formatINRCompact(principal)} />
        <NumberField label="Interest rate" value={rate} onChange={setRate} step={0.05} suffix="% p.a." />
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Years" value={years} onChange={setYears} />
          <NumberField label="Months" value={months} onChange={setMonths} />
          <NumberField label="Days" value={days} onChange={setDays} />
        </div>
        <p className="text-xs text-muted">
          Tenure: {tenureDays} days{bucket ? ` · falls in the ${bucket.label} bucket` : ""}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        {result ? (
          <>
            <Result label="Maturity amount" value={formatINR(result.maturity)} strong />
            <Result label="Interest earned" value={formatINR(result.interest)} />
            <Result label="Method" value={result.method === "simple" ? "Simple interest (short deposit)" : "Compounded quarterly"} />
            <Result label="Effective annual yield" value={formatRate(result.effectiveAnnualYield)} />
            <Result label="Monthly payout (non-cumulative)" value={formatINR(fdPayout(principal, rate, "monthly"))} />
            <Result label="Quarterly payout (non-cumulative)" value={formatINR(fdPayout(principal, rate, "quarterly"))} />
          </>
        ) : (
          <p className="text-sm text-muted">Enter an amount, rate and tenure.</p>
        )}
      </div>
    </div>
  );
}

export function RdCalculator() {
  const [instalment, setInstalment] = useState(5000);
  const [rate, setRate] = useState(7);
  const [months, setMonths] = useState(24);
  const result = useMemo(() => {
    try {
      return instalment > 0 && rate > 0 && months > 0 ? rdMaturity(instalment, rate, Math.round(months)) : null;
    } catch {
      return null;
    }
  }, [instalment, rate, months]);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <NumberField label="Monthly instalment" value={instalment} onChange={setInstalment} step={500} suffix="₹" hint={formatINRCompact(instalment)} />
        <NumberField label="Interest rate" value={rate} onChange={setRate} step={0.05} suffix="% p.a." />
        <NumberField label="Number of months" value={months} onChange={setMonths} step={1} suffix="months" />
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        {result ? (
          <>
            <Result label="Maturity amount" value={formatINR(result.maturity)} strong />
            <Result label="Total deposited" value={formatINR(result.deposited)} />
            <Result label="Interest earned" value={formatINR(result.interest)} />
          </>
        ) : (
          <p className="text-sm text-muted">Enter an instalment, rate and number of months.</p>
        )}
      </div>
    </div>
  );
}
