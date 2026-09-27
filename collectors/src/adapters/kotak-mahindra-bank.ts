/**
 * Kotak Mahindra Bank — kotak.bank.in (kotak.com redirects here: confirmed live via browser
 * navigation on 2026-09-27, https://www.kotak.com/en/rates/interest-rates.html -> 302s to
 * https://www.kotak.bank.in/en/rates/interest-rates.html, so the canonical URL registered in
 * data/sources is the .bank.in one)
 * Page: "Interest Rates" (one page covering savings, domestic/NRO/NRE FD — both premature-
 * withdrawal-allowed and not-allowed, each split into a retail+first-bulk-tier table and a
 * higher-bulk-tier table — Recurring Deposit, and FCNR, plus two premature-withdrawal
 * penalty tables).
 *
 * Sandbox note: kotak.com and kotak.bank.in return HTTP 403 to a plain fetch from this
 * sandbox (Cloudflare bot-management challenge — the response carries a `__cf_bm` cookie —
 * even though robots.txt allows crawlers, including ClaudeBot/GPTBot by name). This fixture
 * was captured with a real headless browser (which was NOT blocked), so it is genuine,
 * current official content, not an aggregator copy. Re-verified live on 2026-09-27 via the
 * browser tool: the page's own "Fixed Deposits Interest Rates for Domestic/ NRO / NRE
 * effective from 23rd Sep 2026" and "Recurring Deposit rates effective from 23rd Sep 2026"
 * captions, and the 7-14 day retail rate cells (2.75% general / 3.25% senior), are byte-for-
 * byte identical to this fixture — no rate drift since it was captured. Keep the source
 * active — GitHub Actions or a VPS may not be blocked — and set format "browser" since a
 * plain HTTP fetch won't get past the WAF either way.
 *
 * RD: Kotak publishes its own explicit Recurring Deposit rate table (own tenure buckets, own
 * general/senior columns) — read directly, not derived from the FD card.
 *
 * Layout: all the FD/RD tables here use a repeated caption row (via a `colspan` far larger
 * than the real column count, e.g. `colspan="11"` on a 5- or 6-column table) as their only
 * "title". Two of the tables share the *exact same* caption text ("Fixed Deposits Interest
 * Rates for Domestic/ NRO / NRE effective from ... - PREMATURE WITHDRAWAL ALLOWED" applies
 * to both the retail+first-bulk-tier table and the higher-bulk-tier table), so tables are
 * told apart by which amount bands their header row actually names, not by caption text.
 * Each is walked by fixed column position rather than through `parseTermTable`, because two
 * of them repeat adjacent amount tiers whose header text overlaps (e.g. "...Rs.100 Cr...Rs.
 * 300 Cr..." is the upper bound of one tier and the lower bound of the next), which a single
 * per-column header regex can't disambiguate.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { findEffectiveDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

const CAPTION_ALLOWED = /premature withdrawal allowed/i;
const CAPTION_NOT_ALLOWED = /premature withdrawal not allowed/i;
const RETAIL_MAX = 3 * CRORE;

/** The two FD tables with a "Regular"/"Senior Citizen*" grouping row, split by retail vs bulk amount band. */
function isRegularSeniorGrid(g: ReturnType<typeof extractTables>[number]): boolean {
  return /regular/i.test(headerText(g, 3)) && /senior citizen/i.test(headerText(g, 3));
}

/** "Premature Withdrawal Allowed/Not Allowed" is printed in the table's own header row, not in the
 * page text before it (which, for the second table of a pair, is often the disclaimer paragraph
 * instead of the shared heading two tables back). */
function isAllowedGrid(g: ReturnType<typeof extractTables>[number]): boolean {
  return CAPTION_ALLOWED.test(headerText(g, 3));
}
function isNotAllowedGrid(g: ReturnType<typeof extractTables>[number]): boolean {
  return CAPTION_NOT_ALLOWED.test(headerText(g, 3));
}

