/**
 * City Union Bank — cityunionbank.bank.in (legacy cityunionbank.com is still independently live
 * and byte-identical, per the survey; this adapter targets the new .bank.in domain per the
 * group's instructions).
 * Page covered: "Deposit Interest Rate" (deposit-interest-rate) — a single page holding
 * savings, domestic/NRO callable and non-callable retail term deposits, and domestic/NRO bulk
 * deposits (Callable and "CUB Deposit PLUS" non-callable), each ≥ ₹3 crore. NRE-only tables are
 * out of scope for this tracker and are skipped.
 *
 * Every table on this page has the same shape: a full-width caption row, then a full-width
 * "From DD-MM-YYYY" row, then the real header/data rows — so effective dates are read straight
 * off each table's own row 1 (captionDate() below), not from surrounding page text.
 *
 * Quirk handled here: the "Domestic/NRO Rupee Term deposits of Rs.3.00 Cr (Bulk Deposit) and
 * above" caption and its "From DATE" row are, on this page, a separate two-row `<table>` from
 * the actual "Callable Bulk Deposit" / "Non Callable Bulk Deposit-CUB Deposit PLUS" data table
 * that immediately follows it (the caption's own `</table>` closes before the data table opens —
 * a markup quirk on the bank's page, not this adapter's doing). extractTables() therefore
 * returns them as two separate grids with no shared context, so findCubBulkTables() below pairs
 * each caption/date marker grid with the very next grid in document order instead of relying on
 * Grid.context.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { parseAmountBand } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

/** Every table's row 1 is a full-width "From DD-MM-YYYY" cell. */
function captionDate(grid: Grid): string | null {
  return parseDate(cleanText(grid.rows[1]?.[0] ?? ""));
}

export const cubFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = requireGrid(grids, (g) => /domestic\/nro callable term deposit/i.test(headerText(g, 1)), "domestic callable term-deposit table");
  const nonCallableGrid = grids.find((g) => /non-callable deposit above 1 cr and below 3 cr/i.test(headerText(g, 1)) && !/nre/i.test(headerText(g, 1)));

  const effectiveFrom = captionDate(callableGrid);
  if (!effectiveFrom) throw new AdapterError("CUB FD: effective date not found in the callable table's caption row");

  const columns = [
    { header: /general/i, customer: "general" as CustomerType },
    { header: /senior citizen/i, customer: "senior" as CustomerType, exclude: /super senior/i },
    { header: /super senior/i, customer: "super_senior" as CustomerType },
  ];
  const rows = parseTermTable(callableGrid, {
    columns,
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    skipRow: /tax saver/i, // fixed 5-year statutory scheme, not a plain tenure row; out of scope here
  });

  const notes: string[] = [];
  if (nonCallableGrid) {
    const nonCallableDate = captionDate(nonCallableGrid);
    if (nonCallableDate && nonCallableDate !== effectiveFrom) {
      notes.push(`Non-callable ₹1-3cr table is dated ${nonCallableDate}, different from the callable table's ${effectiveFrom}; both are included, dated as printed.`);
    }
    rows.push(
      ...parseTermTable(nonCallableGrid, {
        columns,
        amountMin: 1 * CRORE,
        amountMax: 3 * CRORE,
        callable: false,
      }),
    );
  } else {
    notes.push("Non-callable ₹1-3cr table not found on this page/fixture; only callable rows are published in this card.");
  }

  return { cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes: notes.length ? notes : undefined })] };
};

/** Domestic bulk tables: a "Period" header row, then a row of amount-band labels (its own
 * first cell is blank), then data rows. No senior/super-senior columns here. */
