/**
 * Dated press reports of rate revisions for SBI, Bank of Baroda, Bank of India, Bank of
 * Maharashtra, Canara Bank, Central Bank of India and Syndicate Bank (a merged-into-Canara
 * predecessor), covering the
 * 1997-2008 stretch the web archive and the banks' own downloadable archives mostly don't
 * reach. Every card here is `sourceType: "press"`, `confidence: "low"` -- a secondary source,
 * used only where the article itself states a specific date and specific rate(s). Two rules
 * applied consistently to every card in this file (see backfill/notes/psb-a.md for the full
 * per-article breakdown):
 *
 *  1. A row is only stored when the article prints an actual number for it. Several articles
 *     also describe a blanket move ("rates on all other deposits were cut by 50bps", "revised
 *     downwards", "brought down by 40-75bps") without printing the resulting rate for every
 *     bucket -- those unprinted buckets are left out rather than computed by subtracting from a
 *     rate quoted in a *different* article, which would be exactly the cross-source
 *     interpolation this project's rules forbid.
 *  2. A senior-citizen row is only stored when the article prints the resulting senior rate
 *     itself (e.g. "6 per cent, 6.25 per cent and 6.5 per cent" for senior citizens). Where an
 *     article states only the *rule* ("a differential of 50 basis points over the general
 *     rate") without printing the resulting number, no senior row is added -- the rule itself is
 *     recorded in the card's notes instead.
 *
 * `callable`/`payout` are left `null` (not stated) throughout: press coverage of a rate change
 * never restates a bank's premature-withdrawal or payout terms, unlike the banks' own archived
 * tables (contrast with sbi-fd-archive.ts, which sets `callable: true` because SBI's own
 * historical workbook is specifically about its ordinary callable retail product).
 *
 * Run: npx tsx backfill/psb-a-fd-press.ts
 */
import type { CustomerType, Product, RateCard, RateRow } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

// Staging only -- never the repo itself. The orchestrator reviews this staging output and
// merges it into data/rates with backfill/merge-staged.ts.
const STAGING_ROOT = "/agent/workspace/private/history-staging/Ledger";

