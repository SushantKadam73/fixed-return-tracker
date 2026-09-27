/**
 * Oriental Bank of Commerce (merged into PNB, 2020-04-01) -- dated deposit-rate revisions from
 * third-party press reports.
 *
 * Why press, not the bank's own site: OBC's own domain (obcindia.co.in) has essentially no
 * captures matching deposit/rate keywords before 2019 (checked via Internet Archive `discover`;
 * see backfill/notes/psb-b.md) even though OBC operated from 1980 to 2020. Each snapshot below
 * is transcribed directly from a dated news report that states OBC's own specific rate and
 * effective date -- sourceType "press", confidence "low" per the project convention (a
 * secondary source, not the bank's own words). No number here is interpolated or computed: a
 * report's own wording decides amountMin/amountMax for each row, and a tenor the report doesn't
 * mention is simply absent from that snapshot's rows, not filled in from another one.
 *
 * Coverage:
 *  - 2002-08-01 (Zee News, 2002-07-30 wire report): a near-complete short-to-medium tenor ladder
 *    for domestic resident deposits (7 days to 3 years) plus a separate NRE ladder (6mo-3yr+).
 *  - 2010-08-05 (Business Standard, 2010-08-09): a partial revision -- only the tenors the
 *    report names (7-14 days for >Rs 1 crore only, 91 days-1 year, 3-10 years, plus the 1000-day
 *    special tenor).
 *  - 2012-04-16 (The Hindu BusinessLine, 2012-04-15): a partial revision -- only 1-2 years
 *    (all amounts) and the Rs 15 lakh-1 crore band of 46-90 days.
 *  - 2009-03-30 (Times of India, same-day): not a revision, a snapshot of the rate "at present"
 *    on that date for 1-year deposits at two amount bands (the article's own reported cut for
 *    the next day is NOT recorded here, since the article only says the bank "may" cut and
 *    "will take a call tomorrow" -- a proposal, not a confirmed rate).
 *
 * Run: npx tsx backfill/oriental-bank-of-commerce-press-archive.ts
 */
import type { RateCard, RateRow } from "../lib/domain";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Scribe";
const LAKH = 100_000;
const CRORE = 1_00_00_000;