function parseCubBulkDataGrid(grid: Grid, callable: boolean): RateRow[] {
  const periodIdx = grid.rows.findIndex((r) => /^period$/i.test(cleanText(r[0] ?? "")));
  if (periodIdx < 0) throw new AdapterError('CUB bulk table: no header row starting with "Period"');
  const bandRow = grid.rows[periodIdx + 1];
  if (!bandRow) throw new AdapterError("CUB bulk table: amount-band row not found after the Period header");
  const bands = bandRow.slice(1).map((h) => ({ label: cleanText(h), band: parseAmountBand(h) }));
  const bad = bands.find((b) => b.label && !b.band);
  if (bad) throw new AdapterError(`CUB bulk table: cannot read amount-band header "${bad.label}"`);
  const validBands = bands.filter((b) => b.band);

  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(periodIdx + 2)) {
    const label = cleanText(r[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`CUB bulk table: cannot read tenor "${label}"`);
    for (const b of validBands) {
      const colIdx = bands.indexOf(b);
      const rate = parseRate(r[colIdx + 1] ?? "");
      if (rate === null) continue; // "--" = not offered for this band/tenure combination
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: b.band!.min,
        amountMax: b.band!.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("CUB bulk table produced no rows");
  return rows;
}

/**
 * Pairs each "Domestic/NRO Rupee Term deposits of Rs.3.00 Cr (Bulk Deposit) and above" marker
 * grid (caption + "From DATE", its own tiny table) with the very next grid — the actual
 * "Callable Bulk Deposit" or "Non Callable Bulk Deposit-CUB Deposit PLUS" data table — because
 * the page's markup closes the marker's `<table>` before opening the data table's, so
 * Grid.context does not bridge them (see the file header comment).
 */
function findCubBulkTables(grids: Grid[]): { callable?: { date: string | null; data: Grid }; nonCallable?: { date: string | null; data: Grid } } {
  const out: { callable?: { date: string | null; data: Grid }; nonCallable?: { date: string | null; data: Grid } } = {};
  for (let i = 0; i < grids.length - 1; i++) {
    const marker = headerText(grids[i], 1);
    if (!/domestic\/nro rupee term deposits.*bulk deposit.*and above/i.test(marker)) continue;
    const dataCaption = headerText(grids[i + 1], 1);
    const date = captionDate(grids[i]);
    if (/non[\s-]*callable/i.test(dataCaption)) out.nonCallable = { date, data: grids[i + 1] };
    else if (/callable/i.test(dataCaption)) out.callable = { date, data: grids[i + 1] };
  }
  return out;
}

export const cubBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const { callable, nonCallable } = findCubBulkTables(grids);
  if (!callable && !nonCallable) throw new AdapterError("CUB bulk: neither Callable nor Non-Callable domestic bulk table was found");

  const rows: RateRow[] = [];
  const dates: string[] = [];
  if (callable) {
    rows.push(...parseCubBulkDataGrid(callable.data, true));
    if (callable.date) dates.push(callable.date);
  }
  if (nonCallable) {
    rows.push(...parseCubBulkDataGrid(nonCallable.data, false));
    if (nonCallable.date) dates.push(nonCallable.date);
  }
  const effectiveFrom = dates.sort().at(-1) ?? null;
  if (!effectiveFrom) throw new AdapterError("CUB bulk: effective date not found for either table");

  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: ["No senior-citizen column is published for bulk deposits; Callable and 'CUB Deposit PLUS' (non-callable) are two separate tables with the same 7 amount bands (₹3cr-<5cr through ₹100cr+)."],
      }),
    ],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, other: ["Bulk deposits are accepted only with prior permission from the bank's Treasury Department (bank's own note)."] }],
  };
};

export const cubSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /savings account/i.test(headerText(g, 1)), "savings table");
  const effectiveFrom = captionDate(grid);
  const headerIdx = grid.rows.findIndex((r) => /day end balance/i.test(cleanText(r[0] ?? "")));
  if (headerIdx < 0) throw new AdapterError('CUB savings: header row "Day End Balance" not found');
  const slabs = grid.rows.slice(headerIdx + 1).flatMap((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = parseRate(r[1] ?? "");
    if (!label || rate === null) return [];
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`CUB savings: cannot read balance slab "${label}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("CUB savings: no balance slabs found");
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        // The page does not say whether a slab's rate applies to the whole balance or only the
        // incremental portion above the previous slab, so this cannot be stated either way.
        slabMethod: "unknown",
      }),
    ],
  };
};