interface RowSpec {
  label: string;
  rate: number;
  customer?: CustomerType;
  schemeName?: string;
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
    effectiveFrom: "2003-01-13",
    sourceUrl: "https://im.rediff.com/money/2003/jan/09sbi.htm",
    rows: [
      { label: "1 year to less than 2 years", rate: 5.75 },
      { label: "2 years to less than 3 years", rate: 6.0 },
      { label: "3 years and above", rate: 6.25 },
    ],
    notes: [
      "Rediff (PTI), 9 Jan 2003, \"SBI cuts rates for longer end deposits\": SBI cut rates 25bps on the maturities above, effective 13 Jan 2003.",
      "The article also states short tenors (7-14, 15-45, 46-179 days, 180 days to less than 1 year) and NRE deposits were left unchanged, but does not print their rate, so they are not stored here.",
      "The article states senior citizens (deposits of 1 year and above) get a differential of 50 basis points over the applicable general rate, but does not print the resulting senior rate itself, so no senior row is added.",
    ],
  },
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2003-05-05",
    sourceUrl: "https://im.rediff.com/money/2003/may/05bob.htm",
    rows: [
      { label: "7 days to 14 days", rate: 4.0 },
      { label: "1 year to less than 2 years", rate: 5.5 },
      { label: "2 years to less than 3 years", rate: 5.75 },
      { label: "3 years and above", rate: 6.0 },
      { label: "1 year to less than 2 years", rate: 6.0, customer: "senior" },
      { label: "2 years to less than 3 years", rate: 6.25, customer: "senior" },
      { label: "3 years and above", rate: 6.5, customer: "senior" },
    ],
    notes: [
      "Rediff (Reuters), 5 May 2003, \"Bank of Baroda to cut lending rate by 25 bps\": reports SBI cut lending and domestic deposit rates by 0.25pp 'with effect from Monday' (5 May 2003), giving the 7-14 day and 1yr+ rows above plus explicit senior-citizen rates for the three 1yr+ buckets.",
    ],
  },
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2003-11-10",
    sourceUrl: "https://www.rediff.com/business/report/sbi/20031108.htm?print=true",
    rows: [
      { label: "7 days to 14 days", rate: 4.0 },
      { label: "15 days to 45 days", rate: 4.0 },
      { label: "3 years and above", rate: 5.5 },
    ],
    notes: [
      "Rediff, 8 Nov 2003, \"SBI to cut deposit rates\": 7-14 days continues unchanged at 4%; 15-45 days cut 25bps to 4%; 'rates on all other deposits' (unspecified buckets) cut 50bps, with only the 3-years-and-above result (5.5%, from 6%) printed. Effective 10 Nov 2003.",
      "The article notes SBI had last revised rates on 5 May 2003 (matches the card above) and had not followed an August repo-rate cut before this revision.",
    ],
  },
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2004-01-01",
    sourceUrl: "http://im.rediff.com/money/2003/dec/29sbi.htm?zcc=rl",
    rows: [
      { label: "15 days to 45 days", rate: 4.0 },
      { label: "46 days to 179 days", rate: 4.5 },
      { label: "180 days to less than 1 year", rate: 4.75 },
      { label: "1 year to less than 3 years", rate: 5.0 },
      { label: "3 years and above", rate: 5.25 },
    ],
    notes: [
      "Rediff (PTI), 29 Dec 2003, \"SBI fixes BPLR, cuts rate on term deposits\", effective 1 Jan 2004. The article's lead sentence frames the 0.25pp cut as applying to '2 years to less than 3 years and 3 years and above' specifically, but its own numbers sentence states the revised rate for '1 year to less than 3 years' is 5% and for '3 years and above' is 5.25% -- i.e. the 1-2yr and 2-3yr buckets read as having been merged into one 1-3yr bucket by this point. The numbers sentence (quoted verbatim as the tenureLabel here) is what is stored; the apparent bucket-count inconsistency in the article's own framing is flagged here, not resolved.",
    ],
  },
  {
    bankSlug: "sbi",
    product: "fd",
    effectiveFrom: "2007-12-17",
    sourceUrl: "https://timesofindia.indiatimes.com/business/india-business/sbi-cuts-deposit-rates-by-0-25/articleshow/2618111.cms",
    rows: [
      { label: "15 days to 45 days", rate: 4.75 },
      { label: "46 days to 270 days", rate: 5.25 },
      { label: "271 days to less than 1 year", rate: 6.5 },
      { label: "2 years to less than 3 years", rate: 8.25 },
      { label: "3 years to 10 years", rate: 8.5 },
    ],
    notes: [
      "Times of India (TNN), 13 Dec 2007, \"SBI cuts deposit rates by 0.25%\", effective 17 Dec 2007. 2-3yr and 3-10yr rates were retained (not cut) at the values printed.",
      "SUSPICIOUS SOURCE DATA, reported not fixed: the article's own text is internally inconsistent for the 1-year-plus short buckets -- it says most maturities were cut 0.25% 'except a period of one year to 549 days, where it hiked rates by an identical amount', then separately states 'term deposit in between one year-550 days would come down to 8.5%' AND 'One year-549 days fixed deposit rate would rise by 0.25% to 8.25%' for what read like two overlapping-but-different tenor buckets. Neither of these two rows is stored here; only the unambiguous rows above are.",
    ],
  },

  // ------------------------------------------------------- Bank of Baroda ----
  {
    bankSlug: "bank-of-baroda",
    product: "fd",
    effectiveFrom: "2002-07-23",
    sourceUrl: "https://www.business-standard.com/article/finance/boi-bob-cut-deposit-rates-102072501041_1.html",
    rows: [
      { label: "15 days to 45 days", rate: 5.25 },
      { label: "46 days to 90 days", rate: 5.5 },
      { label: "91 days to 180 days", rate: 6.0 },
      { label: "181 days to less than 1 year", rate: 6.5 },
      { label: "1 year to 2 years", rate: 7.0 },
      { label: "2 years to 3 years", rate: 7.25 },
      { label: "3 years and above", rate: 7.5 },
    ],
    notes: [
      "Business Standard, first published 25 Jul 2002 (dateline reports the cut as already effective 23 Jul 2002 for BoB), \"Boi, Bob Cut Deposit Rates\": BoB pared rates 25-50bps across all buckets except 181 days-<1yr (unchanged, printed as such).",
    ],
  },
  {
    bankSlug: "bank-of-baroda",
    product: "fd",
    effectiveFrom: "2003-03-10",
    sourceUrl: "https://timesofindia.indiatimes.com/business/india-business/bank-of-baroda-cuts-deposit-rates-by-0-25-0-75-pc/articleshow/39253200.cms",
    amountMin: 0,
    amountMax: 1500000,
    rows: [
      { label: "15 days to 45 days", rate: 4.5 },
      { label: "46 days to 90 days", rate: 4.75 },
      { label: "91 days to 180 days", rate: 5.0 },
      { label: "181 days to 1 year", rate: 5.0 },
      { label: "1 year to 3 years", rate: 5.25 },
      { label: "3 years and above", rate: 5.5 },
    ],
    notes: [
      "Times of India (PTI), 4 Mar 2003, \"Bank of Baroda cuts deposit rates by 0.25-0.75 pc\", effective 10 Mar 2003, for deposits up to Rs 15 lakh. The article states deposits of Rs 15 lakh and above get the same buckets at +0.25pp, but does not print those resulting rates, so no separate >=15L row is added.",
    ],
  },
  {
    bankSlug: "bank-of-baroda",
    product: "fd",
    effectiveFrom: "2004-11-16",
    sourceUrl: "https://im.rediff.com/money/2004/nov/11perfin2.htm",
    amountMin: 0,
    amountMax: 1500000,
    rows: [
      { label: "7 days to 14 days", rate: 3.25 },
      { label: "15 days to 45 days", rate: 4.25 },
      { label: "46 days to 90 days", rate: 4.5 },
      { label: "91 days to 180 days", rate: 4.75 },
      { label: "181 days to less than 1 year", rate: 5.0 },
      { label: "1 year to less than 2 years", rate: 5.25 },
      { label: "2 years to less than 3 years", rate: 5.5 },
      { label: "3 years and above", rate: 5.75 },
    ],
    notes: [
      "Rediff (BS Banking Bureau), 11 Nov 2004, \"More banks hike deposit rates\", effective 16 Nov 2004, for deposits up to Rs 15 lakh (explicitly stated).",
    ],
  },

  // -------------------------------------------------------- Bank of India ----
  {
    bankSlug: "bank-of-india",
    product: "fd",
    effectiveFrom: "2002-08-01",
    sourceUrl: "https://www.business-standard.com/article/finance/boi-bob-cut-deposit-rates-102072501041_1.html",
    rows: [
      { label: "15 days to 45 days", rate: 5.0 },
      { label: "46 days to 90 days", rate: 5.6 },
      { label: "91 days to 179 days", rate: 5.75 },
      { label: "180 days to less than 1 year", rate: 5.75 },
      { label: "1 year to 2 years", rate: 7.25 },
      { label: "2 years to 3 years", rate: 7.5 },
      { label: "3 years to 5 years", rate: 8.0 },
      { label: "5 years and above", rate: 8.25 },
    ],
    notes: [
      "Business Standard, first published 25 Jul 2002 (BoI's own cut effective 1 Aug 2002 per the article), \"Boi, Bob Cut Deposit Rates\": BoI cut 40-75bps on 3 short-end buckets; the article's own full-table sentence also gives the 15-45 day and 1yr+ buckets, taken here as the resulting schedule from 1 Aug 2002.",
    ],
  },
  {
    bankSlug: "bank-of-india",
    product: "fd",
    effectiveFrom: "2004-11-10",
    sourceUrl: "https://im.rediff.com/money/2004/nov/11perfin2.htm",
    rows: [
      { label: "7 days to 14 days", rate: 3.5 },
      { label: "15 days to 45 days", rate: 4.5 },
      { label: "46 days to 364 days", rate: 5.0 },
      { label: "1 year to less than 2 years", rate: 5.25 },
      { label: "2 years to less than 3 years", rate: 5.25 },
      { label: "3 years to less than 5 years", rate: 5.5 },
      { label: "5 years and above", rate: 5.75 },
    ],
    notes: [
      "Rediff (BS Banking Bureau), 11 Nov 2004, \"More banks hike deposit rates\": BoI raised rates 'across the board from Wednesday' (article published Thursday 11 Nov 2004, so 'Wednesday' = 10 Nov 2004). The former separate 46-179/180-364 day buckets (4.50%/4.75%) were merged into one 46-364 day bucket at 5.00% per this article; 2yr-<3yr is printed as unchanged at 5.25%.",
    ],
  },
  {
    bankSlug: "bank-of-india",
    product: "fd",
    effectiveFrom: "2007-08-01",
    sourceUrl: "https://www.financialexpress.com/archive/boi-canara-syndicate-cut-interest-on-deposits/207832/",
    rows: [{ label: "1 year", rate: 9.0 }],
    notes: [
      "Financial Express (Banking Bureau), 1 Aug 2007, \"BoI, Canara, Syndicate cut interest on deposits\": BoI's one-year deposit rate cut 50bps to 9% (from 9.5%) with immediate effect, responding to that quarter's RBI policy review. Only this one tenor is given for BoI in the article.",
    ],
  },

  // ------------------------------------------------------------ Canara Bank ----
  {
    bankSlug: "canara-bank",
    product: "fd",
    effectiveFrom: "2007-08-01",
    sourceUrl: "https://www.financialexpress.com/archive/boi-canara-syndicate-cut-interest-on-deposits/207832/",
    rows: [{ label: "1 year", rate: 9.0, schemeName: "Canara Centenary Deposit Scheme" }],
    notes: [
      "Financial Express, 1 Aug 2007 (same article as the Bank of India card above): Canara Bank cut the rate on its named 'Canara Centenary Deposit Scheme' (1-year maturity) by 50bps to 9% (from 9.5%), immediate effect. This is a named scheme rate, not necessarily Canara's general card rate for 1 year -- stored with schemeName set accordingly.",
    ],
  },
  {
    bankSlug: "canara-bank",
    product: "fd_bulk",
    effectiveFrom: "2013-12-03",
    sourceUrl: "https://www.business-standard.com/article/finance/canara-bank-cuts-term-deposit-rates-113120300111_1.html",
    amountMin: 10000000,
    amountMax: null,
    rows: [
      { label: "61 days to 90 days", rate: 7.75 },
      { label: "91 days to 120 days", rate: 8.5 },
      { label: "121 days to 179 days", rate: 8.75 },
      { label: "above 1 year to less than 2 years", rate: 9.0 },
    ],
    notes: [
      "Business Standard, 3 Dec 2013, \"Canara Bank cuts term deposit rates\": cuts to domestic and NRO term deposits of Rs 1 crore and above, effective that Tuesday (3 Dec 2013). The article also states senior citizens get an additional 0.50% on domestic term deposits generally, but does not print the resulting rate for these buckets, so no senior row is added.",
    ],
  },

  // ---------------------------------------------------- Central Bank of India ----
  {
    bankSlug: "central-bank-of-india",
    product: "fd",
    effectiveFrom: "1999-01-18",
    sourceUrl: "https://us.rediff.com/money/1999/jan/14bank.htm",
    rows: [
      { label: "15 days to 29 days", rate: 5.0 },
      { label: "30 days to 60 days", rate: 6.0 },
      { label: "61 days to 90 days", rate: 7.0 },
      { label: "91 days to 179 days", rate: 8.0 },
      { label: "180 days to 1 year", rate: 9.0 },
      { label: "over 1 year to 2 years", rate: 10.0 },
      { label: "over 2 years to 3 years", rate: 10.5 },
      { label: "over 3 years", rate: 11.5 },
    ],
    notes: [
      "Rediff, 14 Jan 1999, \"Central Bank of India revises term deposit rates\": full domestic term-deposit schedule, effective 18 Jan 1999 -- the earliest bank-specific domestic deposit rate found for any bank in this group. Tenure labels are transcribed with digits in place of the article's spelled-out numbers ('over three years' -> 'over 3 years') -- a mechanical transcription, not a value change; the day-count buckets (15-29, 30-60, 61-90, 91-179 days) are exactly as printed.",
      "The article states there is no change to the (unspecified) additional interest rate on single large deposits of Rs 15 lakh and above, so this table's applicability to amounts above that threshold is unclear; amountMin/amountMax are left at their defaults (0/null) rather than assuming a Rs 15 lakh cap the article does not explicitly place on these particular numbers.",
    ],
  },

  // -------------------------------------------------------- Syndicate Bank ----
  {
    bankSlug: "syndicate-bank",
    product: "fd",
    effectiveFrom: "2007-08-01",
    sourceUrl: "https://www.financialexpress.com/archive/boi-canara-syndicate-cut-interest-on-deposits/207832/",
    rows: [
      { label: "400 days to 499 days", rate: 8.9 },
      { label: "500 days to less than 2 years", rate: 9.0 },
    ],
    notes: [
      "Financial Express, 1 Aug 2007 (same article as the Bank of India/Canara Bank cards above): Syndicate Bank revised its domestic term deposit rates for tenors of 400 days to less than 2 years downwards, effective 1 Aug 2007 -- from 9.5% to 8.9% (400-499 days) and from 9.6% to 9% (500 days to less than 2 years).",
    ],
  },

  // -------------------------------------------------------- Bank of Maharashtra ----
  {
    bankSlug: "bank-of-maharashtra",
    product: "fd",
    effectiveFrom: "2010-12-15",
    sourceUrl: "https://www.ndtv.com/pune-news/bank-of-maharashtra-hikes-interest-rates-442163",
    rows: [
      { label: "46 days to 90 days", rate: 5.0 },
      { label: "181 days to 270 days", rate: 7.25 },
      { label: "over 1 year to 5 years", rate: 8.3 },
      { label: "over 5 years to 10 years", rate: 8.0 },
    ],
    notes: [
      "NDTV, 16 Dec 2010, \"Bank of Maharashtra hikes interest rates\": revision effective 15 Dec 2010, increases of 50-125bps across maturity bands; over 5yr-10yr rate explicitly stated as up 50bps from 7.50% to 8.00%.",
      "SUSPICIOUS SOURCE DATA, reported not fixed: the article states a single rate (8.30%) for the whole 'over 1 year to 5 years' span, which is unusually coarse for an Indian bank's retail FD card (normally split into 1-2yr/2-3yr/3-5yr buckets with different rates) -- this may be the reporter's simplification of a table that actually had several buckets at 8.30%, but the article gives no finer breakdown, so it is stored exactly as printed rather than guessing a breakdown.",
      "The article also states a separate 'Bank Term Deposit Scheme' rate rose from 7.50% to 8.30%, but does not state that scheme's tenor, so it is not stored as a row. Senior citizens are stated to get a further 50bps on deposits of 91 days and above, but no resulting senior rate is printed, so no senior row is added.",
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
    special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
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

  console.log("\n=== psb-a press FD/bulk backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
