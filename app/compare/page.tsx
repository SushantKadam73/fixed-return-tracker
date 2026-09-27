import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Section } from "@/components/ui";
import { realRate } from "@/lib/calc/deposits";
import { getSummary } from "@/lib/data";
import type { RateRow } from "@/lib/domain";
import { formatRate } from "@/lib/format";
import { SHORT_NAMES, getSchemes, schemeStatus } from "@/lib/schemes";
import { getSeries } from "@/lib/series";
import { rateForTenure } from "@/lib/tenure";

export const metadata: Metadata = {
  title: "Compare fixed-return options — bank FDs, PPF, SSY, SCSS, NSC, EPF and more",
  description: "Side-by-side view of India's fixed-return options: current rates, lock-in, liquidity, backing and the real return after inflation.",
};

type Entry = { rows: RateRow[] };

/** Facts about each option that do not change often; each links to its detail page with sources. */
const FACTS: Record<string, { tenure: string; liquidity: string; backing: string; payout: string }> = {
  ppf: { tenure: "15 years (extendable in 5-year blocks)", liquidity: "Partial withdrawal from year 7; loan from year 3", backing: "Government of India", payout: "Compounded yearly, paid at maturity" },
  ssy: { tenure: "21 years from opening (deposits for 15)", liquidity: "Partial withdrawal for education at 18", backing: "Government of India", payout: "Compounded yearly" },
  scss: { tenure: "5 years (extendable by 3)", liquidity: "Premature closure with penalty", backing: "Government of India", payout: "Paid every quarter" },
  nsc: { tenure: "5 years", liquidity: "Locked in except in special cases", backing: "Government of India", payout: "Compounded yearly, paid at maturity" },
  kvp: { tenure: "Until the money doubles", liquidity: "Encashment after 2½ years", backing: "Government of India", payout: "Paid at maturity" },
  pomis: { tenure: "5 years", liquidity: "Premature closure after 1 year with penalty", backing: "Government of India", payout: "Paid every month" },
  po_td_1y: { tenure: "1 year", liquidity: "Premature closure after 6 months", backing: "Government of India", payout: "Quarterly compounding, yearly payout" },
  po_td_5y: { tenure: "5 years", liquidity: "Premature closure after 6 months", backing: "Government of India", payout: "Quarterly compounding, yearly payout" },
  po_rd: { tenure: "5 years", liquidity: "Premature closure after 3 years", backing: "Government of India", payout: "Quarterly compounding" },
  epf: { tenure: "Until retirement / leaving employment", liquidity: "Partial withdrawals for specific needs", backing: "Statutory fund (EPFO)", payout: "Credited yearly" },
  frsb_2020: { tenure: "7 years", liquidity: "Premature redemption only for senior citizens", backing: "Government of India (RBI bond)", payout: "Paid every six months; rate resets" },
};

export default async function ComparePage() {
  const [schemes, fd, cpi] = await Promise.all([getSchemes(), getSummary<{ banks: Record<string, Entry> }>("current:fd"), getSeries<[string, number, number]>("cpi_iw_chained")]);
  const pts = cpi?.points ?? [];
  const last = pts.at(-1);
  const prev = last ? pts.find((p) => p[0] === `${Number(last[0].slice(0, 4)) - 1}${last[0].slice(4)}`) : undefined;
  const inflation = last && prev ? (last[1] / prev[1] - 1) * 100 : null;

  const bankRange = (days: number) => {
    const rates = Object.values(fd?.payload?.banks ?? {})
      .map((e) => rateForTenure(e.rows.filter((r) => r.residency === "resident"), days, { amount: 1_00_000, customer: "general", callable: true })?.rate)
      .filter((x): x is number => typeof x === "number")
      .sort((a, b) => a - b);
    return rates.length ? { min: rates[0], max: rates[rates.length - 1], n: rates.length } : null;
  };
  const fd1 = bankRange(365);
  const fd5 = bankRange(1825);

  const rows = Object.keys(FACTS)
    .map((key) => {
      const s = schemes.find((x) => x.key === key);
      if (!s) return null;
      const st = schemeStatus(s);
      const rate = st.kind === "current" ? st.rate : st.kind === "awaiting" ? st.lastRate : null;
      return { key, name: SHORT_NAMES[key] ?? s.name, rate, ...FACTS[key] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div>
      <PageHeader
        title="Compare fixed-return options"
        lede="Current rates side by side with what matters beyond the headline: how long money is locked, how easily you can get it out, who backs it, and what is left after inflation."
      />
      <Section title="Rates and features" description={`Real return = rate adjusted for the latest year-on-year CPI-IW inflation${inflation !== null ? ` (${formatRate(inflation)}, ${last?.[0]})` : ""}.`}>
        <div className="scroll-x rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Option</th>
                <th className="px-4 py-2 font-medium">Rate</th>
                <th className="px-4 py-2 font-medium">Real return</th>
                <th className="px-4 py-2 font-medium">Tenure</th>
                <th className="px-4 py-2 font-medium">Getting money out</th>
                <th className="px-4 py-2 font-medium">Backed by</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "fd1", name: "Bank FD · 1 year", range: fd1, tenure: "1 year", liquidity: "Premature withdrawal usually allowed with a penalty", backing: "Issuing bank; DICGC insures up to ₹5 lakh per depositor per bank" },
                { key: "fd5", name: "Bank FD · 5 years", range: fd5, tenure: "5 years", liquidity: "Premature withdrawal usually allowed (not for tax-saver FDs)", backing: "Issuing bank; DICGC insures up to ₹5 lakh per depositor per bank" },
              ].map((b) => (
                <tr key={b.key} className="border-t border-border align-top">
                  <td className="px-4 py-2.5">
                    <Link href="/deposits" className="font-medium hover:text-accent">{b.name}</Link>
                    <p className="text-xs text-muted">{b.range ? `across ${b.range.n} tracked banks` : "collecting"}</p>
                  </td>
                  <td className="num px-4 py-2.5">{b.range ? `${formatRate(b.range.min)} – ${formatRate(b.range.max)}` : "not reported"}</td>
                  <td className="num px-4 py-2.5">{b.range && inflation !== null ? `${formatRate(realRate(b.range.min, inflation))} – ${formatRate(realRate(b.range.max, inflation))}` : "—"}</td>
                  <td className="px-4 py-2.5">{b.tenure}</td>
                  <td className="px-4 py-2.5 text-muted">{b.liquidity}</td>
                  <td className="px-4 py-2.5 text-muted">{b.backing}</td>
                </tr>
              ))}
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border align-top">
                  <td className="px-4 py-2.5">
                    <Link href={`/schemes/${r.key}`} className="font-medium hover:text-accent">{r.name}</Link>
                    <p className="text-xs text-muted">{r.payout}</p>
                  </td>
                  <td className="num px-4 py-2.5">{formatRate(r.rate)}</td>
                  <td className="num px-4 py-2.5">{r.rate !== null && inflation !== null ? formatRate(realRate(r.rate, inflation)) : "—"}</td>
                  <td className="px-4 py-2.5">{r.tenure}</td>
                  <td className="px-4 py-2.5 text-muted">{r.liquidity}</td>
                  <td className="px-4 py-2.5 text-muted">{r.backing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Notice>
        Tax treatment differs by option and by the tax regime you choose; see each scheme page and the Income-tax Act in force. Features summarise current scheme rules — always read the official terms. This comparison describes options; it does not recommend one.
      </Notice>
    </div>
  );
}
