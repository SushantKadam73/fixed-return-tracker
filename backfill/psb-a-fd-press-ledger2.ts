/**
 * Second pass of dated press reports for the psb-a group (SBI, Bank of Baroda, Bank of India,
 * Bank of Maharashtra, Canara Bank, Central Bank of India, and merged predecessors Dena Bank and
 * Vijaya Bank), on top of `backfill/psb-a-fd-press.ts` (Ledger's first pass, not edited here --
 * this is a fresh file so the two passes never collide). Every card here is `sourceType: "press"`,
 * `confidence: "low"`, and only stores a row when the source itself prints a specific number for
 * it (see backfill/notes/psb-a.md for the per-article breakdown of what was left out and why).
 *
 * Staging only -- never the repo itself. The orchestrator reviews this staging output and merges
 * it into data/rates with backfill/merge-staged.ts.
 *
 * Run: npx tsx backfill/psb-a-fd-press-ledger2.ts
 */
import type { CustomerType, Product, RateCard, RateRow } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

// Staging only -- never the repo itself.
const STAGING_ROOT = "/agent/workspace/private/history-staging/Ledger2";

interface RowSpec {
  label: string;
  rate: number;
  customer?: CustomerType;
  schemeName?: string;
  special?: boolean;
}

interface CardSpec {
  bankSlug: string;
  product: Product;
  effectiveFrom: string;
  sourceUrl: string;
  amountMin?: number;
  amountMax?: number | null;
  rows: RowSpec[];
  notes: string[];
}

