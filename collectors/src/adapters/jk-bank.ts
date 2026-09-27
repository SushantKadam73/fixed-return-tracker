/**
 * Jammu & Kashmir Bank (J&K Bank) — jkb.bank.in
 * Page: "Interest Rates" — one page with tabs for Savings Bank Deposits, Domestic Term
 * Deposits (retail <₹3cr, "Withdrawable"/callable ₹3cr–<5cr, "Non-Withdrawable"/non-callable
 * ₹3cr–<5cr, and a single-tenure non-callable ₹1cr–<3cr tier), Loans/MCLR, and NRI/FCNR
 * deposits. Only the savings and domestic-term-deposit tabs are used here.
 *
 * SANDBOX / NETWORK NOTE: jkb.bank.in (and the legacy jkbank.com) cannot be reached from this
 * sandbox at all — a direct fetch times out (curl, 45s, no response) and a real headless
 * browser gets a network-level `chrome-error://chromewebdata/` on the same URL, so this is a
 * connectivity failure, not a captcha/WAF block. Per the project's rule for unreachable pages,
 * the fixture is a genuine copy from the Internet Archive's unmodified snapshot instead of a
 * live fetch or browser capture:
 *   https://web.archive.org/web/20260415043804id_/https://jkb.bank.in/interest-rates
 * (capture 2026-04-15T04:38:04Z; that snapshot's own footer says "Last Updated: 13/04/2026",
 * and its tables are themselves dated "w.e.f February 11, 2026" / "w.e.f December 11, 2025" —
 * i.e. this fixture is already ~5.5 months stale relative to today by the nature of being an
 * archived copy of an unreachable page. GitHub Actions or a VPS on a different network path may
 * reach the live page and get current rates — see data/sources/fragments/c1.json.
 *
 * Not covered (would need data this session couldn't fetch, so nothing is guessed):
 *  - Bulk tiers ≥ ₹5 crore ("Bulk Deposit Rates Callable & Non Callable" on the same page is
 *    not an inline table but a "Click here to download" link to
 *    https://eapp.jkbank.com/eintraweb/domestic-rates — an internal-looking host ("eapp"/
 *    "intraweb"), not a page this adapter can fetch).
 *  - NRI-specific FCNR(B)/RFC rates, and the Loans/MCLR tables on the same page — different
 *    products, out of scope here.
 *  - Senior citizen / super senior / staff numeric FD rates — the page states these only as
 *    additive text ("+0.50%" senior, "+0.25%" super senior on top of that, "+1%" staff, none
 *    applicable to NRE/NRO), never as its own rate column, so no senior RateRow is produced;
 *    the additive facts are recorded in `terms` instead.
 *  - RD: no recurring-deposit table or rate-parity statement is on this page (or anywhere else
 *    findable from the site's own nav) — RD rates are not published on the official site.
 */
