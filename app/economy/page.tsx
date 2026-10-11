import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section, Notice } from "@/components/ui";
import { getLiveStatus, readDataset } from "@/lib/data";
import { getSeries } from "@/lib/series";
import { formatRate } from "@/lib/format";

export const metadata: Metadata = { title: "RBI rates and inflation", description: "Sourced RBI policy rates and official measured inflation, with dates and historical records." };
export const revalidate = 900;
const policies = ["rbi_repo_rate", "rbi_reverse_repo_rate", "rbi_sdf_rate", "rbi_msf_rate", "rbi_bank_rate", "rbi_crr", "rbi_slr"];
type Observation = { value: number; observedAt: string; effectiveFrom: string | null; sourceUrl: string };

export default async function EconomyPage() {
  const live = await getLiveStatus();
  const observations = live?.macro?.observations ?? await readDataset<Record<string, Observation>>("macro/observations.json") ?? {};
  const [rates, combined, iw] = await Promise.all([
    Promise.all(policies.map((key) => getSeries(key))), getSeries("cpi_combined_monthly_2024base"), getSeries("cpi_iw_chained"),
  ]);
  return <div><PageHeader title="RBI rates & inflation" lede="Official measured indicators, their dates and their sources. Policy rates describe monetary conditions; they are not bank deposit offers." />
    <Section title="Policy rates and reserve ratios"><div className="scroll-x"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left"><th className="p-3">Indicator</th><th className="p-3">Published value</th><th className="p-3">Date and evidence</th></tr></thead><tbody>{rates.map((series, index) => {
      const key = policies[index];
      const observation = observations[key];
      const last = series?.points.at(-1);
      return <tr key={key} className="border-t border-border"><td className="p-3">{series?.name ?? key}</td><td className="num p-3">{formatRate(observation?.value ?? last?.[1] ?? null)}</td><td className="p-3"><a className="text-accent" href={observation?.sourceUrl ?? series?.sourceUrl ?? "https://www.rbi.org.in/"} target="_blank" rel="noopener noreferrer">{observation ? `Observed ${observation.observedAt}; effective date not established from homepage` : last ? `Historical record dated ${last[0]}; current value unverified` : "Not reported"}</a></td></tr>;
    })}</tbody></table></div><p className="mt-3 text-xs text-muted">Reverse repo and the Standing Deposit Facility (SDF) are distinct. An unavailable reverse-repo reading retains labelled historical data. CRR and SLR are reserve ratios, not investment returns.</p></Section>
    <Section title="Measured inflation"><div className="grid gap-4 sm:grid-cols-2">{[combined, iw].map((series, index) => {
      if (!series) return <p key={index}>Series not available</p>;
      const latest = series.points.at(-1);
      const earlierMonth = latest ? `${Number(latest[0].slice(0, 4)) - 1}${latest[0].slice(4)}` : "";
      const earlier = series.points.find((point) => point[0] === earlierMonth);
      const yoy = latest && earlier && earlier[1] > 0 ? (latest[1] / earlier[1] - 1) * 100 : null;
      return <div key={series.key} className="rounded-lg border border-border p-4"><h3 className="font-semibold">{series.name}</h3><p className="mt-2 text-sm">Latest recorded month: {latest?.[0] ?? "not reported"}</p><p className="text-sm">Index: {latest?.[1] ?? "not reported"} · {series.unit}</p><p className="text-sm">Year-on-year change: {formatRate(yoy)}</p><a className="text-sm text-accent" href={series.sourceUrl} target="_blank" rel="noopener noreferrer">Official dataset source</a></div>;
    })}</div><p className="mt-3 text-sm text-muted">CPI Combined measures a national household basket; CPI-IW measures the industrial-worker basket. Government CPI is measured inflation. Your own spending mix can produce a different personal inflation rate. Neither index is an RBI inflation forecast.</p></Section>
    <Section title="History and purchasing power"><p className="text-sm"><Link className="text-accent" href="/data">Download policy and CPI histories</Link> · <Link className="text-accent" href="/real-value">Purchasing-power calculator</Link> · <Link className="text-accent" href="/status">Collection status</Link></p></Section>
    <Notice>Historical series have gaps and differing frequencies. The CPI annual series with an unexplained discontinuity is excluded from this page. Forecast vintages and source-confirmed base-linking revisions need separate evidence before publication.</Notice>
  </div>;
}
