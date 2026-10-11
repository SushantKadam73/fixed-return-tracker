import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/ui";
import { TENURE_BUCKETS } from "@/lib/tenure";

export const metadata: Metadata = { title: "Methodology and sources", description: "How the Fixed Return Tracker collects, checks and presents deposit rates, scheme rates and inflation data." };

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Methodology & sources" lede="What we collect, where it comes from, how it is checked, and what the numbers do and do not mean." />
      <Section title="What is covered">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>44 banks in three RBI groups: SBI and nationalised banks, domestic private banks and small finance banks. Payments banks follow in a later release; regional rural, foreign and local area banks later still.</li>
          <li>Products: retail and bulk fixed deposits, recurring deposits and savings accounts, with every published condition — tenure, amount band, general/senior/super-senior rates, callable or non-callable, special tenures.</li>
          <li>Government schemes (PPF, SSY, SCSS, NSC, KVP, Post Office deposits, EPF, VPF, GPF, RBI Floating Rate Savings Bonds), NPS returns, inflation, policy rates and bond yields.</li>
        </ul>
      </Section>
      <Section title="Where the numbers come from">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Bank rates are read only from each bank&apos;s own official website (the RBI requires banks to pay exactly the schedule published there). Comparison sites are never used as data.</li>
          <li>Scheme rates: Ministry of Finance / Department of Economic Affairs notifications, National Savings Institute, India Post, EPFO, RBI press releases.</li>
          <li>Inflation: Labour Bureau CPI for Industrial Workers (from August 1968) and MoSPI CPI (Combined). Policy rates, gold prices, exchange rates and bond yields: RBI Handbook of Statistics. Income: NSO national accounts.</li>
          <li>Every figure links to its source and shows the date it applies from and the date we read it.</li>
        </ul>
      </Section>
      <Section title="How collection works">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Daily collection is scheduled for 06:17 IST; failed or overdue sources are retried at 12:43 IST. GitHub may delay scheduled runs.</li>
          <li>Each page is converted into a rate card and checked: plausible rates (0–15%), readable tenures, no half-read tables, no sudden jumps above 2 percentage points, senior rates not below general rates.</li>
          <li>A new card is stored only when rates actually change. If a read fails or looks wrong, the last good card stays and is marked stale after three days; the problem is logged on the <Link className="text-accent hover:underline" href="/status">status page</Link>.</li>
          <li>Current rates come from deterministic bank-specific parsers. Historical reconstructions and derived RD rates carry their source notes. Missing data is shown as “not reported”, never as zero.</li>
        </ul>
      </Section>
      <Section title="FD and RD sources"><p className="text-sm">HTML tables, linked PDFs and bank-owned JSON endpoints are read directly; registered JavaScript pages use a bounded browser. ICICI FD and RD use distinct JSON endpoints. SBI RD is derived from its term-deposit schedule using the recorded official relationship and RD tenure restrictions; this is not assumed for every bank. General, senior, amount, residency, withdrawal and payout conditions remain separate.</p></Section>
      <Section title="Dates and inflation"><p className="text-sm">RBI homepage readings are observations, not policy effective dates. Reverse repo and SDF are separate series. CPI Combined and CPI-IW use different baskets and bases; they are not silently spliced. Measured CPI is distinct from forecasts or a household’s personal inflation. Provisional observations can be revised, with earlier values retained in the revision log.</p></Section>
      <Section title="Downloads"><p className="text-sm"><Link className="text-accent" href="/data">CSV, JSON, checksums and change feeds</Link> use the exact committed revision accepted by the database import. Each artifact is checked against its SHA-256 checksum. Live cards can arrive before a publication finishes; downloads retain the last accepted release until that import succeeds.</p></Section>
      <Section title="History and evidence levels">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li><strong>1970s to 1997:</strong> RBI prescribed deposit rates for all banks. These appear as RBI-prescribed, fiscal-year-end rates that applied to every bank existing then. The savings rate was RBI-prescribed until 25 October 2011.</li>
          <li><strong>1997 to about 2008:</strong> bank-specific records are scarce; we use banks&apos; own archives and early web-archive copies of their rate pages where available.</li>
          <li><strong>About 2008 onwards:</strong> official bank archives (for example SBI and HDFC Bank) and web-archive copies of each bank&apos;s official page, usually monthly, so change dates may show as a range.</li>
          <li><strong>From launch:</strong> daily reads record observation dates; effective dates are taken from the bank when stated.</li>
          <li>Each historical figure carries a label: bank website, bank archive, web archive, RBI-prescribed, RBI data, or press report (secondary).</li>
        </ul>
      </Section>
      <Section title="The “normalise tenure” view">
        <p className="text-sm">
          Banks publish different slabs and special tenures. The normalised view groups every published slab into common buckets and shows the highest rate a bank publishes inside each bucket, with its exact tenure. If that rate needs one specific tenure (say, exactly 444 days), it is labelled. Nothing is interpolated. Buckets:{" "}
          {TENURE_BUCKETS.map((b) => b.label).join(", ")}.
        </p>
      </Section>
      <Section title="Calculations">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>FD: quarterly compounding for six months or more; simple interest for shorter deposits; monthly payouts at the discounted value (Indian Banks&apos; Association convention). RD: each instalment compounds quarterly for the time it stays invested.</li>
          <li>Savings estimates assume a steady balance and quarterly crediting. Unknown slab rules produce no estimate; credit timing and rounding must be confirmed with the bank.</li>
          <li>Real value: amount × index(later month) ÷ index(earlier month), using CPI-IW chained with the official linking factors 4.93 (1960→1982), 4.63 (1982→2001) and 2.88 (2001→2016).</li>
          <li>Banks round differently; always confirm with the bank&apos;s own calculator.</li>
        </ul>
      </Section>
      <Section title="What this site is not">
        <p className="text-sm">
          It describes published rates. It does not rank banks as “best”, does not give investment advice and is not registered with SEBI or RBI. Deposit insurance (DICGC) covers up to ₹5 lakh per depositor per bank, including interest; amounts above that carry the bank&apos;s own risk. Tax deducted at source and tax on interest depend on your situation and the Income-tax Act in force.
        </p>
      </Section>
    </div>
  );
}