import type { RateRow } from "../../../lib/domain";
import { findEffectiveDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const RETAIL_CONTEXT = /less than rs\.?\s*3\.00\s*crore/i;
const BULK_5CR_CONTEXT = /3\.00\s*crore to less than\s*5\.00\s*crore/i;
const NON_WITHDRAWABLE = /non-withdrawable/i;
/** The single-tenure ₹1cr–<3cr non-callable tier — the only table whose heading names ₹1.00 crore. */
const NC_1_3CR_CONTEXT = /above\s*1\.00\s*crores?\s*to\s*less than\s*3\.00\s*crores?/i;

const SENIOR_STAFF_NOTES = [
  "Senior citizens (60+) get +0.50% p.a. across all maturities; super senior citizens (80+) get a further +0.25% over the senior rate; staff get +1%. None of these premiums are published as numbers, so only the general rate is shown, and none apply to NRE/NRO deposits (bank's own notes).",
  "RD rates not published on the official site: no recurring-deposit rate table or FD-rate-parity statement appears on this page or elsewhere on jkb.bank.in that could be found this session.",
];

export const jkBankFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retailGrid = requireGrid(grids, (g) => RETAIL_CONTEXT.test(g.context), "domestic term deposit table (below ₹3 crore)");
  const effectiveFrom = findEffectiveDate(retailGrid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the retail table's lead-in text");

  const rows: RateRow[] = parseTermTable(retailGrid, {
    columns: [{ header: /revised roi/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  // Single-tenure non-callable ₹1cr–<3cr tier, still below the ₹3cr bulk threshold so part of
  // the retail card (like Karnataka Bank's ₹2cr–<3cr non-callable band). Its own "w.e.f" date
  // (11 Dec 2025) differs from the rest of this card (see file header), so it is flagged on the
  // row rather than changing the card's overall `effectiveFrom`.
  const ncGrid = requireGrid(grids, (g) => NC_1_3CR_CONTEXT.test(g.context), "non-callable ₹1cr–<3cr single-tenure table");
  const ncDate = findEffectiveDate(ncGrid.context);
  if (!ncDate) throw new AdapterError("effective date not found in the ₹1cr–<3cr non-callable table's lead-in text");
  const ncRows = parseTermTable(ncGrid, {
    columns: [{ header: /revised roi/i, customer: "general" }],
    amountMin: CRORE,
    amountMax: 3 * CRORE,
    callable: false,
  }).map((r) => ({ ...r, note: `Non-callable (no premature withdrawal). Effective from ${ncDate} (this tier is revised separately from the rest of this card, which is effective from ${effectiveFrom}).` }));
  rows.push(...ncRows);

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes: SENIOR_STAFF_NOTES });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. across all maturities (not on NRE/NRO deposits)",
        superSeniorPremium: "+0.25% over the senior rate for 80+ (not on NRE/NRO deposits)",
        other: ["Staff: +1% p.a. across all maturities (not on NRE/NRO deposits)."],
        rdRules: "RD rates not published on the official site.",
      },
    ],
  };
};

export const jkBankBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = requireGrid(grids, (g) => BULK_5CR_CONTEXT.test(g.context) && !NON_WITHDRAWABLE.test(g.context), "withdrawable (callable) term deposit table (₹3cr to <₹5cr)");
  const nonCallableGrid = requireGrid(grids, (g) => BULK_5CR_CONTEXT.test(g.context) && NON_WITHDRAWABLE.test(g.context), "non-withdrawable (non-callable) term deposit table (₹3cr to <₹5cr)");

  const effectiveFrom = findEffectiveDate(callableGrid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the withdrawable bulk table's lead-in text");
  const ncEffectiveFrom = findEffectiveDate(nonCallableGrid.context);
  if (!ncEffectiveFrom) throw new AdapterError("effective date not found in the non-withdrawable bulk table's lead-in text");

  const rows: RateRow[] = [
    ...parseTermTable(callableGrid, { columns: [{ header: /revised roi/i, customer: "general" }], amountMin: 3 * CRORE, amountMax: 5 * CRORE, callable: true }),
    ...parseTermTable(nonCallableGrid, { columns: [{ header: /revised roi/i, customer: "general" }], amountMin: 3 * CRORE, amountMax: 5 * CRORE, callable: false }).map((r) => ({
      ...r,
      note: `Non-callable (no premature withdrawal)${ncEffectiveFrom !== effectiveFrom ? `. Effective from ${ncEffectiveFrom}` : ""}.`,
    })),
  ];
  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: ["Only the ₹3cr–<₹5cr tier is covered; further bulk tiers (₹5cr and above) are behind a download link to an internal-looking host (eapp.jkbank.com) that this session could not fetch."],
      }),
    ],
  };
};

export const jkBankSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /rate of interest per annum/i.test(g.rows[0]?.[1] ?? ""), "savings deposit rate table");
  const effectiveFrom = findEffectiveDate(grid.rows[0]?.[1] ?? "");
  if (!effectiveFrom) throw new AdapterError('effective date not found in the "Rate of Interest Per Annum" column header');
  const row = grid.rows.find((r) => /domestic\/nro\/\s*nre rupee savings/i.test(r[0] ?? ""));
  const rate = row ? parseRate(row[1] ?? "") : null;
  if (rate === null) throw new AdapterError("savings rate not found");
  const slabs = [{ balanceMin: 0, balanceMax: null, rate, residency: "resident" as const }];
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
