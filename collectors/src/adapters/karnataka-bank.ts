/**
 * Karnataka Bank — karnatakabank.bank.in
 * Pages covered: "Deposit Interest Rates" (domestic/NRO callable term deposits, retail and
 * bulk side by side in one table per customer type; a separate non-callable table that mixes
 * retail ₹2cr–<3cr and bulk ₹3cr–10cr/5cr in one grid) and "Savings Account Interest Rates".
 * Plain server-rendered HTML (no JS rendering needed); rates are present in the raw markup.
 *
 * Not covered here (out of scope for this task / no clean data): the minor deposit scheme
 * (a distinct customer type our domain model doesn't have), the KBL Tax Planner (5-year tax
 * saver), NRE/FCNR deposits, and RD — see the note above `karnatakaBankFd` for why RD is
 * skipped.
 *
 * Quirks worked around locally (kept out of the shared parsers on purpose):
 *  - The non-callable table's tenure label "Above 2 years to3  years" is missing the space
 *    between "to" and "3" (a markup slip on the bank's own page). `parseTenure` needs
 *    "to 3" to split a range, so `fixNonCallableTypos` inserts the missing space before the
 *    grid is handed to `parseTermTable`.
 *  - The same table prints the ₹3cr–<5cr senior/bulk rate for "556 days to 2 years" as
 *    "6,85" (a comma where every other cell on the page uses a period). 6.85 is also exactly
 *    the general rate (6.45) plus the bank's own stated +0.40% senior premium, so this is a
 *    typo, not an unknown value — `fixNonCallableTypos` corrects the punctuation instead of
 *    dropping the cell.
 *  - Amount bands written as "X up to Y" are inclusive of Y, so (matching the convention in
 *    `parse/amount.ts`) the exclusive `amountMax` we store is `Y + 1` rupee.
 */
import type { RateRow } from "../../../lib/domain";
import { findEffectiveDate } from "../parse/common";
import type { Grid } from "../parse/html-table";
import { extractTables, pageText } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const headerText = (g: Grid, rows = 2) => g.rows.slice(0, rows).flat().join(" | ");

/** The one table that combines general-public and senior-citizen columns: the non-callable grid. */
const isNonCallableGrid = (g: Grid) => /general public/i.test(headerText(g)) && /senior citizen/i.test(headerText(g));
/** The NRE table has the same shape as the domestic one; its heading is the last thing in its context. */
const isNreGrid = (g: Grid) => /nre rupee term deposits\s*$/i.test(g.context.trim());

/** Effective date from the heading text that actually precedes `anchor` — never "any date on the page". */
function dateNear(pageTxt: string, anchor: string, span = 220): string | null {
  const i = pageTxt.indexOf(anchor);
  if (i < 0) return null;
  return findEffectiveDate(pageTxt.slice(i, i + span));
}

/** See file header: fixes two verified typos on the non-callable table only. */
function fixNonCallableTypos(grid: Grid): Grid {
  return {
    ...grid,
    rows: grid.rows.map((row) => row.map((cell) => cell.replace(/\bto(\d)/i, "to $1").replace(/^(\d{1,2}),(\d{1,3})$/, "$1.$2"))),
  };
}

const RETAIL_MAX = 3 * CRORE; // "below ₹3 crore"
const GEN_BULK_MIN = 3 * CRORE;
const GEN_BULK_MAX = 10 * CRORE + 1; // "₹3 crore up to ₹10 crore" (inclusive)
const SR_BULK_MAX = 5 * CRORE + 1; // "₹3 crore up to ₹5 crore" (inclusive)
const NC_RETAIL_MIN = 2 * CRORE; // non-callable retail band starts at ₹2cr, not ₹0

/**
 * Retail FD card: general-public + senior-citizen callable rows (below ₹3cr), plus the
 * non-callable ₹2cr–<3cr rows (callable: false), matching how SBI's adapter treats its own
 * ₹1cr–<3cr non-callable band as part of the retail card.
 *
 * No RD card is produced: the RD page only says RDs "offer interest rates similar to FDs"
 * (marketing copy, not the bank stating the rates ARE equal) and has no rate-by-tenure table
 * of its own, so `deriveRdFromFd` would not be justified here. Re-confirmed live on
 * 2026-09-27 (https://www.karnatakabank.bank.in/personal/term-deposits/recurring-deposit):
 * zero <table> elements, and that same "similar to" wording (not "equal to") is still the
 * only mention of FD/RD rate parity on the page.
 */
