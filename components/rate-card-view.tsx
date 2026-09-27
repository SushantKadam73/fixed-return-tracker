import type { RateRow, SavingsSlab } from "@/lib/domain";
import { formatINRCompact, formatRate } from "@/lib/format";

/**
 * Current FD/RD card as a compact table: one row per tenure slab, general and senior side by side.
 * Only rows for resident depositors in the lowest amount band are shown here; the bank page
 * lists other bands (bulk, non-callable) separately.
 */
export function TermRateTable({ rows }: { rows: RateRow[] }) {
  const resident = rows.filter((r) => r.residency === "resident");
  const minAmount = Math.min(...resident.map((r) => r.amountMin));
  const retail = resident.filter((r) => r.amountMin === minAmount && r.callable !== false);
  const slabs = new Map<string, { label: string; min: number; max: number; special: boolean; scheme?: string; general?: number; senior?: number; superSenior?: number }>();
  for (const r of retail) {
    const key = `${r.tenureMinDays}-${r.tenureMaxDays}-${r.schemeName ?? ""}`;
    const s = slabs.get(key) ?? { label: r.tenureLabel, min: r.tenureMinDays, max: r.tenureMaxDays, special: !!r.special, scheme: r.schemeName };
    if (r.customer === "general") s.general = r.rate;
    if (r.customer === "senior") s.senior = r.rate;
    if (r.customer === "super_senior") s.superSenior = r.rate;
    slabs.set(key, s);
  }
  const list = [...slabs.values()].sort((a, b) => a.min - b.min || a.max - b.max);
  const hasSuper = list.some((s) => s.superSenior !== undefined);
  const band = retail[0];
  return (
    <div className="space-y-2">
      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Tenure</th>
              <th className="px-4 py-2 font-medium">General</th>
              <th className="px-4 py-2 font-medium">Senior citizen</th>
              {hasSuper ? <th className="px-4 py-2 font-medium">Super senior</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={`${s.min}-${s.max}-${s.scheme ?? ""}`} className="border-t border-border">
                <td className="px-4 py-2">
                  {s.label}
                  {s.special ? <span className="ml-2 text-xs text-accent">special{s.scheme ? ` · ${s.scheme}` : ""}</span> : null}
                </td>
                <td className="num px-4 py-2">{s.general !== undefined ? formatRate(s.general) : <span className="text-muted italic">—</span>}</td>
                <td className="num px-4 py-2">{s.senior !== undefined ? formatRate(s.senior) : <span className="text-muted italic">—</span>}</td>
                {hasSuper ? <td className="num px-4 py-2">{s.superSenior !== undefined ? formatRate(s.superSenior) : <span className="text-muted italic">—</span>}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {band ? (
        <p className="text-xs text-muted">
          Resident deposits{" "}
          {band.amountMin === 0
            ? band.amountMax !== null
              ? `below ${formatINRCompact(band.amountMax)}`
              : "of any amount"
            : `from ${formatINRCompact(band.amountMin)}${band.amountMax !== null ? ` to below ${formatINRCompact(band.amountMax)}` : ""}`}
          . “—” means the bank does not publish that rate.
        </p>
      ) : null}
    </div>
  );
}

export function SavingsSlabTable({ slabs, method }: { slabs: SavingsSlab[]; method: string | null }) {
  const sorted = [...slabs].filter((s) => s.residency === "resident").sort((a, b) => a.balanceMin - b.balanceMin);
  return (
    <div className="space-y-2">
      <div className="scroll-x rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Balance</th>
              <th className="px-4 py-2 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={`${s.balanceMin}-${s.balanceMax}`} className="border-t border-border">
                <td className="px-4 py-2">
                  {s.balanceMax === null && s.balanceMin === 0
                    ? "Any balance"
                    : s.balanceMax === null
                    ? `Above ${formatINRCompact(s.balanceMin)}`
                    : s.balanceMin === 0
                      ? `Up to ${formatINRCompact(s.balanceMax)}`
                      : `${formatINRCompact(s.balanceMin)} – ${formatINRCompact(s.balanceMax)}`}
                </td>
                <td className="num px-4 py-2">{formatRate(s.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {method === "incremental"
          ? "Each slice of your balance earns its own slab's rate."
          : method === "whole"
            ? "The rate of the slab your balance falls in applies to the whole balance."
            : "The bank does not state clearly whether slab rates apply to the whole balance or only to each slice."}
      </p>
    </div>
  );
}
