/**
 * Shivalik Small Finance Bank — shivalik.bank.in
 * Single page covered: the "Interest Rates" hub (Savings, FD/RD and NRI Fixed Deposits are
 * tabs on one page). The legacy domain shivalikbank.com returns 502 — use shivalik.bank.in.
 *
 * Quirks:
 *  - Every FD/RD/NRE/NRO table's <thead> declares `rowspan="3"` on the "Tenure Bucket"
 *    header cell even though the head only has two rows. `extractTables` faithfully
 *    reproduces the bank's own markup, which bleeds "Tenure Bucket" into column 0 of the
 *    first tbody row and pushes every real cell one column to the right — parseTermTable
 *    would then fail to read that one row's tenure. `fixHeaderRowspanOverflow` undoes the
 *    shift locally (a bank markup bug, not a bug in collectors/src/parse/html-table.ts).
 *  - The FD table's last row is "Tax saver FD 5 Years (60 months)" — the same table as the
 *    regular card, not a separate page. We split it out into its own `tax_saver` card.
 *  - Senior-citizen premium: the page states "+0.25% over the above card rates" — trust
 *    that (aggregators widely report 0.50%, which this page does not say).
 *  - No public bulk (≥₹3 crore) page was found ("please contact the nearest branch"), so no
 *    fd_bulk adapter is exported.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** See the module doc comment: undo the bank's own rowspan="3"-on-a-2-row-head markup bug. */
function fixHeaderRowspanOverflow(grid: Grid): Grid {
  const headWidth = grid.rows[0]?.length ?? 0;
  const idx = grid.rows.findIndex((r, i) => i > 0 && r[0] === grid.rows[0]?.[0] && r.length > headWidth);
  if (idx < 0) return grid;
  const rows = grid.rows.map((r, i) => (i === idx ? r.slice(1) : r));
  return { ...grid, rows };
}

const TAX_SAVER_RE = /tax saver/i;

export const shivalikFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = fixHeaderRowspanOverflow(
    requireGrid(grids, (g) => /FD\/RD/i.test(g.context) && /Fixed Deposits Rates \(With Premature-Withdrawal Facility\)/i.test(g.context) && !/non-callable/i.test(g.context), "callable FD table"),
  );
  const nonCallableGrid = fixHeaderRowspanOverflow(requireGrid(grids, (g) => /non-callable/i.test(g.context), "non-callable FD table"));

  const callableEffectiveFrom = parseDate(callableGrid.context);
  const nonCallableEffectiveFrom = parseDate(nonCallableGrid.context);
  if (!callableEffectiveFrom) throw new AdapterError("effective date not found next to the callable FD table");

  const allCallable = parseTermTable(callableGrid, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  const nonCallable = parseTermTable(nonCallableGrid, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: false,
  });

  const taxSaverRows = allCallable.filter((r) => TAX_SAVER_RE.test(r.tenureLabel));
  const fdRows: RateRow[] = [...allCallable.filter((r) => !TAX_SAVER_RE.test(r.tenureLabel)), ...nonCallable];

  const notes = ["Senior-citizen premium: the bank's own page states +0.25% over the card rate (some rate aggregators report 0.50% — that figure is not what this page says)."];
  if (nonCallableEffectiveFrom && nonCallableEffectiveFrom !== callableEffectiveFrom) {
    notes.push(`Non-callable table's own effective date (${nonCallableEffectiveFrom}) differs from the callable table's (${callableEffectiveFrom}) — both are read from their own headers, not assumed equal.`);
  }
  const cards = [makeCard(ctx, "fd", fdRows, { effectiveFrom: callableEffectiveFrom, notes })];
  if (taxSaverRows.length > 0) {
    cards.push(makeCard(ctx, "tax_saver", taxSaverRows, { effectiveFrom: callableEffectiveFrom, notes: ["5-year (60-month) lock-in row from the same FD table; max ₹1,50,000 per PAN per financial year (u/s 80C)."] }));
  }
  return {
    cards,
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.25% over the card rate", prematurePenalty: "1% of the interest earned for the period held" }],
  };
};

export const shivalikRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = fixHeaderRowspanOverflow(requireGrid(grids, (g) => /Recurring.*Deposit Rates/i.test(g.context), "RD table"));
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the RD table");
  const rows = parseTermTable(grid, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: null,
    callable: true,
  });
  return {
    cards: [makeCard(ctx, "rd", rows, { effectiveFrom, notes: ["RD is the bank's own recurring-deposit card (different tenure buckets from FD), not derived from it."] })],
    terms: [{ product: "rd", seniorPremium: "+0.25% over the card rate", prematurePenalty: "1% of the interest earned for the period held" }],
  };
};

/** "Up to 1 Lacs" / "Above 1 Lac to 5 Lacs" / "Above 10 Lacs to 10 Crore". */
function savingsBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  if (/^up to/i.test(t) && nums.length === 1) return { min: 0, max: nums[0] + 1 };
  if (/^above/i.test(t) && nums.length === 2) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (/^above/i.test(t) && nums.length === 1) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`cannot read savings slab "${label}"`);
}

export const shivalikSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /Domestic,\s*NRO\s*&\s*NRE Savings Account/i.test(g.context), "savings table");
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the savings table");
  const slabs: SavingsSlab[] = [];
  for (const row of grid.rows.slice(2)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const rate = parseRate(row[1] ?? "");
    if (rate === null) continue;
    const band = savingsBand(label);
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident", note: label });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return {
    cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "incremental", notes: ["Above ₹10 crore: bank says 'please contact the nearest branch' — no published rate."] })],
  };
};
