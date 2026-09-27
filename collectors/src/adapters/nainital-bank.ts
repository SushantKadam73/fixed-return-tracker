/**
 * Nainital Bank — nainitalbank.bank.in
 * Page: "Interest Rate" (one page covering savings and domestic term deposits; the bank
 * publishes no separate bulk-deposit card and no explicit RD rate table).
 *
 * Note on the URL: the deep .aspx pages the earlier research pass tried (e.g.
 * English/interest_rate.aspx) redirect a plain HTTP client AND a real browser to the
 * homepage shell — those paths are genuinely retired, not a bot block. The bank's current
 * site exposes the same content at /en/pages/interest-rate, which returns 200 with the rates
 * already in the raw HTML (no JS rendering needed) both to a plain fetch and to a browser.
 *
 * RD: skipped. The Recurring Deposit page only says rates are "as fixed by the Bank from
 * time to time" (no equality-to-FD statement and no table of its own), so `deriveRdFromFd`
 * would not be justified. Re-confirmed live on 2026-09-27 (https://www.nainitalbank.bank.in/
 * en/recurring-deposit-account): zero <table> elements, and that exact sentence is still the
 * only statement about rates on the page.
 * Bulk: skipped. No amount qualifier (e.g. "below ₹3 crore") appears anywhere on this table,
 * and no separate bulk card is published, so the one ladder here is read as the general "fd"
 * card with no amount cap, and no fd_bulk card is produced.
 * Senior citizens: this table has no senior-citizen column for term deposits (only the
 * savings-account rows above it split Normal/Senior, and both are 2.65% anyway), so no
 * senior FD rows or seniorPremium term are published here.
 *
 * Quirks worked around locally (kept out of the shared parsers on purpose):
 *  - Several tenure labels wrap numbers in stray hyphens, e.g. "-1- year", "Above-5- years",
 *    "–5-" (en dash) — a page rendering glitch, not a unit change. `normaliseTenureLabel`
 *    strips the decorative hyphens (" 1 ", " 5 ") before `parseTenure` sees the label;
 *    without this fix one row parses to a silently wrong range instead of failing loudly.
 *  - The FD table prints "Existing" and "Revised" columns side by side (two dates, like
 *    SBI's revised-vs-existing columns) — only the Revised column is read.
 *  - "Naini Tax Saver Scheme*" is listed in the same ladder but its 5-year tenor is never
 *    stated on this row (unlike "Naini Samriddhi - 444 Days", whose tenure is spelled out in
 *    its own label), so it is skipped rather than assigned a guessed tenure.
 */
import type { RateRow } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, makeCard, requireGrid } from "./helpers";

/** See file header: turns "-1- year", "Above-5- years", "–5-" into plain " 1 ", "Above 5", " 5 ". */
function normaliseTenureLabel(label: string): string {
  return label
    .replace(/[-–—]\s*(\d+)\s*[-–—]/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export const nainitalBankFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /deposit interest rates/i.test(g.context), "the combined savings/term-deposit rate table");
  const start = grid.rows.findIndex((r) => /term deposits\s*\(all maturities\)/i.test(r[0] ?? ""));
  if (start < 0) throw new AdapterError('"Term Deposits (All Maturities)" header row not found');
  const effectiveFrom = findEffectiveDate(grid.rows[start].find((c) => /revised/i.test(c)) ?? "");
  if (!effectiveFrom) throw new AdapterError('effective date not found in the "Revised" column header');

  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(start + 1)) {
    const label = cleanText(row[0] ?? "");
    if (!label || /non-resident accounts/i.test(label)) break; // end of the domestic term-deposit ladder
    if (/tax saver/i.test(label)) continue; // no tenure stated for this scheme on this table (see file header)
    const tenure = parseTenure(normaliseTenureLabel(label));
    if (!tenure) throw new AdapterError(`cannot read tenure "${label}"`);
    // Revised-column value is duplicated across its colspan; column 6 is always inside that span.
    const rate = parseRate(row[6] ?? row[7] ?? "");
    if (rate === null) continue; // "--": no revised rate published for this row
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
      schemeName: tenure.minDays === 444 ? "Naini Samriddhi" : undefined,
      amountMin: 0,
      amountMax: null,
      customer: "general",
      residency: "resident",
      callable: true,
      payout: null,
      rate,
    });
  }
  if (rows.length === 0) throw new AdapterError("term-deposit ladder produced no rows");
  const notes = [
    "No amount band is printed for this ladder (no separate bulk card is published) and no senior-citizen column applies to term deposits on this table.",
    'RD rates not published on the official site: the Recurring Deposit product page states only "The rates of interest are as fixed by the Bank from time to time" — no table and no FD-rate-parity statement.',
  ];
  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes })],
    terms: [{ product: "fd", rdRules: "RD rates not published on the official site." }],
  };
};

export const nainitalBankSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /interest rate on saving bank deposit/i.test(g.rows[0]?.[0] ?? ""), "the savings account rate table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError('effective date not found near the "Saving Bank Account Interest Rate" label');
  const rate = parseRate(grid.rows[0]?.[1] ?? "");
  if (rate === null) throw new AdapterError("savings rate not found");
  const slabs = [{ balanceMin: 0, balanceMax: null, rate, residency: "resident" as const }];
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
