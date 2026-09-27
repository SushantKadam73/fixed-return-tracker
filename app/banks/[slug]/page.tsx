import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RateHistoryChart } from "@/components/charts/rate-history-chart";
import { SavingsSlabTable, TermRateTable } from "@/components/rate-card-view";
import { AsOf, Badge, Card, Notice, PageHeader, Section, SourceBadge } from "@/components/ui";
import { GROUP_LABELS, formatFounded, getBankMaster, lineageOf } from "@/lib/banks";
import { getFreshness, getSummary } from "@/lib/data";
import type { RateRow, SavingsSlab } from "@/lib/domain";
import { formatDateIST } from "@/lib/format";

type CardMeta = {
  effectiveFrom: string | null;
  validTo: string | null;
  observedAt: string;
  observedFrom: string | null;
  observedTo: string | null;
  sourceType: string;
  sourceUrl: string;
  archiveUrl: string | null;
  confidence: string;
};
type ProductSummary = {
  current: (CardMeta & { rows: RateRow[]; savingsSlabs: SavingsSlab[] | null; slabMethod: string | null; notes: string[] }) | null;
  versions: Array<CardMeta & { isCurrent: boolean; general: Record<string, number | null> | null; senior: Record<string, number | null> | null; baseSavingsRate: number | null }>;
};
type BankSummary = { products: Record<string, ProductSummary> };

const PRODUCT_LABELS: Record<string, string> = {
  fd: "Fixed deposits",
  rd: "Recurring deposits",
  savings: "Savings account",
  fd_bulk: "Bulk deposits (₹3 crore and above)",
  nre: "NRE deposits",
  nro: "NRO deposits",
  tax_saver: "Tax-saver deposits",
};

export async function generateStaticParams() {
  const { banks } = await getBankMaster();
  return banks.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: PageProps<"/banks/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { banks } = await getBankMaster();
  const bank = banks.find((b) => b.slug === slug);
  return bank
    ? { title: `${bank.name} FD, RD and savings interest rates with history`, description: `Current and historical deposit rates of ${bank.name}, with sources and merger history.` }
    : {};
}

function historyPoints(versions: ProductSummary["versions"], pick: (v: ProductSummary["versions"][number]) => number | null) {
  return versions.map((v) => ({ date: v.effectiveFrom ?? v.observedFrom ?? v.observedAt, value: pick(v) }));
}

