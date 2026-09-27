/**
 * Tamilnad Mercantile Bank (TMB) — tmb.bank.in
 *
 * Page covered: "TMB Basic Fixed Deposit Account"
 * (https://www.tmb.bank.in/personal/deposits/tmb-basic-fixed-deposit-account) — a single
 * consolidated page holding, as separate HTML tables: Savings Bank Account (8 slabs), Domestic
 * & NRO Term Deposits (<₹3 crore, General/Senior/Super Senior x Callable/Non-Callable), and
 * Bulk Domestic/NRO/NRE Term Deposits (≥₹3 crore, 7 amount tiers x Callable/Non-Callable). NRE
 * retail deposits and FCNR(B)/RFC are on the same page but out of scope here (foreign-currency
 * and NRE-specific products, not the retail/bulk/savings/RD set this adapter targets).
 * The companion "TMB Basic Recurring Deposit Account" page (fixture: basic_rd_account.html)
 * reuses the exact same Savings/Domestic/Bulk widgets but has no RD-specific rate table and no
 * "RD rate = FD rate" statement anywhere — only generic marketing copy ("attractive interest
 * rates") and operational rules about late-instalment penalties — so no RD card is produced.
 * Checked further (live, 2026-09-27): the bank's separate "Maturity Value Chart" page
 * (https://www.tmb.bank.in/maturity-value-chart, linked from the Basic RD tab too) does publish
 * real per-tenure rates, but only for the "Kids RD" scheme (minors-only) and the flat-rate-per-
 * customer-type "Navarathnamala Deposit Scheme" — neither is the plain Basic RD product this
 * adapter targets, so they stay out of scope rather than being substituted in as a "rd" card.
 *
 * Quirks handled locally (no shared file touched):
 *  - Every savings-slab rate cell is written "2.60% (p.a)" with the "(p.a)" annotation inside
 *    parentheses. The shared parseRate only strips a trailing "p.a." or "per annum" written
 *    without parens, so it returns null for every single row here (and, as a side effect, the
 *    generic header-row auto-detector would then treat the WHOLE table as header rows, since it
 *    never sees a parseable rate). We strip "(p.a)" ourselves before calling parseRate and read
 *    the slabs by hand (the table has no header row at all, just data rows).
 *  - Two named special tenures ("456 days (TMB 456 Special Deposit scheme) @" and "567 days
 *    (TMB 567 Special Deposit scheme) @") need no special handling at all: the day count sits
 *    outside the parens this time, so the shared parseTenure reads it natively and
 *    TermTableSpec.schemeNames attaches the scheme name by day count.
 *  - The retail table has three customer tiers (General/Senior/Super Senior) each split into
 *    Callable/Non-Callable columns — six rate columns behind one tenure column. The shared
 *    parseTermTable already supports several customer columns in one call, but ties `callable`
 *    to the whole call, not to individual columns, so we call it twice (once per callable state)
 *    with an `exclude` on each ColumnSpec so the "General"/"Senior" match doesn't also pick up
 *    the "Non-Callable" copy of the same customer's column.
 *  - The bulk table has the same Callable/Non-Callable split again, this time crossed with 7
 *    amount tiers instead of customer tiers (no senior-citizen column above ₹3 crore at all).
 *    We reuse the same "call parseTermTable once per column group" approach, one call per
 *    (callable state × amount tier) combination — 14 calls total, each selecting one column.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable, type TermTableSpec } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** Strip the "(p.a)" annotation this page glues onto every savings rate before parsing it. */
function rate(cell: string): number | null {
  return parseRate(cell.replace(/\(\s*p\.?\s*a\.?\s*\)/gi, ""));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const tmbFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // On the live (untrimmed) page, a repeated in-page nav list ("Bulk Domestic /NRO/NRE Term
  // Deposit NRE Deposits FCNR ... Pre-Closure Penalty for Domestic & NRO Term Deposits ...")
  // sits ahead of several tables and gets swept into grid.context, so a plain substring test
  // can match the wrong table (this only shows up live — the checked-in fixture's <nav> was
  // stripped by trim-fixture.ts, hiding the problem). Anchoring to the END of the context
  // string picks the heading immediately before the table, not an earlier nav mention.
  const grid = requireGrid(grids, (g) => /domestic\s*&\s*nro term deposits?\s*$/i.test(g.context.trim()), "domestic & NRO term deposit card");

  const schemeNames = { 456: "TMB 456 Special Deposit scheme", 567: "TMB 567 Special Deposit scheme" };
  const base = { amountMin: 0, amountMax: 3 * CRORE, residency: "resident" as const, schemeNames };
  const callable = parseTermTable(grid, {
    ...base,
    callable: true,
    columns: [
      { header: /general public/i, customer: "general", exclude: /non-callable/i },
      { header: /senior citizen/i, customer: "senior", exclude: /super senior|non-callable/i },
      { header: /super senior citizen/i, customer: "super_senior", exclude: /non-callable/i },
    ],
  });
  const nonCallable = parseTermTable(grid, {
    ...base,
    amountMin: 1 * CRORE, // the "Non-Callable (Above ₹ 1 Cr)" column header
    callable: false,
    columns: [
      { header: /general public.*non-callable/i, customer: "general" },
      { header: /senior citizen.*non-callable/i, customer: "senior", exclude: /super senior/i },
      { header: /super senior citizen.*non-callable/i, customer: "super_senior" },
    ],
  });

  const dateMatch = /w\.?\s?e\.?\s?f\.?\s*([\d.]{6,10})/i.exec(grid.rows[0]?.[0] ?? "");
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("effective date not found in the domestic term deposit table's own header");

  const fd = makeCard(ctx, "fd", [...callable, ...nonCallable], {
    effectiveFrom,
    notes: [
      "No recurring-deposit rate table or 'RD rates equal FD rates' statement appears on the bank's RD product page (it reuses this same FD/savings/bulk content, with only generic 'attractive interest rates' marketing copy for RD itself), so no RD card is produced for TMB.",
      "The bank's separate 'Maturity Value Chart' page (https://www.tmb.bank.in/maturity-value-chart) does publish real per-tenure rates, but only for the minors-only 'Kids RD' scheme and the flat-rate-per-customer-type 'Navarathnamala Deposit Scheme' -- neither represents the plain Basic RD product, so they are not substituted in here.",
    ],
  });

  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. over General Public",
        superSeniorPremium: "+0.60% p.a. over General Public (+0.10% over Senior Citizen)",
        other: [
          "Bank states: \"Additional rate of interest payable on term deposits to Senior Citizens and Super Senior Citizens shall not apply to NRO Term Deposits\"",
          "Bank states: \"Additional rate of interest payable on term deposits to Senior Citizens and Super Senior Citizens shall not apply for the period less than one year\"",
          "No percentage premature-closure penalty is quantified for retail domestic/NRO deposits on this page (only 'Premature closure permitted, subject to applicable penalty'); NRE deposits are explicitly 1%, and bulk deposits (≥₹3 crore) explicitly have no penalty after 7 days.",
        ],
      },
    ],
  };
};