export const karnatakaBankFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);

  const nonCallable = requireGrid(grids, isNonCallableGrid, "non-callable table (general public + senior citizen columns)");
  const generalCallable = requireGrid(grids, (g) => g !== nonCallable && !isNreGrid(g) && /up to ₹?\s*10\s*crore/i.test(headerText(g)), "domestic/NRO callable table, general public (bulk up to ₹10 crore)");
  const seniorCallable = requireGrid(grids, (g) => g !== nonCallable && !isNreGrid(g) && /up to ₹?\s*5\s*crore/i.test(headerText(g)), "domestic callable table, senior citizens (bulk up to ₹5 crore)");
  const fixedNonCallable = fixNonCallableTypos(nonCallable);

  const effectiveFrom = dateNear(text, "Fixed Deposit Interest Rate") ?? dateNear(text, "Domestic callable Fixed Deposit Interest Rates for senior citizens");
  if (!effectiveFrom) throw new AdapterError("effective date not found near the Fixed Deposit Interest Rate heading");

  const rows: RateRow[] = [
    ...parseTermTable(generalCallable, { columns: [{ header: /retail/i, customer: "general" }], amountMin: 0, amountMax: RETAIL_MAX, callable: true }),
    ...parseTermTable(seniorCallable, { columns: [{ header: /retail/i, customer: "senior" }], amountMin: 0, amountMax: RETAIL_MAX, callable: true }),
    ...parseTermTable(fixedNonCallable, { columns: [{ header: /general public/i, exclude: /rs\.3cr up to rs\.10cr/i, customer: "general" }], amountMin: NC_RETAIL_MIN, amountMax: RETAIL_MAX, callable: false }).map((r) => ({ ...r, note: "Non-callable (no premature withdrawal)" })),
    ...parseTermTable(fixedNonCallable, { columns: [{ header: /senior citizen/i, exclude: /rs\.3cr up to rs\.5cr/i, customer: "senior" }], amountMin: NC_RETAIL_MIN, amountMax: RETAIL_MAX, callable: false }).map((r) => ({ ...r, note: "Non-callable (no premature withdrawal)" })),
  ];

  const notes = [
    "The +0.25%/+0.40% senior-citizen premium and the ₹5 crore cap apply to domestic FD/ACC only, not NRE/NRO/FCNR(B) deposits (bank's own footnote).",
    'RD rates not published on the official site: the Recurring Deposit page only says RDs "offer interest rates similar to FDs" (marketing copy, not a statement that they ARE equal) and carries no rate-by-tenure table of its own.',
  ];

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.25% p.a. for 7 days to below 1 year, +0.40% p.a. for 1 year to 10 years (domestic FD/ACC only)",
        seniorPremiumCap: "₹5 crore (senior premium withdrawn above this on domestic callable deposits w.e.f. 1 Sep 2019)",
        prematurePenalty: "Below ₹2 crore: 0.50%; ₹2 crore to ₹25 crore: 1.00%; above ₹25 crore: nil — deducted from the applicable rate of interest",
        rdRules: "RD rates not published on the official site.",
      },
    ],
  };
};

/** Bulk FD card (₹3 crore and above): same two callable tables plus the non-callable ₹3cr+ rows. */
export const karnatakaBankBulk: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);

  const nonCallable = requireGrid(grids, isNonCallableGrid, "non-callable table (general public + senior citizen columns)");
  const generalCallable = requireGrid(grids, (g) => g !== nonCallable && !isNreGrid(g) && /up to ₹?\s*10\s*crore/i.test(headerText(g)), "domestic/NRO callable table, general public (bulk up to ₹10 crore)");
  const seniorCallable = requireGrid(grids, (g) => g !== nonCallable && !isNreGrid(g) && /up to ₹?\s*5\s*crore/i.test(headerText(g)), "domestic callable table, senior citizens (bulk up to ₹5 crore)");
  const fixedNonCallable = fixNonCallableTypos(nonCallable);

  const effectiveFrom = dateNear(text, "Fixed Deposit Interest Rate") ?? dateNear(text, "Domestic callable Fixed Deposit Interest Rates for senior citizens");
  if (!effectiveFrom) throw new AdapterError("effective date not found near the Fixed Deposit Interest Rate heading");

  const rows: RateRow[] = [
    ...parseTermTable(generalCallable, { columns: [{ header: /bulk/i, customer: "general" }], amountMin: GEN_BULK_MIN, amountMax: GEN_BULK_MAX, callable: true }),
    ...parseTermTable(seniorCallable, { columns: [{ header: /bulk/i, customer: "senior" }], amountMin: GEN_BULK_MIN, amountMax: SR_BULK_MAX, callable: true }),
    ...parseTermTable(fixedNonCallable, { columns: [{ header: /general public/i, exclude: /rs\.2cr/i, customer: "general" }], amountMin: GEN_BULK_MIN, amountMax: GEN_BULK_MAX, callable: false }).map((r) => ({ ...r, note: "Non-callable (no premature withdrawal)" })),
    ...parseTermTable(fixedNonCallable, { columns: [{ header: /senior citizen/i, exclude: /rs\.2cr/i, customer: "senior" }], amountMin: GEN_BULK_MIN, amountMax: SR_BULK_MAX, callable: false }).map((r) => ({ ...r, note: "Non-callable (no premature withdrawal)" })),
  ];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom })] };
};

/** Savings Bank Account rates: a single flat-per-slab table, no stated whole/incremental method. */
export const karnatakaBankSavings: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);
  const g = requireGrid(grids, (x) => /end-of-day balance/i.test(headerText(x)), "savings slabs table");
  const effectiveFrom = dateNear(text, "Interest rates on all Savings Bank accounts");
  if (!effectiveFrom) throw new AdapterError("effective date not found near the savings heading");

  const slabs = g.rows.slice(1).flatMap((r) => {
    const label = (r[1] ?? "").toLowerCase();
    const rateCell = r[2] ?? "";
    const rate = /^\d+(\.\d+)?$/.test(rateCell.trim()) ? Number(rateCell.trim()) : null;
    if (rate === null) return [];
    if (/up to and including/.test(label)) {
      const m = /₹\s*([\d.]+)\s*lakh/i.exec(label);
      if (!m) throw new AdapterError(`unexpected first savings slab label "${r[1]}"`);
      return [{ balanceMin: 0, balanceMax: Math.round(Number(m[1]) * 1e5) + 1, rate, residency: "resident" as const }];
    }
    const m = /above\s*₹\s*([\d.]+)\s*lakh\s*(?:[–-]\s*₹?\s*([\d.]+)\s*lakh)?/i.exec(label);
    if (!m) throw new AdapterError(`unexpected savings slab label "${r[1]}"`);
    const min = Math.round(Number(m[1]) * 1e5) + 1;
    const max = m[2] ? Math.round(Number(m[2]) * 1e5) + 1 : null;
    return [{ balanceMin: min, balanceMax: max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
