import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CoverageCell, monthYear } from "@/components/coverage-view";
import { AsOf, Card, Notice, PageHeader, Section, Stat } from "@/components/ui";
import { GROUP_LABELS, GROUP_ORDER, formatFounded, getBankMaster, getCoverage, type BankGroupKey } from "@/lib/banks";
import type { BankCoverage } from "@/lib/coverage";

export const metadata: Metadata = {
  title: "History coverage — how far back each bank's deposit rates go",
  description: "For every bank and merged predecessor: the earliest recorded FD, RD, savings and bulk rates, how each was evidenced, and the periods with no evidence.",
};

export const revalidate = 86400;

const PRODUCTS = ["fd", "rd", "savings", "fd_bulk"] as const;

function Row({ c, depth = 0 }: { c: BankCoverage; depth?: number }) {
  const byProduct = new Map(c.products.map((p) => [p.product, p]));
  return (
    <tr className="border-t border-border hover:bg-surface">
      <td className="px-4 py-2" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
        <Link href={`/banks/${c.slug}`} className={depth ? "text-muted hover:text-accent" : "font-medium hover:text-accent"}>
          {c.name}
        </Link>
        {c.mergedOn ? <span className="ml-1 text-xs text-muted">merged {c.mergedOn.slice(0, 4)}</span> : null}
      </td>
      <td className="num px-4 py-2 whitespace-nowrap text-muted">{formatFounded(c.founded)}</td>
      {PRODUCTS.map((p) => (
        <td key={p} className="px-4 py-2">
          <CoverageCell p={byProduct.get(p)} />
        </td>
      ))}
    </tr>
  );
}

export default async function CoveragePage() {
  const [{ generatedOn, banks }, master] = await Promise.all([getCoverage(), getBankMaster()]);
  const current = banks.filter((b) => b.kind === "bank");
  const preds = banks.filter((b) => b.kind === "predecessor");
  const childrenOf = (slug: string) => preds.filter((p) => p.mergedInto === slug);
  const versions = banks.reduce((n, b) => n + b.products.reduce((m, p) => m + p.versions, 0), 0);
  const withHistory = current.filter((b) => b.products.some((p) => p.versions > 1)).length;
  const earliest = banks
    .map((b) => b.earliestEvidence)
    .filter((d): d is string => !!d)
    .sort()[0];
  const groupOf = new Map(master.banks.map((b) => [b.slug, b.group]));

  const renderTree = (c: BankCoverage, depth: number): ReactNode[] => [
    <Row key={c.slug} c={c} depth={depth} />,
    ...childrenOf(c.slug).flatMap((p) => renderTree(p, depth + 1)),
  ];

  return (
    <div>
      <PageHeader
        title="How far back each bank's history goes"
        lede="Every rate on this site comes from a recorded source. This page shows, for each bank and each bank that merged into it, the earliest deposit rates recorded, how many versions exist, and the periods for which no evidence has been found yet."
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Recorded rate versions" value={versions.toLocaleString("en-IN")} hint="across banks, predecessors and products" />
        <Stat label="Banks with history beyond today's rates" value={`${withHistory} of ${current.length}`} />
        <Stat label="Earliest bank-specific evidence" value={earliest ? monthYear(earliest) : "not reported"} />
      </div>
      <Notice>
        Until 22 October 1997 RBI prescribed term-deposit rates for every bank, and until 25 October 2011 it fixed the savings rate. Those
        system-wide rates are on the <Link href="/history" className="text-accent hover:underline">history page</Link> and on each bank&apos;s page. The
        coverage below counts only each bank&apos;s own rates, which exist from those dates (or from the bank&apos;s founding, if later).
      </Notice>
      {GROUP_ORDER.filter((g) => g !== "payments").map((g) => {
        const rows = current.filter((b) => groupOf.get(b.slug) === (g as BankGroupKey));
        if (rows.length === 0) return null;
        return (
          <Section key={g} title={GROUP_LABELS[g]}>
            <div className="scroll-x rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bank</th>
                    <th className="px-4 py-2 font-medium">Founded</th>
                    <th className="px-4 py-2 font-medium">FD from</th>
                    <th className="px-4 py-2 font-medium">RD from</th>
                    <th className="px-4 py-2 font-medium">Savings from</th>
                    <th className="px-4 py-2 font-medium">Bulk from</th>
                  </tr>
                </thead>
                <tbody>{rows.flatMap((c) => renderTree(c, 0))}</tbody>
              </table>
            </div>
          </Section>
        );
      })}
      <Card>
        <p className="text-sm text-muted">
          Each cell shows the month of the earliest recorded version and the number of versions. A gap is a stretch of more than six months with
          no recorded rate; bank pages list them. Sources include each bank&apos;s current page, its own published archives, Internet Archive
          copies of its official pages, RBI and Government publications and, where nothing else exists, dated press reports (labelled as such).
        </p>
        <div className="mt-3">
          <AsOf date={generatedOn} label="Report built" />
        </div>
      </Card>
    </div>
  );
}
