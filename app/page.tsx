import Link from "next/link";
import { Card, PageHeader, Section, Stat } from "@/components/ui";
import { getSummary } from "@/lib/data";
import type { RateRow } from "@/lib/domain";
import { formatDateIST, formatRate } from "@/lib/format";
import { SHORT_NAMES, getSchemes, schemeStatus } from "@/lib/schemes";
import { getSeries } from "@/lib/series";
import { TENURE_BUCKETS, bestInBucket } from "@/lib/tenure";

type Entry = { name: string; shortName: string; group: string; effectiveFrom: string | null; observedAt: string; rows: RateRow[] };

async function topForBucket(bucketKey: string, customer: "general" | "senior") {
  const s = await getSummary<{ banks: Record<string, Entry> }>("current:fd");
  const bucket = TENURE_BUCKETS.find((b) => b.key === bucketKey)!;
  return Object.entries(s?.payload?.banks ?? {})
    .map(([slug, e]) => ({ slug, name: e.shortName || e.name, r: bestInBucket(e.rows.filter((x) => x.residency === "resident"), bucket, { amount: 1_00_000, customer, callable: true }) }))
    .filter((x) => x.r.rate !== null)
    .sort((a, b) => (b.r.rate ?? 0) - (a.r.rate ?? 0))
    .slice(0, 3);
}

export default async function Home() {
  const [oneYear, threeYear, schemes, cpi, repo, fdSummary] = await Promise.all([
    topForBucket("m12_15", "general"),
    topForBucket("y3_5", "general"),
    getSchemes(),
    getSeries<[string, number, number]>("cpi_iw_chained"),
    getSeries<[string, number]>("rbi_repo_rate"),
    getSummary<{ banks: Record<string, Entry> }>("current:fd"),
  ]);
  const bankCount = Object.keys(fdSummary?.payload?.banks ?? {}).length;
  const pts = cpi?.points ?? [];
  const last = pts.at(-1);
  const prevYear = last ? pts.find((p) => p[0] === `${Number(last[0].slice(0, 4)) - 1}${last[0].slice(4)}`) : undefined;
  const inflation = last && prevYear ? (last[1] / prevYear[1] - 1) * 100 : null;
  const repoNow = repo?.points.at(-1);
  const featured = ["ppf", "ssy", "scss", "nsc", "po_td_5y", "epf"].map((k) => schemes.find((s) => s.key === k)).filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Fixed-return rates in India, with their full history"
        lede="FD, RD and savings account rates from 44 banks, Government savings schemes, EPF, PPF and NPS — each number with its date and official source, and what it is really worth after inflation."
      />

      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Banks with live rates" value={bankCount || "—"} hint="read from official pages daily" />
        </Card>
        <Card>
          <Stat label="Inflation (CPI-IW)" value={formatRate(inflation)} hint={last ? `year on year, ${last[0]}` : undefined} />
        </Card>
        <Card>
          <Stat label="RBI repo rate" value={formatRate(repoNow?.[1] ?? null)} hint={repoNow ? `since ${formatDateIST(repoNow[0])}` : undefined} />
        </Card>
        <Card>
          <Stat label="PPF" value={formatRate(schemes.find((s) => s.key === "ppf") ? (() => { const st = schemeStatus(schemes.find((s) => s.key === "ppf")!); return st.kind === "current" ? st.rate : st.lastRate; })() : null)} hint="Government-backed, 15 years" />
        </Card>
      </div>

      <Section title="Highest published FD rates" description="General public, ₹1 lakh, callable deposits. Descriptive only — check the tenure and conditions on the bank's page.">
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["12–15 months", oneYear],
            ["3–5 years", threeYear],
          ].map(([label, list]) => (
            <Card key={label as string}>
              <p className="mb-3 text-sm font-medium">{label as string}</p>
              {(list as Awaited<ReturnType<typeof topForBucket>>).length === 0 ? (
                <p className="text-sm text-muted">Collecting today&apos;s rates…</p>
              ) : (
                <ol className="space-y-2">
                  {(list as Awaited<ReturnType<typeof topForBucket>>).map((x) => (
                    <li key={x.slug} className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/banks/${x.slug}`} className="hover:text-accent">
                        {x.name}
                        <span className="ml-2 text-xs text-muted">{x.r.tenureLabel}</span>
                      </Link>
                      <span className="num font-semibold">{formatRate(x.r.rate)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <Link href="/deposits" className="mt-3 inline-block text-xs text-accent hover:underline">
                Compare all banks →
              </Link>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Government schemes today">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((s) => {
            const st = schemeStatus(s!);
            const rate = st.kind === "current" ? st.rate : st.lastRate;
            return (
              <Link key={s!.key} href={`/schemes/${s!.key}`}>
                <Card className="flex items-baseline justify-between hover:bg-surface">
                  <span className="text-sm">{SHORT_NAMES[s!.key]}</span>
                  <span className="num text-lg font-semibold">{formatRate(rate)}</span>
                </Card>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title="Explore">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["/deposits", "FD & RD rates", "Compare banks by tenure, amount and age group."],
            ["/savings", "Savings accounts", "Interest you would earn on your balance."],
            ["/banks", "Banks", "Every bank's current card, history and lineage."],
            ["/real-value", "Real value of money", "What an amount was worth then and now."],
            ["/calculators", "Calculators", "FD and RD maturity."],
            ["/retirement", "Retirement simulator", "PPF, EPF, VPF and NPS side by side."],
          ].map(([href, title, text]) => (
            <Link key={href} href={href}>
              <Card className="h-full hover:bg-surface">
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