/** 7-tier bulk table: each tier is its own column, crossed with Callable/Non-Callable. */
const BULK_TIERS: Array<{ text: string; min: number; max: number | null }> = [
  { text: "3 to <5cr", min: 3 * CRORE, max: 5 * CRORE },
  { text: "5 to <10cr", min: 5 * CRORE, max: 10 * CRORE },
  { text: "10 to <25 cr", min: 10 * CRORE, max: 25 * CRORE },
  { text: "25 to <50 cr", min: 25 * CRORE, max: 50 * CRORE },
  { text: "50 to <100 cr", min: 50 * CRORE, max: 100 * CRORE },
  { text: "100 cr to <250 cr", min: 100 * CRORE, max: 250 * CRORE },
  { text: "250 cr & above", min: 250 * CRORE, max: null },
];

function bulkPass(grid: Grid, callable: boolean): RateRow[] {
  return BULK_TIERS.flatMap((tier) => {
    const tierRe = escapeRe(tier.text);
    const spec: TermTableSpec = callable
      ? { columns: [{ header: new RegExp(tierRe, "i"), customer: "general", exclude: /non-callable/i }], amountMin: tier.min, amountMax: tier.max, residency: "resident", callable: true }
      : { columns: [{ header: new RegExp(`non-callable[\\s\\S]*${tierRe}`, "i"), customer: "general" }], amountMin: tier.min, amountMax: tier.max, residency: "resident", callable: false };
    return parseTermTable(grid, spec);
  });
}

export const tmbBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // End-anchored for the same reason as tmbFd above — the live page's nav junk mentions
  // "Bulk Domestic /NRO/NRE Term Deposit" ahead of other tables too.
  const grid = requireGrid(grids, (g) => /bulk domestic\s*\/\s*nro\s*\/\s*nre term deposits?\s*$/i.test(g.context.trim()), "bulk domestic/NRO/NRE term deposit card");

  const dateMatch = /with effect from\s*([\d.]{6,10})/i.exec(grid.rows[0]?.[0] ?? "");
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("effective date not found in the bulk term deposit table's own header");

  const rows = [...bulkPass(grid, true), ...bulkPass(grid, false)];
  const card = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: [
      "No senior-citizen column above ₹3 crore — one 'general' rate applies to every customer per tenure/amount/callable combination.",
      'Bank states: "There is no penal interest for premature closure of bulk deposits (Rs.3 crore and above) after 7 days of opening."',
    ],
  });
  return { cards: [card] };
};

/** Savings slabs: "Balance up to X" / "Balance > X to/up to Y" / "Balance > X" (no upper bound). */
function parseTmbBand(label: string): { min: number; max: number | null } {
  const t = label.toLowerCase();
  const nums = amountsIn(t);
  if (nums.length === 0) throw new AdapterError(`unrecognised savings slab label "${label}"`);
  if (!t.includes(">")) return { min: 0, max: nums[0] + 1 }; // "Balance up to 5 lakhs"
  if (nums.length >= 2) return { min: nums[0] + 1, max: nums[1] + 1 }; // "Balance > X to/up to Y"
  return { min: nums[0] + 1, max: null }; // "Balance > X" (top, open-ended)
}

export const tmbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // End-anchored for the same reason as tmbFd above.
  const grid = requireGrid(grids, (g) => /savings bank account\s*$/i.test(g.context.trim()), "savings bank account table");

  const slabs: SavingsSlab[] = grid.rows.map((r) => {
    const value = rate(r[1] ?? "");
    if (value === null) throw new AdapterError(`unreadable savings rate "${r[1]}"`);
    const band = parseTmbBand(r[0] ?? "");
    return { balanceMin: band.min, balanceMax: band.max, rate: value, residency: "resident" as const };
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");

  // The savings table on this page carries no effective-date text of its own (unlike the FD and
  // bulk tables, which state "W.E.F ..." / "With effect from ..." in their own header cells).
  const card = makeCard(ctx, "savings", [], {
    effectiveFrom: null,
    savingsSlabs: slabs,
    slabMethod: "unknown",
    notes: ["No slab-method wording ('whole balance' vs 'incremental') found near this table, so slabMethod is left unknown rather than guessed.", "No effective-date text is printed for this table on the page, unlike the FD and bulk tables."],
  });
  return { cards: [card] };
};
