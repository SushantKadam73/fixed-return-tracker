/**
 * Unity Small Finance Bank — dated rate tables from the bank's own newsroom press releases
 * (theunitybank.com/docs/newsroom/*.pdf), found directly on the live site (not via the Internet
 * Archive: these specific PDFs are still hosted at stable URLs). Fetched and read with
 * `pdftotext -layout`; every row below is transcribed from that output.
 *
 * Why this exists: the bank's own FD/RD/savings *pages* on theunitybank.com never carried an
 * HTML table at any point checked (2023-2025 Wayback captures of fixed-deposits.html,
 * fixed_deposits.html and personal-banking/deposits/fixed-deposit all show only marketing copy
 * with the numbers loaded client-side) -- see backfill/notes/sfb.md. The bank's press releases
 * are the only source of genuine dated retail/bulk/savings tables before the two
 * "website-disclosure-effective-*.pdf" files unityHistory() (collectors/src/adapters/unity-sfb.ts)
 * already covers, which only reach back to Feb 2026.
 *
 * Coverage:
 *  - fd (retail): 2022-07-06, 2023-02-15, 2023-10-09, 2024-05-01
 *  - fd_bulk (callable + non-callable, both amount x tenure grids): 2022-09-26
 *  - savings: 2022-01-22 (flat: <=1 lakh 6%, >1 lakh 7% -- restated identically in the Sep 2022,
 *    Feb 2023 and Oct 2023 releases) and 2023-06-24 (tiered: 6/7.25/7.50/7.75%, the dedicated
 *    subject of its own release). NOTE: the Oct 2023 release (13 Oct 2023) restates the *old*
 *    Jan 2022 flat structure verbatim, six months after the Jun 2023 release announced the
 *    tiered one -- almost certainly stale boilerplate copied between press releases rather than
 *    a real reversion, but this is not certain, so both cards are kept with this contradiction
 *    noted rather than silently resolved.
 *
 * Run: npx tsx backfill/unity-sfb-press-archive.ts
 */
import type { RateCard, RateRow, SavingsSlab } from "../lib/domain";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Tidemark";
const CRORE = 1_00_00_000;

function row(label: string, general: number, senior: number, amountMin: number, amountMax: number | null, callable: boolean): RateRow[] {
  const t = parseTenure(label);
  if (!t) throw new Error(`cannot read tenure "${label}"`);
  const base = { tenureMinDays: t.minDays, tenureMaxDays: t.maxDays, tenureLabel: label, special: t.point && t.minDays % 365 !== 0 ? (true as const) : undefined, amountMin, amountMax, residency: "resident" as const, callable, payout: null };
  return [
    { ...base, customer: "general", rate: general },
    { ...base, customer: "senior", rate: senior },
  ];
}

interface FdSnapshot {
  effectiveFrom: string;
  sourceUrl: string;
  amountMax: number | null;
  amountNote: string;
  rows: Array<[string, number, number]>;
}

