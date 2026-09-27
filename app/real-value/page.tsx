import type { Metadata } from "next";
import { RateHistoryChart } from "@/components/charts/rate-history-chart";
import { RealValueCalculator } from "@/components/real-value/real-value-calculator";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { getSchemes } from "@/lib/schemes";
import { getSeries } from "@/lib/series";

export const metadata: Metadata = {
  title: "Real value of money in India — inflation calculator since 1968",
  description: "What any rupee amount from 1968 onwards is worth today, what it could buy in gold, how many years of average income it represented, and real interest rates over time.",
};

type P = [string, number];

/** Year-on-year inflation from a monthly index (no filling of missing months). */
function yoy(points: Array<[string, number, number?]>): Array<{ date: string; value: number | null }> {
  const byMonth = new Map(points.map((p) => [p[0], p[1]]));
  return points.map(([m, v]) => {
    const [y, mm] = m.split("-").map(Number);
    const prev = byMonth.get(`${y - 1}-${String(mm).padStart(2, "0")}`);
    return { date: `${m}-01`, value: prev ? Math.round(((v / prev - 1) * 100) * 100) / 100 : null };
  });
}

export default async function RealValuePage() {
  const [cpi, gold, income, usd, td13] = await Promise.all([
    getSeries<[string, number, number]>("cpi_iw_chained"),
    getSeries<P>("gold_mumbai_annual"),
    getSeries<P>("percapita_nni_annual"),
    getSeries<P>("usdinr_annual"),
    getSeries<[string, number | null, number | null, string]>("rbi_td_1_3y"),
  ]);
  const schemes = await getSchemes();
  const ppf = schemes.find((s) => s.key === "ppf");

  if (!cpi) return <Notice tone="warning">Inflation data is not available right now.</Notice>;
  const inflation = yoy(cpi.points);
  const ppfPoints = (ppf?.periods ?? [])
    .filter((p) => p.from >= "1968-01-01")
    .flatMap((p) => [{ date: p.from, value: p.rate }]);
  const tdPoints = (td13?.points ?? []).map(([date, , max]) => ({ date, value: max }));

  return (
    <div>
      <PageHeader
        title="What is money really worth?"
        lede="Rupee amounts lose buying power every year. See what an amount from any month since August 1968 is worth today — and what it felt like then, in gold, in years of average income and in US dollars."
      />
      <Section title="Inflation calculator" description="Based on the Consumer Price Index for Industrial Workers (Labour Bureau), chained across its 1960, 1982, 2001 and 2016 bases with the official linking factors.">
        <Card>
          <RealValueCalculator data={{ cpi: cpi.points.map(([d, v]) => [d, v] as P), gold: gold?.points ?? [], income: income?.points ?? [], usd: usd?.points ?? [] }} />
        </Card>
      </Section>
      <Section
        title="Inflation versus fixed returns"
        description="Yearly inflation (CPI-IW) against the PPF rate and, for the regulated era, the upper end of the RBI-prescribed 1–3 year bank deposit rate. When inflation is above the rate, the real return is negative."
      >
        <Card>
          <RateHistoryChart
            height={340}
            series={[
              { key: "inf", label: "Inflation (CPI-IW, year on year)", color: "#d9822b", step: false, points: inflation },
              { key: "ppf", label: "PPF rate", color: "var(--accent)", points: ppfPoints },
              { key: "td", label: "Bank deposit 1–3 yr (RBI-prescribed, upper end)", color: "#6d8fd8", dashed: true, points: tdPoints },
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            RBI-prescribed deposit rates are fiscal-year-end snapshots (1970-71 to 1997-98); bank-specific rates after deregulation are on each bank&apos;s page.
          </p>
        </Card>
      </Section>
      <Notice>
        Sources: Labour Bureau CPI-IW (linking factors 4.93, 4.63, 2.88), RBI Handbook of Statistics (gold price, exchange rate), NSO per-capita net national income, National Savings Institute (PPF).
        Gold prices and income are fiscal-year averages, so the “then” figures describe a typical point in that year.
      </Notice>
    </div>
  );
}