export default async function BankPage({ params }: PageProps<"/banks/[slug]">) {
  const { slug } = await params;
  const { banks, predecessors } = await getBankMaster();
  const bank = banks.find((b) => b.slug === slug);
  if (!bank) notFound();
  const summary = await getSummary<BankSummary>(`bank:${slug}`);
  const fresh = (await getFreshness())[slug] ?? {};
  const products = summary?.payload?.products ?? {};
  const lineage = lineageOf(slug, predecessors);

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href="/banks" className="text-muted hover:text-text">
          ← All banks
        </Link>
      </p>
      <PageHeader title={bank.name}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="accent">{GROUP_LABELS[bank.group]}</Badge>
          <span>Founded {formatFounded(bank.founded)}</span>
          {bank.hq ? <span>· {bank.hq}</span> : null}
          {bank.website ? (
            <a className="text-accent hover:underline" href={`https://${bank.website}`} target="_blank" rel="noopener noreferrer">
              · {bank.website}
            </a>
          ) : null}
          {bank.tracking === "deferred" ? <Badge>tracked in a later release</Badge> : null}
        </div>
      </PageHeader>

      {Object.keys(products).length === 0 ? (
        <Notice>
          Rates for {bank.shortName} appear here once the daily collector has read the bank&apos;s official rate pages. Nothing is shown
          until it has been read from the bank&apos;s own website.
        </Notice>
      ) : null}

      {(["fd", "rd", "savings", "fd_bulk", "tax_saver", "nre", "nro"] as const).map((product) => {
        const p = products[product];
        if (!p) return null;
        const c = p.current;
        return (
          <Section key={product} title={PRODUCT_LABELS[product] ?? product}>
            {c ? (
              <Card>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <SourceBadge sourceType={c.sourceType} />
                  {c.effectiveFrom ? <span className="text-xs text-muted">Effective {formatDateIST(c.effectiveFrom)}</span> : null}
                  <a className="text-xs text-accent hover:underline" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Official page
                  </a>
                </div>
                {product === "savings" && c.savingsSlabs ? <SavingsSlabTable slabs={c.savingsSlabs} method={c.slabMethod} /> : <TermRateTable rows={c.rows} />}
                <div className="mt-3">
                  <AsOf date={(fresh[product] ?? c.observedAt).slice(0, 10)} label="Last checked" />
                </div>
              </Card>
            ) : (
              <Notice tone="warning">No current card: the latest read failed validation or the page is unavailable. History below is kept.</Notice>
            )}
            {p.versions.length > 1 ? (
              <Card className="mt-4">
                <p className="mb-2 text-sm font-medium">History</p>
                <RateHistoryChart
                  series={
                    product === "savings"
                      ? [{ key: "base", label: "Base savings rate", color: "var(--accent)", points: historyPoints(p.versions, (v) => v.baseSavingsRate) }]
                      : [
                          { key: "g1", label: "1 year · general", color: "var(--accent)", points: historyPoints(p.versions, (v) => v.general?.["1y"] ?? null) },
                          { key: "g3", label: "3 years · general", color: "#6d8fd8", points: historyPoints(p.versions, (v) => v.general?.["3y"] ?? null) },
                          { key: "s1", label: "1 year · senior", color: "var(--accent)", dashed: true, points: historyPoints(p.versions, (v) => v.senior?.["1y"] ?? null) },
                        ]
                  }
                />
                <p className="mt-2 text-xs text-muted">{p.versions.length} recorded versions.</p>
              </Card>
            ) : null}
            {p.versions.length > 0 ? (
              <details className="mt-3 rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">All recorded versions ({p.versions.length})</summary>
                <div className="scroll-x mt-3">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 pr-4">In force</th>
                        <th className="py-1 pr-4">{product === "savings" ? "Base rate" : "1 yr / 3 yr (general)"}</th>
                        <th className="py-1 pr-4">Evidence</th>
                        <th className="py-1 pr-4">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...p.versions].reverse().map((v, i) => (
                        <tr key={`${v.effectiveFrom ?? v.observedFrom ?? v.observedAt}-${i}`} className="border-t border-border">
                          <td className="num py-1.5 pr-4 whitespace-nowrap">
                            {v.effectiveFrom
                              ? `from ${formatDateIST(v.effectiveFrom)}${v.validTo ? ` to ${formatDateIST(v.validTo)}` : ""}`
                              : v.observedFrom
                                ? `seen ${formatDateIST(v.observedFrom)}${v.observedTo && v.observedTo !== v.observedFrom ? ` – ${formatDateIST(v.observedTo)}` : ""}`
                                : `seen ${formatDateIST(v.observedAt)}`}
                          </td>
                          <td className="num py-1.5 pr-4">
                            {product === "savings"
                              ? v.baseSavingsRate !== null ? `${v.baseSavingsRate.toFixed(2)}%` : "—"
                              : `${v.general?.["1y"] != null ? `${v.general["1y"].toFixed(2)}%` : "—"} / ${v.general?.["3y"] != null ? `${v.general["3y"].toFixed(2)}%` : "—"}`}
                          </td>
                          <td className="py-1.5 pr-4"><SourceBadge sourceType={v.sourceType} /></td>
                          <td className="py-1.5 pr-4">
                            <a className="text-accent hover:underline" href={v.archiveUrl ?? v.sourceUrl} target="_blank" rel="noopener noreferrer">
                              {v.archiveUrl ? "archived copy" : "official page"}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </Section>
        );
      })}

      <Section title="Lineage" description="Banks that merged into or were renamed as this bank. Their own historical rates are kept under their names.">
        {lineage.length === 0 ? (
          <p className="text-sm text-muted">No mergers recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {lineage.map((p) => (
              <li key={p.slug} style={{ paddingLeft: `${p.depth * 1.25}rem` }}>
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-muted">
                  {p.relation === "merged" ? "merged" : "renamed/converted"}
                  {p.mergedOn ? ` on ${formatDateIST(p.mergedOn)}` : ""}
                  {p.founded ? ` · founded ${formatFounded(p.founded)}` : ""}
                </span>{" "}
                {p.evidenceUrl ? (
                  <a className="text-xs text-accent hover:underline" href={p.evidenceUrl} target="_blank" rel="noopener noreferrer">
                    source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {bank.history.length > 0 ? (
        <Section title="Timeline">
          <ol className="space-y-2 border-l border-border pl-4 text-sm">
            {bank.history.map((h, i) => (
              <li key={`${h.date}-${i}`}>
                <span className="num mr-2 text-muted">{/^\d{4}-\d{2}-\d{2}$/.test(h.date) ? formatDateIST(h.date) : h.date}</span>
                {h.event}{" "}
                {h.evidenceUrl ? (
                  <a className="text-xs text-accent hover:underline" href={h.evidenceUrl} target="_blank" rel="noopener noreferrer">
                    source
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </div>
  );
}
