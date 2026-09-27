/**
 * Utkarsh Small Finance Bank — dated retail FD notices found directly on the bank's own site
 * (not via the Internet Archive). Each is a frozen, dated PDF that the bank stopped updating
 * once superseded (unlike its "live" annexure PDF, which is overwritten in place) -- confirmed
 * by fetching each URL and checking the effective date printed inside is not today's date.
 * Tenure/rate cells transcribed by hand from `pdftotext -layout` output (checked against the
 * rendered numbers; no merged/ambiguous cells in these tables, unlike HDFC's savings archive).
 *
 * Coverage: General + Senior Citizen, domestic retail FD (With Premature Withdrawal Facility),
 * 2023-08-21, 2024-06-07 and 2025-05-05. The retail/bulk threshold itself moved from ₹2 crore
 * (2023 card) to ₹3 crore (2024 and 2025 cards) -- both printed explicitly on their own page,
 * not assumed.
 *
 * Run: npx tsx backfill/utkarsh-fd-dated-archive.ts
 */
import type { RateCard, RateRow } from "../lib/domain";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Tidemark";

interface Snapshot {
  url: string;
  effectiveFrom: string;
  amountMax: number; // retail ceiling stated on the page itself
  rows: Array<[label: string, general: number, senior: number]>;
}

const CRORE = 1_00_00_000;

const SNAPSHOTS: Snapshot[] = [
  {
    url: "https://www.utkarsh.bank/xsite/assests/pdf/Fixed_Deposit_Rates_w_e_f_May_2023.pdf",
    effectiveFrom: "2023-08-21",
    amountMax: 2 * CRORE,
    rows: [
      ["7 Days to 45 Days", 4.0, 4.6],
      ["46 Days to 90 Days", 4.75, 5.35],
      ["91 Days to 180 Days", 5.5, 6.1],
      ["181 Days to 364 Days", 6.5, 7.1],
      ["365 Days to 699 Days", 8.0, 8.6],
      ["700 Days to less than 2 Years", 8.25, 8.85],
      ["2 Years upto 3 Years", 8.5, 9.1],
      ["Above 3 Years to less than 4 Years", 8.25, 8.85],
      ["4 Years upto 5 Years", 7.5, 8.1],
      ["Above 5 Years upto 10 Years", 7.0, 7.6],
    ],
  },
  {
    url: "https://www.utkarsh.bank.in/uploads/pdf/comprehensive/FD_Interest_Rate-Domestic_&_NR.pdf",
    effectiveFrom: "2024-06-07",
    amountMax: 3 * CRORE,
    rows: [
      ["7 Days to 45 Days", 4.0, 4.6],
      ["46 Days to 90 Days", 4.75, 5.35],
      ["91 Days to 180 Days", 5.5, 6.1],
      ["181 Days to 364 Days", 6.5, 7.1],
      ["365 Days to 699 Days", 8.0, 8.6],
      ["700 Days to less than 2 Years", 8.25, 8.85],
      ["2 Years (730 Days) to 3 Years (1095 Days)", 8.5, 9.1],
      ["Above 3 Years to less than 4 Years", 8.25, 8.85],
      ["4 Years (1461 Days) upto 1499 Days", 7.75, 8.35],
      ["1500 Days", 8.5, 9.1],
      ["1501 Days upto 5 Years (1826 Days)", 7.75, 8.35],
      ["Above 5 Years to 10 Years", 7.25, 7.85],
    ],
  },
  {
    url: "https://www.utkarsh.bank/uploads/pdf/comprehensive/Consolidate_FD_interest_rate_May_05_2025.pdf",
    effectiveFrom: "2025-05-05",
    amountMax: 3 * CRORE,
    rows: [
      ["7 Days to 45 Days", 4.0, 4.5],
      ["46 Days to 90 Days", 4.5, 5.0],
      ["91 Days to 180 Days", 5.25, 5.75],
      ["181 Days to 370 Days", 6.25, 6.75],
      ["371 Days to less than 2 Years(729 Days)", 7.5, 8.0],
      ["2 Years (730 Days) upto 3 Years (1095 Days)", 8.25, 8.75],
      ["Above 3 Years to less than 4 Years", 8.0, 8.5],
      ["4 Years (1461 Days) upto 5 Years(1826 Days)", 7.75, 8.25],
      ["Above 5 Years to 10 Years", 7.25, 7.75],
    ],
  },
];

function buildCard(s: Snapshot, today: string): RateCard {
  const rows: RateRow[] = [];
  for (const [label, general, senior] of s.rows) {
    const t = parseTenure(label);
    if (!t) throw new Error(`cannot read tenure "${label}" (${s.url})`);
    const base = {
      tenureMinDays: t.minDays,
      tenureMaxDays: t.maxDays,
      tenureLabel: label,
      special: t.point && t.minDays % 365 !== 0 ? (true as const) : undefined,
      amountMin: 0,
      amountMax: s.amountMax,
      residency: "resident" as const,
      callable: true,
      payout: null,
    };
    rows.push({ ...base, customer: "general", rate: general });
    rows.push({ ...base, customer: "senior", rate: senior });
  }
  return {
    bankSlug: "utkarsh-sfb",
    product: "fd",
    effectiveFrom: s.effectiveFrom,
    observedAt: today,
    sourceType: "bank_archive",
    sourceUrl: s.url,
    confidence: "high",
    rows,
    notes: [
      `Dated retail FD notice fetched directly from the bank's own site (frozen at this date, not the live overwritten-in-place annexure). Retail ceiling for this period was ₹${(s.amountMax / CRORE).toFixed(0)} crore, as printed on the page itself.`,
      "Bulk deposits (above the printed ceiling) are not covered: the page directs customers to contact a branch.",
    ],
  };
}

function main() {
  const today = new Date().toISOString().slice(0, 10);
  for (const s of SNAPSHOTS) {
    const card = buildCard(s, today);
    const r = storeHistoricalCard(STAGING_ROOT, card);
    console.log(`${s.effectiveFrom}: ${r.outcome}`, r.issues.length ? r.issues.map((i) => `${i.level}:${i.message}`) : "");
  }
}

main();
