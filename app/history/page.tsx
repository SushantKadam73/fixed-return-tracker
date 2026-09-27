import type { Metadata } from "next";
import Link from "next/link";
import { RateHistoryChart } from "@/components/charts/rate-history-chart";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { readDataset } from "@/lib/data";
import { formatDateIST, formatRate } from "@/lib/format";
import { getSeries } from "@/lib/series";

export const metadata: Metadata = {
  title: "History of deposit and interest rates in India",
  description: "RBI-prescribed bank deposit rates from 1970-71, the savings rate until its deregulation in 2011, the Bank Rate since 1935, the repo rate, bond yields and the milestones of deregulation.",
};

type RangePoint = [string, number | null, number | null, string];
type Milestone = { date: string; dateKind: string; title: string; category: string; sourceUrl: string };

const fyEnd = (d: string) => d; // points are already dated at fiscal-year end (31 March)

/** Insert a line break (null point) at documented source gaps such as "GAP 2002-11-01 to 2007-12-31". */
function withGaps(points: Array<{ date: string; value: number | null }>, notes: string[] | undefined) {
  const out = [...points];
  for (const n of notes ?? []) {
    for (const m of n.matchAll(/GAP (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g)) out.push({ date: m[1], value: null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export default async function HistoryPage() {
  const [td13, td35, td5, sav, bank, repo, gsec] = await Promise.all([
    getSeries<RangePoint>("rbi_td_1_3y"),
    getSeries<RangePoint>("rbi_td_3_5y"),
    getSeries<RangePoint>("rbi_td_5y_plus"),
    getSeries<[string, number | null, string | null]>("rbi_savings_rate"),
    getSeries<[string, number]>("rbi_bank_rate"),
    getSeries<[string, number]>("rbi_repo_rate"),
    getSeries<[string, number]>("gsec_yield_annual"),
  ]);
  const milestones = ((await readDataset<{ milestones: Milestone[] }>("history/rbi/deposit-rule-milestones.json"))?.milestones ?? [])
    .filter((m) => m.dateKind === "exact")
    .sort((a, b) => a.date.localeCompare(b.date));

  const upper = (s: typeof td13) => (s?.points ?? []).map(([d, , hi]) => ({ date: fyEnd(d), value: hi }));
  const fyToDate = (fy: string) => `${Number(fy.slice(0, 4)) + 1}-03-31`;

  return (
    <div>
      <PageHeader
        title="How interest rates have changed in India"
        lede="Before deregulation, RBI set the deposit rates every bank paid. This page shows those system-wide rates, the savings rate RBI fixed until 2011, and the policy rates and bond yields that shape deposit rates today. Each bank's own history is on its bank page."
      />

      <Section title="Bank term-deposit rates set by RBI (1970-71 to 1997-98)" description="Rates as at 31 March each year, for all scheduled commercial banks. Where RBI allowed a range within a bucket, the upper end is drawn; the table below gives both ends.">
        <Card>
          <RateHistoryChart
            series={[
              { key: "a", label: "1–3 years", color: "var(--accent)", points: upper(td13) },
              { key: "b", label: "3–5 years", color: "#6d8fd8", points: upper(td35) },
              { key: "c", label: "Above 5 years", color: "#d9822b", points: upper(td5) },
            ]}
          />
        </Card>
        <details className="mt-3 rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Year-by-year table</summary>
          <div className="scroll-x mt-3">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 pr-4">As at</th>
                  <th className="py-1 pr-4">1–3 years</th>
                  <th className="py-1 pr-4">3–5 years</th>
                  <th className="py-1 pr-4">Above 5 years</th>
                </tr>
              </thead>
              <tbody>
                {(td13?.points ?? []).map(([d, lo, hi], i) => {
                  const cell = (a: number | null | undefined, b: number | null | undefined) =>
                    a === null || a === undefined ? "not reported" : a === b || b === null || b === undefined ? formatRate(a) : `${formatRate(a)} – ${formatRate(b)}`;
                  const p35 = td35?.points[i];
                  const p5 = td5?.points[i];
                  return (
                    <tr key={d} className="border-t border-border">
                      <td className="num py-1 pr-4">{formatDateIST(d)}</td>
                      <td className="num py-1 pr-4">{cell(lo, hi)}</td>
                      <td className="num py-1 pr-4">{cell(p35?.[1], p35?.[2])}</td>
                      <td className="num py-1 pr-4">{cell(p5?.[1], p5?.[2])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Source: RBI Handbook of Monetary Statistics of India, “Structure of Interest Rates”.</p>
        </details>
      </Section>

      <Section title="Savings account rate set by RBI (1977 to 2011)" description="RBI fixed the savings rate for all banks until 25 October 2011. After that, each bank sets its own — see the savings page.">
        <Card>
          <RateHistoryChart series={[{ key: "s", label: "Savings rate (RBI-prescribed)", color: "var(--accent)", points: (sav?.points ?? []).map(([d, r]) => ({ date: d, value: r })) }]} />
          <p className="mt-2 text-xs text-muted">Gaps: in 1977–78 RBI set two rates (with and without cheque facility), shown as a break. <Link href="/savings" className="text-accent hover:underline">Today&apos;s savings rates →</Link></p>
        </Card>
      </Section>

      <Section title="Policy rates" description="The Bank Rate since 1935 and the repo rate since 2008 — the anchors that deposit rates follow.">
        <Card>
          <RateHistoryChart
            series={[
              { key: "br", label: "Bank Rate", color: "#6d8fd8", points: withGaps((bank?.points ?? []).map(([d, v]) => ({ date: d, value: v })), bank?.notes) },
              { key: "repo", label: "Repo rate", color: "var(--accent)", points: (repo?.points ?? []).map(([d, v]) => ({ date: d, value: v })) },
            ]}
          />
          <p className="mt-2 text-xs text-muted">Bank Rate changes between November 2002 and December 2007 are missing from the sources used, so the line breaks there instead of guessing.</p>
        </Card>
      </Section>

      <Section title="Government bond yields" description="Weighted average yield on Central Government dated securities, by financial year.">
        <Card>
          <RateHistoryChart series={[{ key: "g", label: "G-sec yield", color: "#d9822b", step: false, points: (gsec?.points ?? []).map(([fy, v]) => ({ date: fyToDate(fy), value: v })) }]} />
        </Card>
      </Section>

      <Section title="Milestones in deposit-rate rules">
        <ol className="space-y-2 border-l border-border pl-4 text-sm">
          {milestones.map((m) => (
            <li key={`${m.date}-${m.title}`}>
              <span className="num mr-2 text-muted">{formatDateIST(m.date)}</span>
              {m.title}{" "}
              <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
                source
              </a>
            </li>
          ))}
        </ol>
      </Section>
      <Notice>Before 1970-71 no RBI table of prescribed deposit rates was found, so earlier years are not shown. Nothing on this page is estimated.</Notice>
    </div>
  );
}
