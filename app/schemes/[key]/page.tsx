import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RateHistoryChart } from "@/components/charts/rate-history-chart";
import { Badge, Card, Notice, PageHeader, Section, Stat } from "@/components/ui";
import { formatDateIST, formatRate } from "@/lib/format";
import { SCHEME_ORDER, SHORT_NAMES, getSchemes, schemeChartPoints, schemeStatus } from "@/lib/schemes";

export async function generateStaticParams() {
  return SCHEME_ORDER.map((key) => ({ key }));
}

export async function generateMetadata({ params }: PageProps<"/schemes/[key]">): Promise<Metadata> {
  const { key } = await params;
  const name = SHORT_NAMES[key] ?? key;
  return { title: `${name} interest rate history`, description: `Current ${name} interest rate and every change since the scheme began, with sources.` };
}

export default async function SchemePage({ params }: PageProps<"/schemes/[key]">) {
  const { key } = await params;
  const scheme = (await getSchemes()).find((s) => s.key === key);
  if (!scheme) notFound();
  const st = schemeStatus(scheme);
  const sorted = [...scheme.periods].sort((a, b) => b.from.localeCompare(a.from));
  const rated = scheme.periods.filter((p) => p.rate !== null);
  const high = rated.reduce<number | null>((m, p) => (m === null || (p.rate as number) > m ? (p.rate as number) : m), null);
  const low = rated.reduce<number | null>((m, p) => (m === null || (p.rate as number) < m ? (p.rate as number) : m), null);

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href="/schemes" className="text-muted hover:text-text">
          ← All schemes
        </Link>
      </p>
      <PageHeader title={SHORT_NAMES[scheme.key] ?? scheme.name} lede={scheme.name} />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat
            label={st.kind === "current" ? "Current rate" : st.kind === "closed" ? "Final rate" : "Last notified rate"}
            value={st.kind === "current" ? formatRate(st.rate) : formatRate(st.lastRate)}
            hint={
              st.kind === "current"
                ? `since ${formatDateIST(st.since)}`
                : st.kind === "closed"
                  ? `scheme closed ${formatDateIST(st.closedOn)}`
                  : `period ended ${formatDateIST(st.lastPeriodEnd)}; next rate not yet published`
            }
          />
        </Card>
        <Card>
          <Stat label="Highest ever" value={formatRate(high)} hint={`history from ${formatDateIST(scheme.periods[0]?.from)}`} />
        </Card>
        <Card>
          <Stat label="Lowest ever" value={formatRate(low)} hint={`${scheme.periods.length} notified periods`} />
        </Card>
      </div>

      <Section title="Rate history" description="Each step is a notified change. Gaps mean no published rate was found for that stretch — nothing is filled in.">
        <Card>
          <RateHistoryChart series={[{ key: "rate", label: "Rate", color: "var(--accent)", points: schemeChartPoints(scheme) }]} />
        </Card>
      </Section>

      {scheme.conventions.length > 0 ? (
        <Section title="How it works">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {scheme.conventions.map((c) => (
              <li key={c} className="first-letter:uppercase">
                {c}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {scheme.gaps.length > 0 ? (
        <Section title="Known gaps">
          <Notice>
            <ul className="list-disc space-y-1 pl-5">
              {scheme.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </Notice>
        </Section>
      ) : null}

      <Section title="All notified periods">
        <div className="scroll-x rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">Rate</th>
                <th className="px-4 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.from} className="border-t border-border align-top">
                  <td className="num px-4 py-2 whitespace-nowrap">{formatDateIST(p.from)}</td>
                  <td className="num px-4 py-2 whitespace-nowrap">{p.to ? formatDateIST(p.to) : "—"}</td>
                  <td className="num px-4 py-2">
                    {p.rate !== null ? formatRate(p.rate) : p.maturityMonths ? `doubles in ${p.maturityMonths} months` : <span className="text-muted italic">not published</span>}
                    {p.note ? <p className="mt-0.5 max-w-md text-xs text-muted">{p.note}</p> : null}
                  </td>
                  <td className="px-4 py-2">
                    {p.sourceUrl ? (
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        source
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}{" "}
                    {p.evidence === "secondary" ? <Badge tone="warning">secondary</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