const FD_SNAPSHOTS: FdSnapshot[] = [
  {
    effectiveFrom: "2022-07-06",
    sourceUrl: "https://theunitybank.com/docs/newsroom/press-release-fd-rate-increase.pdf",
    amountMax: 2 * CRORE,
    amountNote: "Ceiling of ₹2 crore inferred from this same press release's own bulk-deposit table, whose lowest band starts at '>=Rs 2 crs' -- not stated directly on the retail table itself.",
    rows: [
      ["7-14 Days", 4.0, 4.0],
      ["15-45 Days", 4.0, 4.0],
      ["46-60 Days", 5.0, 5.5],
      ["61-90 Days", 5.0, 5.5],
      ["91-180 Days", 5.0, 5.5],
      ["181 – 364 Days", 6.5, 7.0],
      ["365 Days(1 Year)", 7.35, 7.85],
      [">1Year – 18 M", 7.35, 7.85],
      [">18 M -2 Year", 7.4, 7.9],
      [">2 Year -3 Year", 7.65, 8.15],
      [">3 Year – 5Year", 7.65, 8.15],
      [">5 Year – 10 Year", 7.0, 7.5],
    ],
  },
  {
    effectiveFrom: "2023-02-15",
    sourceUrl: "https://theunitybank.com/docs/newsroom/interest-rate-hike-feb-2023.pdf",
    amountMax: null,
    amountNote: "Retail ceiling not restated in this press release.",
    rows: [
      ["7-14 Days", 4.5, 4.5],
      ["15-45 Days", 4.75, 4.75],
      ["46-60 Days", 5.25, 5.75],
      ["61-90 Days", 5.5, 6.0],
      ["91-164 Days", 5.75, 6.25],
      ["165-180 Days", 5.75, 6.25],
      ["181-201 Days", 8.75, 9.25],
      ["202–364 Days", 6.75, 7.25],
      ["365 Days", 7.35, 7.85],
      ["1Year 1 day", 7.35, 7.85],
      [">1Year 1 day - 500 days", 7.35, 7.85],
      ["501 Days", 8.75, 9.25],
      ["502 Days - 18 M", 7.35, 7.85],
      [">18 M -1000 Days", 7.4, 7.9],
      ["1001 Days", 9.0, 9.5],
      ["1002 Days -3 Year", 7.65, 8.15],
      [">3 Year – 5 Year", 7.65, 8.15],
      [">5 Year – 10 Year", 7.0, 7.5],
    ],
  },
  {
    effectiveFrom: "2023-10-09",
    sourceUrl: "https://theunitybank.com/docs/newsroom/press-release-unity-bank-interest-rate-hike-october-2023-1.pdf",
    amountMax: null,
    amountNote: "Retail ceiling not restated in this press release.",
    rows: [
      ["7 - 14 Days", 4.5, 4.5],
      ["15 - 45 Days", 4.75, 4.75],
      ["46 - 60 Days", 5.25, 5.75],
      ["61 - 90 Days", 5.5, 6.0],
      ["91 - 164 Days", 5.75, 6.25],
      ["165 Days - 6 Months", 5.75, 6.25],
      ["> 6 Months - 201 Days", 8.75, 9.25],
      ["202 - 364 Days", 6.75, 7.25],
      ["1 Year", 7.35, 7.85],
      ["1 Year 1 day", 7.35, 7.85],
      ["> 1Year 1 day - 500 days", 7.35, 7.85],
      ["501 Days", 8.75, 9.25],
      ["502 Days - 18 Months", 7.35, 7.85],
      ["> 18 Months - 700 Days", 7.4, 7.9],
      ["701 Days", 8.95, 9.45],
      ["702 Days - 1000 Days", 7.4, 7.9],
      ["1001 Days", 9.0, 9.5],
      ["1002 Days - 3 Year", 7.65, 8.15],
      ["> 3 Year - 5 Year", 7.65, 8.15],
      ["> 5 Year - 10 Year", 7.0, 7.5],
    ],
  },
  {
    effectiveFrom: "2024-05-01",
    sourceUrl: "https://theunitybank.com/docs/newsroom/press-release-unity-bank-savings-june-2024.pdf",
    amountMax: null,
    amountNote: "Retail ceiling not restated in this press release.",
    rows: [
      ["7 - 14 Days", 4.5, 4.5],
      ["15 - 45 Days", 4.75, 4.75],
      ["46 - 60 Days", 5.75, 6.25],
      ["61 - 90 Days", 6.0, 6.5],
      ["91 - 164 Days", 6.25, 6.75],
      ["165 Days - 6 Months", 6.25, 6.75],
      ["> 6 Months - 201 Days", 8.5, 9.0],
      ["202 - 364 Days", 7.25, 7.75],
      ["1 Year", 7.85, 8.35],
      ["1 Year 1 day", 7.85, 8.35],
      ["> 1Year 1 day - 500 days", 7.85, 8.35],
      ["501 Days", 8.75, 9.25],
      ["502 Days - 18 Months", 7.85, 8.35],
      ["> 18 Months - 700 Days", 7.9, 8.4],
      ["701 Days", 8.95, 9.45],
      ["702 Days - 1000 Days", 7.9, 8.4],
      ["1001 Days", 9.0, 9.5],
      ["1002 Days - 3 Year", 8.15, 8.65],
      ["> 3 Year - 5 Year", 8.15, 8.65],
      ["> 5 Year - 10 Year", 7.5, 8.0],
    ],
  },
];