function row(
  label: string,
  rate: number,
  amountMin: number,
  amountMax: number | null,
  extra: Partial<Pick<RateRow, "residency" | "note">> = {},
): RateRow {
  const t = parseTenure(label);
  if (!t) throw new Error(`cannot read tenure "${label}"`);
  return {
    tenureMinDays: t.minDays,
    tenureMaxDays: t.maxDays,
    tenureLabel: label,
    special: t.point && t.minDays % 365 !== 0 ? true : undefined,
    amountMin,
    amountMax,
    customer: "general",
    residency: extra.residency ?? "resident",
    callable: null,
    payout: null,
    rate,
    note: extra.note,
  };
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  const cards: RateCard[] = [
    {
      // "Oriental Bank revises interest rates", Zee News, 30 Jul 2002 (report dated 2002-07-30,
      // rates effective 2002-08-01 per the article's own "from August 1" wording).
      bankSlug: "oriental-bank-of-commerce",
      product: "fd",
      effectiveFrom: "2002-08-01",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://zeenews.india.com/home/oriental-bank-revises-interest-rates_51606.html/amp",
      confidence: "low",
      rows: [
        // "deposits for 7 to 14 days shall earn interest of four per cent irrespective of the amount"
        row("7 to 14 days", 4.0, 0, null),
        // "Deposits of less than Rs 15 lakh for 15 to 30 days, 31 to 45 days, 46 to 90 days, 91
        // to 179 days and 180 days to less than 1 year will earn an interest of 5 per cent,
        // 5.25 pc, 5.75 pc, 6 pc and 6.5 per cent respectively"
        row("15 to 30 days", 5.0, 0, 15 * LAKH),
        row("31 to 45 days", 5.25, 0, 15 * LAKH),
        row("46 to 90 days", 5.75, 0, 15 * LAKH),
        row("91 to 179 days", 6.0, 0, 15 * LAKH),
        row("180 days to less than 1 year", 6.5, 0, 15 * LAKH),
        // "Single deposits for an amount of Rs 15 lakh and above will earn 0.25 per cent extra
        // in these maturities" -- "these maturities" = the 15-day-to-180-day list just above.
        row("15 to 30 days", 5.25, 15 * LAKH, null),
        row("31 to 45 days", 5.5, 15 * LAKH, null),
        row("46 to 90 days", 6.0, 15 * LAKH, null),
        row("91 to 179 days", 6.25, 15 * LAKH, null),
        row("180 days to less than 1 year", 6.75, 15 * LAKH, null),
        // "the rate for maturities of one year to less than two years and two years to less
        // than three years shall be seven per cent and 7.25 per cent respectively" -- the
        // article never says whether the Rs 15 lakh split applies to these two buckets (it only
        // ties the split to "these maturities" = the shorter list above), so they are recorded
        // amount-unqualified rather than guessed either way.
        row("1 year to less than 2 years", 7.0, 0, null, { note: "Article does not state whether the Rs 15 lakh senior-amount split (stated only for 15-day-to-180-day tenors) also applies here; recorded amount-unqualified." }),
        row("2 years to less than 3 years", 7.25, 0, null, { note: "Article does not state whether the Rs 15 lakh senior-amount split (stated only for 15-day-to-180-day tenors) also applies here; recorded amount-unqualified." }),
        // "domestic term deposits for three years will earn 7.5 per cent irrespective of the amount"
        row("3 years", 7.5, 0, null),
      ],
      notes: [
        "Transcribed from a dated wire report of OBC's own rate revision, not the bank's own page (OBC's own domain has no archived deposit-rate page from this era) -- see backfill/notes/psb-b.md.",
      ],
    },
    {
      // "Oriental Bank revises interest rates", NRE section of the same article, same effective date.
      bankSlug: "oriental-bank-of-commerce",
      product: "nre",
      effectiveFrom: "2002-08-01",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://zeenews.india.com/home/oriental-bank-revises-interest-rates_51606.html/amp",
      confidence: "low",
      rows: [
        // "The nre term deposits for an amount of less than rs 15 lakh will fetch 6.5 per cent,
        // 7 pc, 7.25 pc and 7.75 pc for maturities of six months to less than one year, one
        // year to less than two years, two years to less than three years and for three years
        // and above respectively" -- this sentence explicitly scopes ALL four rates to "less
        // than Rs 15 lakh"; no rate for Rs 15 lakh and above NRE deposits is given.
        row("6 months to less than 1 year", 6.5, 0, 15 * LAKH, { residency: "nre" }),
        row("1 year to less than 2 years", 7.0, 0, 15 * LAKH, { residency: "nre" }),
        row("2 years to less than 3 years", 7.25, 0, 15 * LAKH, { residency: "nre" }),
        row("3 years and above", 7.75, 0, 15 * LAKH, { residency: "nre" }),
      ],
      notes: ["Same source as the resident fd card for the same date; only the amount band stated for these four rows is 'less than Rs 15 lakh' -- no NRE rate for Rs 15 lakh and above is given by this report."],
    },
    {
      // "Oriental Bank raises lending, deposit rates", Business Standard, 9 Aug 2010 (rates
      // "from August 5" per the article). A PARTIAL revision: only the tenors the article names.
      bankSlug: "oriental-bank-of-commerce",
      product: "fd",
      effectiveFrom: "2010-08-05",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://www.business-standard.com/article/finance/oriental-bank-raises-lending-deposit-rates-110080900179_1.html",
      confidence: "low",
      rows: [
        // "For 7-14 days maturity slab, the bank has effected a 100 basis-point increase to 2.5
        // per cent, but in this case deposits should be over Rs 1 crore."
        row("7-14 days", 2.5, CRORE, null, { note: "Article: 'deposits should be over Rs 1 crore' for this specific rate." }),
        row("91 to 179 days", 5.5, 0, null),
        row("180 to 269 days", 6.0, 0, null),
        row("270 days to 1 year", 6.25, 0, null),
        row("3-5 years", 7.25, 0, null),
        row("5-10 years", 7.5, 0, null),
        // "Term deposit rate for 1,000 days would now attract an interest rate of 7.5 per cent"
        row("1000 days", 7.5, 0, null),
      ],
      notes: [
        "Partial snapshot: the article reports only the tenors it names as revised, not a full rate card -- other tenors current on 2010-08-05 are not recorded here (gap, not zero).",
      ],
    },
    {
      // "Oriental Bank cuts FD interest rates by up to 0.5%", The Hindu BusinessLine, 15 Apr
      // 2012 ("effective from tomorrow" per the article -> 2012-04-16). A PARTIAL revision.
      bankSlug: "oriental-bank-of-commerce",
      product: "fd",
      effectiveFrom: "2012-04-16",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://www.thehindubusinessline.com/money-and-banking/Oriental-Bank-cuts-FD-interest-rates-by-up-to-0.5/article20421779.ece",
      confidence: "low",
      rows: [
        // "The bank reduced interest rate on fixed deposits with maturity between 1-2 years by
        // 0.25 per cent to 9.50 per cent" -- new rate stated directly, amount not qualified.
        row("1-2 years", 9.5, 0, null),
        // "For term deposits worth Rs 15 lakh to Rs 1 crore with maturity between 46-90 days,
        // the new interest rate will be 0.5 per cent lower than the existing 9 per cent" -> 8.5%.
        row("46-90 days", 8.5, 15 * LAKH, CRORE),
      ],
      notes: [
        "Partial snapshot: only the two revised tenors the article names, not a full rate card.",
        "Article also reports the senior-citizen premium rising from 0.5% to 0.6% over the card rate on this date -- a policy change, not a per-row rate, so not recorded as a row.",
      ],
    },
    {
      // "Oriental Bank of Commerce likely to cut deposit rates", Times of India, 30 Mar 2009 --
      // states the rate "at present" on that date, NOT a revision (the article's own reported
      // cut is a proposal for "tomorrow", not yet confirmed, so it is not recorded).
      bankSlug: "oriental-bank-of-commerce",
      product: "fd",
      effectiveFrom: null,
      observedAt: today,
      observedFrom: "2009-03-30",
      observedTo: "2009-03-30",
      sourceType: "press",
      sourceUrl: "https://timesofindia.indiatimes.com/business/india-business/oriental-bank-of-commerce-likely-to-cut-deposit-rates/articleshow/4335132.cms",
      confidence: "low",
      rows: [
        // "At present, the bank offers an interest rate of 8.25% on one-year deposits of up to
        // Rs 1 crore and 7.5% for deposits above Rs 1 crore."
        row("1 year", 8.25, 0, CRORE),
        row("1 year", 7.5, CRORE, null),
      ],
      notes: [
        "No stated effective-from date -- the article reports the rate 'at present' on 2009-03-30, not a dated revision, so effectiveFrom is left null and observedFrom/observedTo record the article's own date instead.",
        "The article's own reported 50-bps cut 'tomorrow' is a proposal under discussion at the time of writing ('we will take a call... tomorrow'), not a confirmed rate, and is deliberately not recorded.",
      ],
    },
  ];

  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  for (const card of cards) {
    const r = storeHistoricalCard(STAGING_ROOT, card);
    console.log(`${card.product} ${card.effectiveFrom ?? card.observedFrom}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
    if (r.outcome === "inserted") inserted++;
    else if (r.outcome === "unchanged") unchanged++;
    else rejected++;
  }
  console.log(`\ninserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
}

main();
