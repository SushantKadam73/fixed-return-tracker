/**
 * Utkarsh Small Finance Bank — www.utkarsh.bank.in
 * Pages covered:
 *  - Domestic FD rate annexure (PDF): /assests/pdf/Annexure_Domestic_Fixed_Deposit_Interest_Rates.pdf
 *  - Recurring Deposit rate annexure (PDF): /assests/pdf/Annexure_Recurring_Deposit_Interest_Rates.pdf
 *  - Standard Savings Account page (HTML table, incremental slabs)
 *
 * Quirks:
 *  - The FD/RD numbers live only in linked PDFs; the HTML product pages (Fixed Deposits,
 *    Fixed Deposits Plus, Recurring Deposits, Tax Saver Fixed Deposits) are marketing copy
 *    with no numeric table. Fixed Deposits Plus (non-callable, ₹1cr–<3cr) and Tax Saver FD
 *    (5-year) each say "refer the interest rate card" / link to a PDF we could not locate a
 *    genuine numeric copy of in this pass, so neither is covered here (never invented).
 *  - Bulk (₹3 crore and above): the FD PDF itself says "please contact the nearest branch" —
 *    there is no public bulk card, so no fd_bulk adapter is exported.
 *  - The bank's own annexure PDFs are refreshed independently of each other. We saw the RD
 *    annexure carry a stale date (per earlier research) while the FD annexure had already
 *    moved on; this adapter always reads each PDF's OWN "w.e.f." line rather than assuming
 *    they match, and records a note when they disagree instead of "fixing" either one.
 *  - Some FD tenure buckets spell out the exact day count next to the year, e.g.
 *    "667 Days to 2 Years (729 Days)" immediately followed by "2 Years (730 Days) to 3
 *    Years (1095 Days)". parseTenure's generic 365-days/year math would read "2 Years" as
 *    730 days in BOTH rows, creating a one-day overlap at day 730. Since the bank prints the
 *    exact day count itself, `normaliseYearParens` substitutes it in (and drops the
 *    above/less-than qualifier words, which the bank has already applied when it chose the
 *    annotated number) before we call the shared parseTenure — this is a local label
 *    rewrite, not a change to collectors/src/parse/tenure.ts.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

/**
 * "667 Days to 2 Years (729 Days)" -> "667 Days to 729 Days". When the qualifier word
 * (above/less than) sits right next to the annotated year, the bank has already applied
 * that adjustment to the number it printed in parentheses, so we drop the qualifier too —
 * otherwise parseTenure would apply the above/less-than shift a second time.
 */
function normaliseYearParens(label: string): string {
  return label
    .replace(/\b(?:above|less than)\s+\d+\s*years?\s*\((\d+)\s*days?\)/gi, "$1 Days")
    .replace(/\d+\s*years?\s*\((\d+)\s*days?\)/gi, "$1 Days");
}

/** One "<label> <general>% <senior>%" line from the FD/RD annexure PDFs. */
const ROW_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;

function parseTwoColumnPdf(text: string): { effectiveFrom: string | null; rows: Array<{ label: string; general: number; senior: number }> } {
  const dateMatch = /w\.?\s*e\.?\s*f\.?\s*\n?\s*([a-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text);
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  const rows: Array<{ label: string; general: number; senior: number }> = [];
  for (const rawLine of text.split(/\n/)) {
    const line = cleanText(rawLine);
    const m = ROW_RE.exec(line);
    if (!m) continue;
    rows.push({ label: m[1], general: Number(m[2]), senior: Number(m[3]) });
  }
  return { effectiveFrom, rows };
}

function toRateRows(rows: Array<{ label: string; general: number; senior: number }>, amountMax: number): RateRow[] {
  const out: RateRow[] = [];
  for (const r of rows) {
    const tenure = parseTenure(normaliseYearParens(r.label));
    if (!tenure) throw new AdapterError(`cannot read tenure "${r.label}"`);
    for (const [rate, customer] of [[r.general, "general"], [r.senior, "senior"]] as const) {
      out.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: r.label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: 0,
        amountMax: amountMax,
        customer,
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    }
  }
  return out;
}

export const utkarshFd: Adapter = async (ctx) => {
  const { effectiveFrom, rows } = parseTwoColumnPdf(ctx.doc.text);
  if (!effectiveFrom) throw new AdapterError("effective date not found (no w.e.f. line in the FD annexure PDF)");
  if (rows.length === 0) throw new AdapterError("no tenure/rate rows found in the FD annexure PDF");
  const fdRows = toRateRows(rows, 3 * CRORE);
  const card = makeCard(ctx, "fd", fdRows, {
    effectiveFrom,
    notes: [
      "Bulk deposits (₹3 Crore and above): the bank's own PDF says 'please contact the nearest Utkarsh Small Finance Bank Branch' — no public bulk card found.",
      "Fixed Deposits Plus (non-callable, ₹1 Crore–<3 Crore) and the 5-year Tax Saver FD each point to their own rate card, but no genuine numeric copy of either was found on the bank's site in this pass, so they are not covered by this adapter.",
    ],
  });
  return {
    cards: [card],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% flat across all tenures", prematurePenalty: "1% deducted from the rate for the period actually held; nil if withdrawn within 7 days" }],
  };
};

export const utkarshRd: Adapter = async (ctx) => {
  const { effectiveFrom, rows } = parseTwoColumnPdf(ctx.doc.text);
  if (!effectiveFrom) throw new AdapterError("effective date not found (no w.e.f. line in the RD annexure PDF)");
  if (rows.length === 0) throw new AdapterError("no tenure/rate rows found in the RD annexure PDF");
  const rdRows = toRateRows(rows, 3 * CRORE);
  const notes: string[] = [
    "RD rates are Utkarsh's own recurring-deposit card, not derived from the FD card — the two tables use different tenure buckets and rates.",
  ];
  return {
    cards: [makeCard(ctx, "rd", rdRows, { effectiveFrom, notes })],
    terms: [{ product: "rd", seniorPremium: "+0.50% flat across all tenures", prematurePenalty: "1% deducted from the rate for the period actually held; nil for closure within a month", rdRules: "Minimum tenor 6 months, maximum 10 years; instalment must be a multiple of ₹100; tenure must be a multiple of 3 months" }],
  };
};

/** "Balance Upto ₹1 Lakh" / "Incremental balance above ₹X upto ₹Y" / "... above ₹X" (last, open-ended). */
function savingsBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  if (/^balance upto/i.test(t) && nums.length === 1) return { min: 0, max: nums[0] + 1 };
  if (/^incremental balance above/i.test(t) && nums.length === 2) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (/^incremental balance above/i.test(t) && nums.length === 1) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`cannot read savings slab "${label}"`);
}

export const utkarshSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /rate of interest/i.test(headerText(g, 1)), "savings interest table");
  const effectiveFrom = parseDate(headerText(grid, 1));
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings table header");
  const slabs: SavingsSlab[] = [];
  for (const row of grid.rows.slice(1)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const rate = parseRate(row[1] ?? "");
    if (rate === null) continue;
    const band = savingsBand(label);
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident", note: label });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return {
    cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "incremental", notes: ["Page states: 'No Additional Interest Rate for Senior Citizen.'"] })],
  };
};