const BULK_URL = "https://theunitybank.com/docs/newsroom/press-release-fd-rate-increase.pdf";
const BULK_EFFECTIVE = "2022-09-26";
const BULK_TENURES: Array<[string, number[]]> = [
  ["7-14 Days", [4.0, 4.0, 4.0, 4.0, 4.0, 4.0]],
  ["15-45 Days", [4.25, 4.25, 4.25, 4.25, 4.25, 4.25]],
  ["46-60 Days", [4.25, 4.25, 4.25, 4.25, 4.25, 4.25]],
  ["61-90 Days", [4.5, 4.5, 4.5, 4.5, 4.5, 4.5]],
  ["91-180 Days", [5.0, 5.0, 5.0, 5.0, 5.0, 5.0]],
  ["181 – 364 Days", [6.5, 6.5, 6.5, 6.5, 6.5, 6.5]],
  ["365 Days(1 Year)", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
  [">1Year – 18 M", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
  [">18 M -2 Year", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
  [">2 Year -3 Year", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
  [">3 Year – 5Year", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
  [">5 Year – 10 Year", [7.0, 7.0, 7.0, 7.0, 7.0, 7.0]],
];
const NON_CALLABLE_TENURES: Array<[string, number[]]> = [
  ["7-14 Days", [4.0, 4.0, 4.0, 4.0, 4.0, 4.0]],
  ["15-45 Days", [4.25, 4.25, 4.25, 4.25, 4.25, 4.25]],
  ["46-60 Days", [4.25, 4.25, 4.25, 4.25, 4.25, 4.25]],
  ["61-90 Days", [4.5, 4.5, 4.5, 4.5, 4.5, 4.5]],
  ["91-180 Days", [5.6, 5.6, 5.6, 5.6, 5.6, 5.6]],
  ["181 – 364 Days", [6.75, 6.75, 6.75, 6.75, 6.75, 6.75]],
  ["365 Days(1 Year)", [7.1, 7.1, 7.1, 7.1, 7.1, 7.1]],
  [">1Year – 18 M", [7.1, 7.1, 7.1, 7.1, 7.1, 7.1]],
  [">18 M -2 Year", [7.1, 7.1, 7.1, 7.1, 7.1, 7.1]],
  [">2 Year -3 Year", [7.25, 7.25, 7.25, 7.25, 7.25, 7.25]],
  [">3 Year – 5Year", [7.25, 7.25, 7.25, 7.25, 7.25, 7.25]],
  [">5 Year – 10 Year", [7.25, 7.25, 7.25, 7.25, 7.25, 7.25]],
];
// Bands shared by both bulk tables: ">=2cr-<5cr", "5cr-<10cr", "10cr-<25cr", "25cr-<50cr", "50cr-<100cr", ">=100cr".
const BULK_BANDS: Array<[number, number | null]> = [
  [2 * CRORE, 5 * CRORE],
  [5 * CRORE, 10 * CRORE],
  [10 * CRORE, 25 * CRORE],
  [25 * CRORE, 50 * CRORE],
  [50 * CRORE, 100 * CRORE],
  [100 * CRORE, null],
];

interface SavingsSnapshot {
  effectiveFrom: string;
  sourceUrl: string;
  slabs: SavingsSlab[];
  note: string;
}

const SAVINGS_SNAPSHOTS: SavingsSnapshot[] = [
  {
    effectiveFrom: "2022-01-22",
    sourceUrl: "https://theunitybank.com/docs/newsroom/press-release-fd-rate-increase.pdf",
    slabs: [
      { balanceMin: 0, balanceMax: 100_000, rate: 6.0, residency: "resident" },
      { balanceMin: 100_000, balanceMax: null, rate: 7.0, residency: "resident", note: "One merged 7.00% cell spans every balance tier above ₹1 lakh (>1L-5L, >5L-50L, >50L-10cr, >10cr) in the source table -- flat above ₹1 lakh, not tiered." },
    ],
    note: "Restated identically (same 'revised from January 22, 2022' wording) in three separate press releases dated 26 Sep 2022, 15 Feb 2023 and 13 Oct 2023 -- treated as a single flat structure valid across that whole span, EXCEPT that a dedicated 24 Jun 2023 release (see the 2023-06-24 card) announced a tiered replacement partway through it. The 13 Oct 2023 release still shows this flat structure, six months after that tiered announcement -- likely stale boilerplate, not a genuine reversion, but not verified either way.",
  },
  {
    effectiveFrom: "2023-06-24",
    sourceUrl: "https://theunitybank.com/docs/newsroom/press-release-unity-bank-savings-june-2024.pdf",
    slabs: [
      { balanceMin: 0, balanceMax: 100_000, rate: 6.0, residency: "resident" },
      { balanceMin: 100_000, balanceMax: 500_000, rate: 7.25, residency: "resident" },
      { balanceMin: 500_000, balanceMax: 50_00_000, rate: 7.5, residency: "resident" },
      { balanceMin: 50_00_000, balanceMax: null, rate: 7.75, residency: "resident" },
    ],
    note: "Dedicated subject of this press release (headlined 'Unity Bank Enhances Interest Rates on Savings Accounts', dated 24 Jun 2023) -- see the 2022-01-22 card's note for the contradiction with a later release.",
  },
];

function buildFdCard(s: FdSnapshot, today: string): RateCard {
  const rows = s.rows.flatMap(([label, g, sr]) => row(label, g, sr, 0, s.amountMax, true));
  return {
    bankSlug: "unity-sfb",
    product: "fd",
    effectiveFrom: s.effectiveFrom,
    observedAt: today,
    sourceType: "bank_archive",
    sourceUrl: s.sourceUrl,
    confidence: "high",
    rows,
    notes: [`Retail FD table from the bank's own dated press release. ${s.amountNote}`],
  };
}

function buildBulkCard(today: string): RateCard {
  const rows: RateRow[] = [];
  for (const [tenures, callable] of [[BULK_TENURES, true], [NON_CALLABLE_TENURES, false]] as const) {
    for (const [label, rates] of tenures) {
      const t = parseTenure(label);
      if (!t) throw new Error(`cannot read tenure "${label}"`);
      for (let i = 0; i < BULK_BANDS.length; i++) {
        const [min, max] = BULK_BANDS[i];
        rows.push({
          tenureMinDays: t.minDays,
          tenureMaxDays: t.maxDays,
          tenureLabel: label,
          special: t.point && t.minDays % 365 !== 0 ? true : undefined,
          amountMin: min,
          amountMax: max,
          customer: "general",
          residency: "resident",
          callable,
          payout: null,
          rate: rates[i],
        });
      }
    }
  }
  return {
    bankSlug: "unity-sfb",
    product: "fd_bulk",
    effectiveFrom: BULK_EFFECTIVE,
    observedAt: today,
    sourceType: "bank_archive",
    sourceUrl: BULK_URL,
    confidence: "high",
    rows,
    notes: [
      "Callable and Non-Callable Bulk Deposit tables from the bank's own dated press release (26 Sep 2022).",
      "No senior-citizen rate printed for either table in this release; the bank's footnote says senior citizens get +50bps on callable bulk (matching the pattern the live unity-sfb adapter uses for later disclosures) and that non-callable bulk is not offered to senior citizens at all -- neither senior row is added here since this specific release does not restate the +50bps figure itself.",
    ],
  };
}

function buildSavingsCard(s: SavingsSnapshot, today: string): RateCard {
  return {
    bankSlug: "unity-sfb",
    product: "savings",
    effectiveFrom: s.effectiveFrom,
    observedAt: today,
    sourceType: "bank_archive",
    sourceUrl: s.sourceUrl,
    confidence: "high",
    rows: [],
    savingsSlabs: s.slabs,
    slabMethod: "unknown",
    notes: [s.note],
  };
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  for (const s of FD_SNAPSHOTS) {
    const r = storeHistoricalCard(STAGING_ROOT, buildFdCard(s, today));
    console.log(`fd ${s.effectiveFrom}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
  }
  {
    const r = storeHistoricalCard(STAGING_ROOT, buildBulkCard(today));
    console.log(`fd_bulk ${BULK_EFFECTIVE}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
  }
  for (const s of SAVINGS_SNAPSHOTS) {
    const r = storeHistoricalCard(STAGING_ROOT, buildSavingsCard(s, today));
    console.log(`savings ${s.effectiveFrom}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
  }
}

main();
