import type { BankCoverage, ProductCoverage } from "@/lib/coverage";
import { formatDateIST } from "@/lib/format";
import { SourceBadge } from "./ui";

export const PRODUCT_SHORT: Record<string, string> = {
  fd: "FD",
  rd: "RD",
  savings: "Savings",
  fd_bulk: "Bulk FD",
  tax_saver: "Tax-saver FD",
  nre: "NRE",
  nro: "NRO",
};

export function monthYear(d: string): string {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

function span(days: number): string {
  if (days >= 365) return `${(days / 365.25).toFixed(1)} years`;
  if (days >= 60) return `${Math.round(days / 30.44)} months`;
  return `${days} days`;
}

/** True when the bank ceased before this product's rates were deregulated (its rates were never bank-set). */
export const neverBankSet = (p: ProductCoverage) => p.versions === 0 && p.expectedFrom > p.expectedTo;

/** Compact table cell: first month with evidence and the number of recorded versions. */
export function CoverageCell({ p }: { p: ProductCoverage | undefined }) {
  if (p && neverBankSet(p)) return <span className="text-xs text-muted" title="The bank ceased before these rates were deregulated">RBI-set era</span>;
  if (!p || p.versions === 0 || !p.earliest) return <span className="text-xs italic text-muted">not recorded</span>;
  const gaps = p.gaps.filter((g) => g.kind !== "none").length;
  return (
    <span className="num whitespace-nowrap" title={`${p.versions} recorded versions${gaps ? `, ${gaps} gap${gaps > 1 ? "s" : ""}` : ""}`}>
      {monthYear(p.earliest)}
      <span className="text-muted"> · {p.versions}</span>
      {gaps ? <span className="ml-1 text-xs text-muted">({gaps} gap{gaps > 1 ? "s" : ""})</span> : null}
    </span>
  );
}

/** Per-product coverage details for a bank page. */
export function CoverageDetails({ coverage }: { coverage: BankCoverage }) {
  return (
    <ul className="space-y-3 text-sm">
      {coverage.products.map((p) => (
        <li key={p.product} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium">{PRODUCT_SHORT[p.product] ?? p.product}</span>
            {neverBankSet(p) ? (
              <span className="text-muted">rates were set by RBI for all banks throughout this bank&apos;s existence</span>
            ) : p.versions > 0 && p.earliest ? (
              <span className="text-muted">
                evidence from <span className="num text-text">{formatDateIST(p.earliest)}</span>
                {p.latest ? (
                  <>
                    {" "}
                    to <span className="num text-text">{formatDateIST(p.latest)}</span>
                  </>
                ) : null}{" "}
                · {p.versions} version{p.versions === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="italic text-muted">no bank-specific rates recorded yet</span>
            )}
          </div>
          {p.versions > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Object.entries(p.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([src, n]) => (
                  <span key={src} className="inline-flex items-center gap-1">
                    <SourceBadge sourceType={src} />
                    <span className="num text-xs text-muted">×{n}</span>
                  </span>
                ))}
              <span className="text-xs text-muted">
                · {p.byGranularity.exact} with exact effective dates
                {p.byGranularity.window ? `, ${p.byGranularity.window} dated by archive captures` : ""}
              </span>
            </div>
          ) : null}
          {p.gaps.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              {p.gaps[0].kind === "none" ? "Nothing recorded for " : "No evidence found for "}
              {p.gaps.map((g, i) => (
                <span key={g.from}>
                  {i > 0 ? "; " : ""}
                  <span className="num">
                    {monthYear(g.from)} – {monthYear(g.to)}
                  </span>{" "}
                  ({span(g.days)})
                </span>
              ))}
              . Shown as not reported, never estimated.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
