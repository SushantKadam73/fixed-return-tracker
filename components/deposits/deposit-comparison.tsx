"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CustomerType, RateRow } from "@/lib/domain";
import { formatDateIST, formatINRCompact, formatRate } from "@/lib/format";
import { TENURE_BUCKETS, bestInBucket, rateForTenure, toDays } from "@/lib/tenure";

export interface BankRates {
  slug: string;
  name: string;
  group: "sbi_nationalised" | "private" | "sfb" | "payments";
  effectiveFrom: string | null;
  observedAt: string;
  sourceUrl: string;
  rows: RateRow[];
}

const GROUP_SHORT: Record<BankRates["group"], string> = { sbi_nationalised: "PSB", private: "Private", sfb: "SFB", payments: "Payments" };
const STALE_DAYS = 3;

function daysSince(date: string): number {
  return Math.floor((Date.now() - new Date(`${date}T12:00:00+05:30`).getTime()) / 86_400_000);
}

export function DepositComparison({ fd, rd, today }: { fd: BankRates[]; rd: BankRates[]; today: string }) {
  const [product, setProduct] = useState<"fd" | "rd">("fd");
  const [amount, setAmount] = useState(100000);
  const [customer, setCustomer] = useState<CustomerType>("general");
  const [normalise, setNormalise] = useState(true);
  const [bucketKey, setBucketKey] = useState("m12_15");
  const [years, setYears] = useState(1);
  const [months, setMonths] = useState(0);
  const [days, setDays] = useState(0);
  const [group, setGroup] = useState<"all" | BankRates["group"]>("all");
  const [includeNonCallable, setIncludeNonCallable] = useState(false);

  const banks = product === "fd" ? fd : rd;
  const tenureDays = toDays({ years, months, days });
  const bucket = TENURE_BUCKETS.find((b) => b.key === bucketKey) ?? TENURE_BUCKETS[5];

  const results = useMemo(() => {
    const filter = { amount, customer, callable: includeNonCallable ? undefined : true } as const;
    return banks
      .filter((b) => group === "all" || b.group === group)
      .map((b) => {
        if (normalise) {
          const r = bestInBucket(b.rows, bucket, filter);
          return { bank: b, rate: r.rate, label: r.tenureLabel, specific: r.specificTenureOnly, scheme: r.row?.schemeName ?? null, nonCallable: r.row?.callable === false };
        }
        const row = rateForTenure(b.rows, tenureDays, filter);
        return { bank: b, rate: row?.rate ?? null, label: row?.tenureLabel ?? null, specific: row ? row.tenureMinDays === row.tenureMaxDays : false, scheme: row?.schemeName ?? null, nonCallable: row?.callable === false };
      })
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.bank.name.localeCompare(b.bank.name));
  }, [banks, amount, customer, normalise, bucket, tenureDays, group, includeNonCallable]);

  const offered = results.filter((r) => r.rate !== null);
  const missing = results.filter((r) => r.rate === null);

  const seg = (active: boolean) => `px-3 py-1.5 text-sm rounded-md ${active ? "bg-accent text-white dark:text-black" : "text-muted hover:text-text"}`;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1 text-sm">
          <span className="text-muted">Product</span>
          <div className="flex gap-1 rounded-md border border-border p-1">
            <button className={seg(product === "fd")} onClick={() => setProduct("fd")}>Fixed deposit</button>
            <button className={seg(product === "rd")} onClick={() => setProduct("rd")}>Recurring deposit</button>
          </div>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">{product === "fd" ? "Deposit amount" : "Monthly instalment"}</span>
          <input type="number" min={1} className="num w-full rounded-md border border-border bg-bg px-3 py-2" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <span className="text-xs text-muted">{formatINRCompact(amount)}</span>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Depositor</span>
          <select className="w-full rounded-md border border-border bg-bg px-3 py-2" value={customer} onChange={(e) => setCustomer(e.target.value as CustomerType)}>
            <option value="general">General public</option>
            <option value="senior">Senior citizen (60+)</option>
            <option value="super_senior">Super senior (80+)</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Banks</span>
          <select className="w-full rounded-md border border-border bg-bg px-3 py-2" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
            <option value="all">All tracked banks</option>
            <option value="sbi_nationalised">SBI & nationalised</option>
            <option value="private">Private banks</option>
            <option value="sfb">Small finance banks</option>
          </select>
        </label>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={normalise} onChange={(e) => setNormalise(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          <span className="font-medium">Normalise tenure</span>
          <span className="text-muted">— compare banks within common tenure buckets (special tenures such as 444 days fall into their bucket)</span>
        </label>
        {normalise ? (
          <div className="scroll-x flex gap-1">
            {TENURE_BUCKETS.map((b) => (
              <button key={b.key} className={`${seg(b.key === bucketKey)} whitespace-nowrap border border-border`} onClick={() => setBucketKey(b.key)}>
                {b.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            {([["Years", years, setYears], ["Months", months, setMonths], ["Days", days, setDays]] as const).map(([label, value, set]) => (
              <label key={label} className="block space-y-1 text-sm">
                <span className="text-muted">{label}</span>
                <input type="number" min={0} className="num w-24 rounded-md border border-border bg-bg px-3 py-2" value={value} onChange={(e) => set(Number(e.target.value))} />
              </label>
            ))}
            <span className="pb-2 text-sm text-muted">= {tenureDays} days</span>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={includeNonCallable} onChange={(e) => setIncludeNonCallable(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Include non-callable deposits (no premature withdrawal; usually ₹1 crore and above)
        </label>
      </div>

      {amount > 500000 ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          Deposit insurance (DICGC) covers up to ₹5 lakh per depositor per bank, including interest. Amounts above that carry the bank&apos;s own risk.
        </p>
      ) : null}

      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Bank</th>
              <th className="px-4 py-2 font-medium">Rate</th>
              <th className="px-4 py-2 font-medium">Tenure as published</th>
              <th className="px-4 py-2 font-medium">Effective</th>
              <th className="px-4 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {offered.map((r) => {
              const stale = daysSince(r.bank.observedAt) > STALE_DAYS;
              return (
                <tr key={r.bank.slug} className="border-t border-border hover:bg-surface">
                  <td className="px-4 py-2.5">
                    <Link href={`/banks/${r.bank.slug}`} className="font-medium hover:text-accent">
                      {r.bank.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted">{GROUP_SHORT[r.bank.group]}</span>
                  </td>
                  <td className="num px-4 py-2.5 text-base font-semibold">{formatRate(r.rate)}</td>
                  <td className="px-4 py-2.5">
                    {r.label}
                    {r.specific && normalise ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">only this exact tenure</span> : null}
                    {r.scheme ? <span className="ml-2 text-xs text-muted">{r.scheme}</span> : null}
                    {r.nonCallable ? <span className="ml-2 text-xs text-warning">non-callable</span> : null}
                  </td>
                  <td className="num px-4 py-2.5 whitespace-nowrap text-muted">{r.bank.effectiveFrom ? formatDateIST(r.bank.effectiveFrom) : "not stated"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <a href={r.bank.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      official page
                    </a>
                    {stale ? <span className="ml-2 text-xs text-warning" title={`Last read ${formatDateIST(r.bank.observedAt)}`}>stale</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missing.length > 0 ? (
        <p className="text-sm text-muted">
          Not offered for this choice or not published: {missing.map((m) => m.bank.name).join(", ")}.
        </p>
      ) : null}
      <p className="text-xs text-muted">
        Sorted by the highest published rate. Rates as read from each bank&apos;s official page (checked daily; data as of {formatDateIST(today)}). This is a
        description of published rates, not a recommendation.
      </p>
    </div>
  );
}
