"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { savingsBlendedRate, savingsYearInterest } from "@/lib/calc/deposits";
import type { SavingsSlab, SlabMethod } from "@/lib/domain";
import { formatDateIST, formatINR, formatINRCompact, formatRate } from "@/lib/format";

export interface BankSavings {
  slug: string;
  name: string;
  group: "sbi_nationalised" | "private" | "sfb" | "payments";
  effectiveFrom: string | null;
  observedAt: string;
  sourceUrl: string;
  slabs: SavingsSlab[];
  method: SlabMethod;
}

const METHOD_LABEL: Record<SlabMethod, string> = { whole: "whole balance", incremental: "slice by slice", unknown: "method not stated" };

export function SavingsComparison({ banks, postOfficeRate }: { banks: BankSavings[]; postOfficeRate: number | null }) {
  const [balance, setBalance] = useState(100000);
  const [group, setGroup] = useState<"all" | BankSavings["group"]>("all");
  const rows = useMemo(
    () =>
      banks
        .filter((b) => group === "all" || b.group === group)
        .map((b) => {
          const slabs = b.slabs.filter((s) => s.residency === "resident");
          // For "unknown" we show the whole-balance reading but flag it.
          const method: SlabMethod = b.method === "unknown" ? "whole" : b.method;
          return { bank: b, rate: savingsBlendedRate(balance, slabs, method), interest: savingsYearInterest(balance, slabs, method) };
        })
        .sort((a, b) => (b.interest ?? -1) - (a.interest ?? -1)),
    [banks, balance, group],
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Average balance</span>
          <input type="number" min={1} className="num w-full rounded-md border border-border bg-bg px-3 py-2" value={balance} onChange={(e) => setBalance(Number(e.target.value))} />
          <span className="text-xs text-muted">{formatINRCompact(balance)}</span>
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
      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Bank</th>
              <th className="px-4 py-2 font-medium">Interest in a year</th>
              <th className="px-4 py-2 font-medium">Effective rate</th>
              <th className="px-4 py-2 font-medium">Slab rule</th>
              <th className="px-4 py-2 font-medium">Effective</th>
            </tr>
          </thead>
          <tbody>
            {postOfficeRate !== null ? (
              <tr className="border-t border-border bg-surface/50">
                <td className="px-4 py-2.5">
                  <Link href="/schemes/po_sb" className="font-medium hover:text-accent">Post Office Savings</Link>
                  <span className="ml-2 text-xs text-muted">Govt</span>
                </td>
                <td className="num px-4 py-2.5">{formatINR(Math.round((balance * postOfficeRate) / 100))}</td>
                <td className="num px-4 py-2.5">{formatRate(postOfficeRate)}</td>
                <td className="px-4 py-2.5 text-muted">flat</td>
                <td className="px-4 py-2.5 text-muted">for reference</td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.bank.slug} className="border-t border-border hover:bg-surface">
                <td className="px-4 py-2.5">
                  <Link href={`/banks/${r.bank.slug}`} className="font-medium hover:text-accent">
                    {r.bank.name}
                  </Link>
                </td>
                <td className="num px-4 py-2.5 font-semibold">{r.interest !== null ? formatINR(Math.round(r.interest)) : <span className="text-muted italic">not reported</span>}</td>
                <td className="num px-4 py-2.5">{formatRate(r.rate)}</td>
                <td className="px-4 py-2.5 text-muted">
                  {METHOD_LABEL[r.bank.method]}
                  {r.bank.method === "unknown" ? <span title="The bank does not say; figures assume the whole-balance reading"> *</span> : null}
                </td>
                <td className="num px-4 py-2.5 whitespace-nowrap">
                  <a href={r.bank.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    {r.bank.effectiveFrom ? formatDateIST(r.bank.effectiveFrom) : "not stated"}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Interest is calculated on the daily balance and credited quarterly (monthly at some banks); a steady balance is assumed. “Slice by slice” means each part of
        the balance earns its own slab&apos;s rate. * The bank does not state its slab rule; the whole-balance reading is shown.
      </p>
    </div>
  );
}