function buildRows(
  grid: ReturnType<typeof extractTables>[number],
  headerRows: number,
  cols: Array<{ idx: number; customer: CustomerType; amountMin: number; amountMax: number | null; callable: boolean }>,
): RateRow[] {
  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(headerRows)) {
    const label = row[0] ?? "";
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read Kotak tenure "${label}"`);
    for (const c of cols) {
      const rate = parseRate(row[c.idx] ?? "");
      if (rate === null) continue; // "NA": this tier/tenure combination isn't offered
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: c.amountMin,
        amountMax: c.amountMax,
        customer: c.customer,
        residency: "resident",
        callable: c.callable,
        payout: null,
        rate,
        note: c.callable ? undefined : "Non-callable (no premature withdrawal)",
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("Kotak FD table produced no rows");
  return rows;
}

export const kotakFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retailGrid = requireGrid(grids, (g) => isRegularSeniorGrid(g) && isAllowedGrid(g), "retail + first bulk-tier table (Regular/Senior columns)");
  const effectiveFrom = findEffectiveDate(retailGrid.rows[0]?.[0] ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the FD table's own caption row");

  // Columns (after the tenure column): Regular <3cr, Regular 3-5cr, Senior <3cr, Senior 3-5cr.
  const rows = buildRows(retailGrid, 3, [
    { idx: 1, customer: "general", amountMin: 0, amountMax: RETAIL_MAX, callable: true },
    { idx: 3, customer: "senior", amountMin: 0, amountMax: RETAIL_MAX, callable: true },
  ]);
  const notes = [
    "Senior-citizen rate does not apply to NRO/NRE deposits (bank's own note).",
    "ActivMoney (2-way sweep) deposits earn the Regular rate for every customer, including senior citizens (bank's own note) — not reflected here since no separate ActivMoney table is published.",
  ];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. on deposits below ₹3 crore only (not on ₹3–5cr, NRO/NRE, ActivMoney or non-callable deposits)",
        seniorPremiumCap: "₹3 crore (no published senior premium at or above this; acceptance of deposits of ₹5cr and above is at the Bank's discretion)",
        prematurePenalty: "Callable deposits: nil below 181 days, then either a flat 0.50% (older booking) or a 0.50%/1.00% two-tier schedule at 181–364 / 365+ days (two penalty tables are printed; the page does not date which applies to a given deposit).",
      },
    ],
  };
};

export const kotakBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retailGrid = requireGrid(grids, (g) => isRegularSeniorGrid(g) && isAllowedGrid(g), "retail + first bulk-tier table (Regular/Senior columns)");
  const higherAllowedGrid = requireGrid(grids, (g) => !isRegularSeniorGrid(g) && isAllowedGrid(g), "higher bulk-tier table (5cr-300cr+, premature allowed)");
  const notAllowedGrid = requireGrid(grids, isNotAllowedGrid, "non-callable bulk table (3cr-300cr+, premature not allowed)");

  const effectiveFrom = findEffectiveDate(retailGrid.rows[0]?.[0] ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the FD table's own caption row");

  const rows: RateRow[] = [
    // First bulk tier (₹3-5cr), callable, from the Regular/Senior table.
    ...buildRows(retailGrid, 3, [
      { idx: 2, customer: "general", amountMin: 3 * CRORE, amountMax: 5 * CRORE, callable: true },
      { idx: 4, customer: "senior", amountMin: 3 * CRORE, amountMax: 5 * CRORE, callable: true },
    ]),
    // Higher bulk tiers (₹5cr-300cr+), callable, general public only (no senior column published).
    ...buildRows(higherAllowedGrid, 2, [
      { idx: 1, customer: "general", amountMin: 5 * CRORE, amountMax: 10 * CRORE, callable: true },
      { idx: 2, customer: "general", amountMin: 10 * CRORE, amountMax: 25 * CRORE, callable: true },
      { idx: 3, customer: "general", amountMin: 25 * CRORE, amountMax: 100 * CRORE, callable: true },
      { idx: 4, customer: "general", amountMin: 100 * CRORE, amountMax: 300 * CRORE, callable: true },
      { idx: 5, customer: "general", amountMin: 300 * CRORE, amountMax: null, callable: true },
    ]),
    // Non-callable bulk tiers (₹3cr-300cr+), general public only; many cells are "NA" (skipped).
    ...buildRows(notAllowedGrid, 2, [
      { idx: 1, customer: "general", amountMin: 3 * CRORE, amountMax: 5 * CRORE, callable: false },
      { idx: 2, customer: "general", amountMin: 5 * CRORE, amountMax: 10 * CRORE, callable: false },
      { idx: 3, customer: "general", amountMin: 10 * CRORE, amountMax: 25 * CRORE, callable: false },
      { idx: 4, customer: "general", amountMin: 25 * CRORE, amountMax: 100 * CRORE, callable: false },
      { idx: 5, customer: "general", amountMin: 100 * CRORE, amountMax: 300 * CRORE, callable: false },
      { idx: 6, customer: "general", amountMin: 300 * CRORE, amountMax: null, callable: false },
    ]),
  ];
  const notes = ["No senior-citizen premium is published for bulk (≥₹5cr) or non-callable deposits (bank's own notes)."];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes })] };
};

export const kotakRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /recurring deposit rates/i.test(g.rows[0]?.[0] ?? ""), "Recurring Deposit rate table");
  const effectiveFrom = findEffectiveDate(grid.rows[0]?.[0] ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the RD table's own caption row");
  const rows = buildRows(grid, 2, [
    { idx: 1, customer: "general", amountMin: 0, amountMax: null, callable: true },
    { idx: 2, customer: "senior", amountMin: 0, amountMax: null, callable: true },
  ]);
  return { cards: [makeCard(ctx, "rd", rows, { effectiveFrom, notes: ["Read from Kotak's own Recurring Deposit rate table (not derived from the FD card)."] })] };
};

export const kotakSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /savings bank a\/c/i.test(g.rows[0]?.[0] ?? ""), "Savings Bank A/c table");
  const domestic = grid.rows.find((r) => /^a\.\s*domestic/i.test(r[0] ?? ""));
  const nonResident = grid.rows.find((r) => /^b\.\s*non resident/i.test(r[0] ?? ""));
  if (!domestic || !nonResident) throw new AdapterError("Domestic / Non-Resident savings rows not found");
  const effectiveFrom = findEffectiveDate(domestic[0]);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings row");
  const domesticRate = parseRate(domestic[1] ?? "");
  const nonResidentRate = parseRate(nonResident[1] ?? "");
  if (domesticRate === null || nonResidentRate === null) throw new AdapterError("savings rate not found");
  const slabs = [
    { balanceMin: 0, balanceMax: null, rate: domesticRate, residency: "resident" as const },
    { balanceMin: 0, balanceMax: null, rate: nonResidentRate, residency: "nre" as const },
    { balanceMin: 0, balanceMax: null, rate: nonResidentRate, residency: "nro" as const },
  ];
  const notes = ["A separate floating-rate slab applies only above ₹1,000 crore (MIBOR + 101 bps, effective 6th April 2026) — not included above as it has no fixed percentage to publish."];
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "whole", notes })] };
};
