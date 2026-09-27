/**
 * Punjab National Bank -- dated deposit-rate revisions from third-party press reports, for the
 * 1998-2002 window before PNB's own web archive picks up (the earliest usable capture of
 * pnbindia.in found in this pass is 2009; see backfill/notes/psb-b.md). Each snapshot below is
 * transcribed directly from a dated news report that states PNB's own specific rate and
 * effective date -- sourceType "press", confidence "low" per the project convention. Every
 * snapshot here is a PARTIAL revision (only the tenors/rates each report names as changed, not
 * a full rate card) -- a gap in a snapshot is a gap, never filled from another one.
 *
 * Coverage:
 *  - 1998-05-08 (Business Standard, wire report dated 1998-05-15/published 1998-05-16, "came
 *    into effect on May 8"): 4 short-tenor rows.
 *  - 2000-08-16 (Business Standard, published 2000-08-17, "yesterday announced" -> 08-16):
 *    3 medium/long-tenor rows; the report explicitly says shorter-duration rates were
 *    unchanged, so they are not recorded here (not zero, just not part of this revision).
 *  - 2002-11-07 (Times of India, published 2002-11-06, "from Thursday" -- 2002-11-06 was a
 *    Wednesday, so the change took effect the next day): resident short/long-tenor rows plus a
 *    separate NRE ladder.
 *
 * Run: npx tsx backfill/punjab-national-bank-press-archive.ts
 */
import type { RateCard, RateRow } from "../lib/domain";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Scribe";

function row(label: string, rate: number, extra: Partial<Pick<RateRow, "residency" | "note">> = {}): RateRow {
  const t = parseTenure(label);
  if (!t) throw new Error(`cannot read tenure "${label}"`);
  return {
    tenureMinDays: t.minDays,
    tenureMaxDays: t.maxDays,
    tenureLabel: label,
    special: t.point && t.minDays % 365 !== 0 ? true : undefined,
    amountMin: 0,
    amountMax: null,
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
      // "Pnb Announces Single, Reduced Plr", Business Standard, 15 May 1998 (published
      // 1998-05-16 IST) -- "The bank also effected a corresponding revision in deposit rates
      // ... came into effect on May 8".
      bankSlug: "punjab-national-bank",
      product: "fd",
      effectiveFrom: "1998-05-08",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://www.business-standard.com/article/specials/pnb-announces-single-reduced-plr-198051601119_1.html",
      confidence: "low",
      rows: [
        // "PNB introduced a new slab of 15-29 days deposits with an interest rate of five per cent"
        row("15-29 days", 5.0),
        // "The 30-45 day deposits would fetch 5.5 per cent, 50 basis points less than the older rate."
        row("30-45 days", 5.5),
        // "retaining 46-90 day and 91-179 day rates at seven per cent"
        row("46-90 days", 7.0),
        row("91-179 days", 7.0),
      ],
      notes: [
        "Partial snapshot: only the tenors this wire report names, not a full rate card.",
        "PNB's own web archive (pnbindia.in) has no captures before 2009; this fills part of the 1998-2009 gap with dated press evidence -- see backfill/notes/psb-b.md.",
      ],
    },
    {
      // "Punjab National Bank Hikes Rates On Term Deposit", Business Standard, published
      // 2000-08-17, reporting a decision announced "yesterday" (2000-08-16).
      bankSlug: "punjab-national-bank",
      product: "fd",
      effectiveFrom: "2000-08-16",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://www.business-standard.com/article/specials/punjab-national-bank-hikes-rates-on-term-deposit-100081701036_1.html",
      confidence: "low",
      rows: [
        // "The interest rate on term deposits between one-two years have been raised to 8.5 from the previous 8 per cent"
        row("1-2 years", 8.5),
        // "the rate for two-three years' maturity has been raised to 9 per cent from the previous 8.5 per cent"
        row("2-3 years", 9.0),
        // "Rate on deposits of three years and above have been raised to 10 per cent from the previous 9.5 per cent"
        row("3 years and above", 10.0),
      ],
      notes: [
        "Partial snapshot: the report states rates for one year and above only rose, and that 'rates for deposits of shorter duration have, however, remained unchanged' -- shorter tenors are deliberately not recorded here (their unchanged value is not stated by this report, only that they didn't move).",
      ],
    },
    {
      // "PNB slashes term deposit rates", Times of India, published 2002-11-06 ("from
      // Thursday" -- 6 Nov 2002 was a Wednesday, so the new rates took effect 2002-11-07).
      bankSlug: "punjab-national-bank",
      product: "fd",
      effectiveFrom: "2002-11-07",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://timesofindia.indiatimes.com/business/india-business/pnb-slashes-term-deposit-rates/articleshow/27465624.cms",
      confidence: "low",
      rows: [
        // "PNB reduced the rate for term deposits of over three years maturity to 6.75 per cent from 7.0 per cent"
        row("over 3 years", 6.75),
        // "that of 1-3 years to 6.5 per cent from 6.75 per cent"
        row("1-3 years", 6.5),
        // "The revised rates for 15-29 days deposits would be 4.5 per cent while that for 30-45
        // days, the rate would be 5.25 per cent, 5.5 per cent for 91-179 days and 5.75 per cent
        // for 180-365 days"
        row("15-29 days", 4.5),
        row("30-45 days", 5.25),
        row("91-179 days", 5.5),
        row("180-365 days", 5.75),
      ],
      notes: ["Partial snapshot: only the tenors this wire report names, not a full rate card."],
    },
    {
      // Same article's NRE section, same effective date.
      bankSlug: "punjab-national-bank",
      product: "nre",
      effectiveFrom: "2002-11-07",
      observedAt: today,
      sourceType: "press",
      sourceUrl: "https://timesofindia.indiatimes.com/business/india-business/pnb-slashes-term-deposit-rates/articleshow/27465624.cms",
      confidence: "low",
      rows: [
        // "the applicable rates of interest are 5.75 per cent for six months to less than one
        // year, 6.5 per cent for one year to less than 3 years and 6.75 per cent for three
        // years and above"
        row("6 months to less than 1 year", 5.75, { residency: "nre" }),
        row("1 year to less than 3 years", 6.5, { residency: "nre" }),
        row("3 years and above", 6.75, { residency: "nre" }),
      ],
      notes: ["Partial snapshot: only the tenors this wire report names, not a full rate card."],
    },
  ];

  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  for (const card of cards) {
    const r = storeHistoricalCard(STAGING_ROOT, card);
    console.log(`${card.product} ${card.effectiveFrom}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
    if (r.outcome === "inserted") inserted++;
    else if (r.outcome === "unchanged") unchanged++;
    else rejected++;
  }
  console.log(`\ninserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
}

main();