const CARDS: CardSpec[] = [
  // ---------------------------------------------------------------- SBI ----
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2004-11-29",
    sourceUrl: "https://www.rediff.com/business/report/sbi/20041127.htm",
    rows: [
      { label: "7 days to 14 days", rate: 3.0 },
      { label: "15 days to 45 days", rate: 4.0 },
      { label: "46 days to 179 days", rate: 4.5 },
      { label: "180 days to less than 1 year", rate: 5.0 },
      { label: "5 years and above", rate: 6.25 },
    ],
    notes: [
      "Rediff (PTI), 27 Nov 2004, \"SBI hikes home loan rates\": mainly a home-loan story, but states SBI \"raised interest rates on the domestic term deposits by 0.25 to 0.50 per cent across various maturities effective from November 29\", introducing a new 7-14 day bucket (3%) and a new 5-years-and-above bucket (6.25%, explicitly \"to raise long term funds to finance infrastructure projects\"), and prints 15-45 days (4%), 46-179 days (4.5%) and 180 days-<1yr (5%).",
      "The article also states rates on '1-3yr' and 'long-term deposits up to five years' were raised (by an unspecified amount for the former, by 0.50pp for the latter) but does not print either resulting number, so neither row is stored.",
    ],
  },
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2007-08-09",
    sourceUrl: "https://www.oneindia.com/2007/08/06/sbi-hikes-desposit-rates-for-maturity-of-3-to-10-years-1186407468.html",
    rows: [
      { label: "1 year to less than 2 years", rate: 8.0 },
      { label: "2 years to less than 3 years", rate: 8.25 },
      { label: "3 years to 10 years", rate: 8.5 },
      { label: "4 years to 5 years", rate: 9.25, schemeName: "Super Saver Term Deposit" },
      { label: "550 days", rate: 9.25, schemeName: "SBI Smart Deposit" },
    ],
    notes: [
      "Oneindia (UNI), 6 Aug 2007, \"SBI hikes deposit rates for maturity of 3 to 10 years\": SBI raised 3-10yr by 25bps to 8.50% (from 8.25%), cut 1yr-<2yr by 25bps to 8.00% (from 8.25%), and kept 2yr-<3yr unchanged at 8.25% (printed explicitly, not inferred). Also cut the 'Super Saver Term Deposit' scheme (4-5yr) and the 'SBI Smart Deposit' 550-day scheme by 25bps each, both to 9.25% (from 9.50%). Effective 9 Aug 2007 (the article, published 6 Aug 2007, states 'the revised rates will come into effect from August 9').",
      "The article also states senior citizens get +50bps on deposits of 1 year and above, but does not print the resulting senior rate, so no senior row is added.",
      "This sits in the same 2004-2007 stretch this project's notes log as otherwise silent for SBI FD; it does not fully close that gap, but narrows it by one more dated point roughly 4 months before the already-stored 2007-12-17 revision.",
    ],
  },

  // ---------------------------------------------------- Central Bank of India ----
  // All four cards below come from one union-association blog post (cboaapunit.blogspot.com,
  // 1 Dec 2010) that reproduces Central Bank of India's own rate circular verbatim, citing the
  // bank's own page (https://www.centralbankofindia.co.in/site/Interest.aspx) as its source --
  // not an aggregator's own rate-shopping table, but a secondary (blog) re-print of one bank's
  // own dated announcement, so stored as sourceType press/confidence low like every other press
  // card in this project, not bank_archive/web_archive (this pass did not independently confirm
  // the page via the Internet Archive -- see backfill/notes/psb-a.md).
  {
    bankSlug: "central-bank-of-india",
    product: "fd_bulk",
    effectiveFrom: "2010-08-09",
    sourceUrl: "http://cboaapunit.blogspot.com/2010/12/central-bank-of-india-revises-interest.html",
    amountMin: 10000000,
    amountMax: null,
    rows: [
      { label: "7 days to 14 days", rate: 4.0 },
      { label: "15 days to 45 days", rate: 5.0 },
      { label: "46 days to 90 days", rate: 5.5 },
      { label: "91 days to 179 days", rate: 6.0 },
      { label: "180 days to 269 days", rate: 6.25 },
      { label: "270 days to 364 days", rate: 6.5 },
      { label: "1 year to less than 2 years", rate: 7.0 },
      { label: "2 years to less than 3 years", rate: 7.0 },
      { label: "3 years to less than 5 years", rate: 7.0 },
      { label: "5 years to less than 7 years", rate: 7.0 },
      { label: "7 years and above", rate: 7.0 },
    ],
    notes: [
      "Central Bank Officers' Association (Andhra Pradesh) blog, posted 1 Dec 2010, reproducing the bank's own w.e.f. 09.12.2010 revision circular (source cited on the post itself: centralbankofindia.co.in/site/Interest.aspx). This is the circular's 'Rates For Deposits Rs. 1 Crore and above, Existing Rates w.e.f 09.08.10' column -- i.e. the bulk-deposit schedule that was still in force (unchanged by the Dec 2010 revision, which only touched the below-Rs-1-crore schedule) immediately before this revision. Stored as fd_bulk, amountMin Rs 1 crore.",
    ],
  },
  {
    bankSlug: "central-bank-of-india",
    product: "fd",
    effectiveFrom: "2010-11-08",
    sourceUrl: "http://cboaapunit.blogspot.com/2010/12/central-bank-of-india-revises-interest.html",
    amountMin: 0,
    amountMax: 10000000,
    rows: [
      { label: "7 days to 14 days", rate: 2.5 },
      { label: "15 days to 45 days", rate: 3.25 },
      { label: "46 days to 90 days", rate: 4.25 },
      { label: "91 days to 179 days", rate: 5.75 },
      { label: "180 days to 269 days", rate: 6.25 },
      { label: "270 days to 364 days", rate: 6.5 },
      { label: "1 year to less than 2 years", rate: 7.35 },
      { label: "2 years to less than 3 years", rate: 7.5 },
      { label: "3 years to less than 5 years", rate: 7.6 },
      { label: "5 years to less than 7 years", rate: 7.6 },
      { label: "7 years and above", rate: 7.85 },
    ],
    notes: [
      "Same blog/source as the fd_bulk card above: the circular's own 'Rates for Deposits up to less than Rs. One Crore, Existing Rates w.e.f 08.11.2010' column -- i.e. the schedule in force immediately before the 09.12.2010 revision below. Full 11-row table, below Rs 1 crore.",
    ],
  },
  {
    bankSlug: "central-bank-of-india",
    product: "fd",
    effectiveFrom: "2010-12-09",
    sourceUrl: "http://cboaapunit.blogspot.com/2010/12/central-bank-of-india-revises-interest.html",
    amountMin: 0,
    amountMax: 10000000,
    rows: [
      { label: "7 days to 14 days", rate: 2.5 },
      { label: "15 days to 45 days", rate: 5.0 },
      { label: "46 days to 90 days", rate: 5.75 },
      { label: "91 days to 179 days", rate: 6.5 },
      { label: "180 days to 269 days", rate: 8.0 },
      { label: "270 days to 364 days", rate: 8.0 },
      { label: "1 year to less than 2 years", rate: 8.25 },
      { label: "2 years to less than 3 years", rate: 8.25 },
      { label: "3 years to less than 5 years", rate: 8.5 },
      { label: "5 years to less than 7 years", rate: 8.6 },
      { label: "7 years and above", rate: 8.6 },
      { label: "555 days", rate: 8.55, schemeName: "Cent Super Plus" },
    ],
    notes: [
      "Same blog/source: the circular's own 'Revised Rates w.e.f 09.12.2010' column, below Rs 1 crore -- the revision itself. Increases of 0.75-1.75pp across buckets versus the 08.11.2010 card above (the blog post's own headline figure). The 555-day 'Cent Super Plus' scheme rate (8.55%, up from 8.00%) is also explicitly dated to this same 09.12.2010 revision and stated to run only until 31 Dec 2010; the prior 8.00% rate is mentioned by the same source but without its own explicit date, so only the dated 8.55% figure is stored (not the undated 8.00%).",
    ],
  },
  {
    bankSlug: "central-bank-of-india",
    product: "fd",
    effectiveFrom: "2011-04-01",
    sourceUrl: "https://economictimes.indiatimes.com/wealth/personal-finance-news/central-bank-of-india-slashes-fixed-deposit-rates-by-up-to-1/articleshow/7866188.cms",
    amountMin: 0,
    amountMax: 10000000,
    rows: [
      { label: "91 days to 179 days", rate: 7.0 },
      { label: "180 days to 364 days", rate: 8.5 },
      { label: "1 year to less than 2 years", rate: 9.0 },
      { label: "555 days", rate: 9.25, schemeName: "Cent Super Plus" },
    ],
    notes: [
      "Economic Times (PTI), 4 Apr 2011, \"Central Bank of India slashes fixed deposit rates by up to 1%\": cuts of 25-100bps on select maturities, effective 1 Apr 2011 (the bank 'had last raised fixed deposit rates in the first week of March' 2011, so the 'earlier' rates quoted in the article are from that intervening March revision, not the 09.12.2010 card above -- the two cards are not adjacent revisions of each other). The 180-364 day bucket appears merged here versus the 180-269/270-364 split used in the Dec 2010 circular; stored exactly as the article's own bucket, not split.",
    ],
  },
  {
    bankSlug: "central-bank-of-india",
    product: "fd",
    effectiveFrom: "2012-03-12",
    sourceUrl: "https://www.thehindubusinessline.com/money-and-banking/central-bank-of-india-hikes-short-term-rates/article23063073.ece",
    amountMin: 0,
    amountMax: 10000000,
    rows: [
      { label: "7 days to 14 days", rate: 9.0 },
      { label: "15 days to 45 days", rate: 9.0 },
      { label: "46 days to 90 days", rate: 9.0 },
    ],
    notes: [
      "The Hindu Business Line, 10 Mar 2012, \"Central Bank of India hikes short-term rates\": a sharp short-end-only hike (7-14 days from 2.5% to 9%, 15-45 days from 5% to 9%, 46-90 days from 5.25% to 9%) 'to attract funds from depositors' amid a system-wide liquidity crunch, effective 12 Mar 2012. The article covers only these three short tenors; longer tenors are not mentioned and are not stored.",
    ],
  },

  // -------------------------------------------------------------- Dena Bank ----
  {
    bankSlug: "dena-bank",
    product: "fd",
    effectiveFrom: "2003-06-05",
    sourceUrl: "https://zeenews.india.com/home/dena-bank-to-cut-interest-rate-on-domestic-deposits-by-025-pc_102321.html",
    rows: [
      { label: "91 days to 179 days", rate: 5.25 },
      { label: "180 days to less than 1 year", rate: 5.5 },
      { label: "1 year to less than 3 years", rate: 6.0 },
      { label: "3 years and above", rate: 6.25 },
    ],
    notes: [
      "Zee News (Bureau), 2 Jun 2003, \"Dena Bank to cut interest rate on domestic deposits by 0.25 pc\": cut of 0.25pp on maturities of 91 days and above, effective 5 Jun 2003. Explicitly states no change to other (shorter) maturity periods, so only these four rows are stored. This is Dena Bank's first card in this dataset.",
    ],
  },
  {
    bankSlug: "dena-bank",
    product: "fd",
    effectiveFrom: "2012-12-22",
    sourceUrl: "https://www.thehindubusinessline.com/money-and-banking/dena-bank-hikes-term-deposit-rates-by-35-bps-on-1-2-yr-tenor/article23094748.ece",
    rows: [{ label: "1 year to less than 2 years", rate: 9.1 }],
    notes: [
      "The Hindu Business Line, 24 Dec 2012, \"Dena Bank hikes term deposit rates by 35 bps on 1-2 yr tenor\": 1yr-<2yr raised 35bps to 9.10% (from 8.75%), effective 22 Dec 2012. Only this one tenor is given.",
    ],
  },
  {
    bankSlug: "dena-bank",
    product: "fd",
    effectiveFrom: "2016-11-21",
    sourceUrl: "https://www.business-standard.com/article/pti-stories/dena-bank-cuts-deposit-rates-by-up-to-50-basis-points-116112101086_1.html",
    rows: [
      { label: "180 days to 270 days", rate: 6.5 },
      { label: "271 days to less than 2 years", rate: 7.0 },
    ],
    notes: [
      "Business Standard (PTI), 21 Nov 2016, \"Dena Bank cuts deposit rates by up to 50 basis points\": 180-270 days cut 50bps to 6.50% (from 7.00%), 271 days-<2yr cut 25bps to 7.00% (from 7.25%), both effective the article's own publication date (21 Nov 2016, 'with effect from today'). Only these two buckets are given.",
    ],
  },

  // ------------------------------------------------------------ Vijaya Bank ----
  {
    bankSlug: "vijaya-bank",
    product: "fd",
    effectiveFrom: "2012-04-01",
    sourceUrl: "https://www.thehindubusinessline.com/money-and-banking/vijaya-bank-hikes-domestic-nre-term-deposit-rates/article23065307.ece",
    amountMin: 0,
    amountMax: 50000000,
    rows: [
      { label: "180 days to less than 1 year", rate: 8.5 },
      { label: "1 year to less than 2 years", rate: 9.6 },
      { label: "2 years to less than 3 years", rate: 9.5 },
      { label: "3 years to less than 5 years", rate: 9.3 },
      { label: "5 years and above", rate: 9.25 },
    ],
    notes: [
      "The Hindu Business Line, 3 Apr 2012, \"Vijaya Bank hikes domestic, NRE term deposit rates\": domestic term-deposit rates below Rs 5 crore, effective 1 Apr 2012. The article states the 1yr-<2yr/2yr-<3yr/3yr-<5yr/5yr+ rates apply equally to NRE deposits (an nre card is not stored here, per this pass's fd-first priority, but the article is a ready-made lead for one). The article also states senior citizens get +50bps across categories, but does not print the resulting senior numbers, so no senior row is added. This is Vijaya Bank's first domestic fd card in this dataset.",
    ],
  },
  {
    bankSlug: "vijaya-bank",
    product: "fd",
    effectiveFrom: "2014-10-20",
    sourceUrl: "https://www.thehindu.com/business/vijaya-bank-to-cut-interest-on-special-term-deposit-scheme/article6514880.ece",
    rows: [{ label: "444 days", rate: 9.05, schemeName: "Vijaya 444" }],
    notes: [
      "The Hindu, 18 Oct 2014, \"Vijaya Bank to cut interest on special term deposit scheme\": the bank's named 'Vijaya 444' scheme (444-day tenor) cut to 9.05% from 9.15%, effective 20 Oct 2014.",
    ],
  },
  {
    bankSlug: "vijaya-bank",
    product: "fd",
    effectiveFrom: "2016-04-12",
    sourceUrl: "https://www.business-standard.com/article/pti-stories/vijaya-bank-cuts-term-deposit-interest-rates-by-25-bps-116041200414_1.html",
    rows: [{ label: "1 year", rate: 7.5 }],
    notes: [
      "Business Standard (PTI), 12 Apr 2016, \"Vijaya Bank cuts term deposit interest rates by 25 bps\": a 25bps cut 'applicable for term deposits of different slabs from 91 days to above five years maturity', effective 12 Apr 2016, but the article only prints the resulting number for one tenor: 'attractive rate of interest of 7.50% on deposits of one year maturity' (down from 7.75%, per the article's own point-change framing). Only this one row is stored.",
    ],
  },
];

function toRateRow(spec: RowSpec, amountMin: number, amountMax: number | null): RateRow | null {
  const tenure = parseTenure(spec.label);
  if (!tenure) return null;
  return {
    tenureMinDays: tenure.minDays,
    tenureMaxDays: tenure.maxDays,
    tenureLabel: spec.label,
    special: spec.special ?? (tenure.point && tenure.minDays % 365 !== 0 ? true : undefined),
    schemeName: spec.schemeName,
    amountMin,
    amountMax,
    customer: spec.customer ?? "general",
    residency: "resident",
    callable: null,
    payout: null,
    rate: spec.rate,
  };
}

function main() {
  const today = todayIST();
  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  const rejectedDetails: string[] = [];

  for (const spec of CARDS) {
    const amountMin = spec.amountMin ?? 0;
    const amountMax = spec.amountMax ?? null;
    const rows: RateRow[] = [];
    for (const r of spec.rows) {
      const row = toRateRow(r, amountMin, amountMax);
      if (!row) {
        console.log(`SKIP row (${spec.bankSlug} ${spec.product} ${spec.effectiveFrom}): unreadable tenure "${r.label}"`);
        continue;
      }
      rows.push(row);
    }
    if (rows.length === 0) {
      console.log(`SKIP card (${spec.bankSlug} ${spec.product} ${spec.effectiveFrom}): no readable rows`);
      continue;
    }
    const card: RateCard = {
      bankSlug: spec.bankSlug,
      product: spec.product,
      effectiveFrom: spec.effectiveFrom,
      observedAt: today,
      sourceType: "press",
      sourceUrl: spec.sourceUrl,
      confidence: "low",
      rows,
      notes: spec.notes,
    };
    const result = storeHistoricalCard(STAGING_ROOT, card);
    if (result.outcome === "inserted") inserted++;
    else if (result.outcome === "unchanged") unchanged++;
    else {
      rejected++;
      rejectedDetails.push(`${spec.bankSlug} ${spec.product} ${spec.effectiveFrom}: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  console.log("\n=== psb-a press FD/bulk backfill summary (Ledger2 pass) ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
