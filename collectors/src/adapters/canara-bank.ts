/**
 * Canara Bank — canarabank.bank.in (canarabank.com redirects here)
 *
 * Pages covered:
 *  - "TERM DEPOSITS-Rate of Interest (%) p.a." — domestic retail <3cr (General/Senior x
 *    Callable/Non-Callable, incl. the 444/555-day named tenures) AND the "Canara Retail Green
 *    Deposits" (1111/2222/3333 days) AND the bulk ≥3cr slabs (callable + non-callable, up to
 *    "Above 1000 Crore"), all on this one page.
 *  - "Domestic/NRO/NRE Savings Bank Deposits".
 *
 * Shared-parser gap (worked around locally, not fixed in parse/html-table.ts): the domestic
 * General Public / Senior Citizen table is never returned by `extractTables`. The page's own
 * markup nests it (along with the NRE/NRO and Green Deposit tables) inside one large `<table>`
 * wrapper — `extractTables` deliberately skips any `<table>` that itself contains a nested
 * `<table>`, on the reasonable assumption that such a table is CMS layout scaffolding, not data.
 * That assumption is wrong just for this one wrapper: the domestic rate rows sit directly in
 * it, not only in the genuinely-separate tables nested inside it (which HTML's own quirky
 * table-parsing rules apparently folded into one DOM node here). Rather than change that
 * heuristic for every bank, this file finds the domestic table itself — by its `<th>` reading
 * exactly "General Public" — and flattens its rows with a local copy of the same rowspan/colspan
 * logic `extractTables` uses (see `domesticRows` below), stopping before the row where the
 * (separately, correctly extracted) NRE/NRO section begins.
 *
 * No super-senior column is printed anywhere on this page.
 */
import * as cheerio from "cheerio";
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, makeCard, requireGrid } from "./helpers";

/** Local equivalent of `extractTables`'s per-table row flattening — see file header note. */
function domesticRows(html: string): string[][] {
  const $ = cheerio.load(html);
  const anchor = $("th")
    .filter((_, el) => $(el).text().trim() === "General Public")
    .first();
  if (anchor.length === 0) throw new AdapterError("canara-bank: domestic 'General Public' header not found — layout may have changed");
  const table = anchor.closest("table");
  if (table.length === 0) throw new AdapterError("canara-bank: domestic table ancestor not found");

  const pending: Array<{ row: number; col: number; text: string }> = [];
  const rows: string[][] = [];
  let stopped = false;
  table.find("tr").each((r, tr) => {
    if (stopped) return;
    const row: string[] = [];
    for (const p of pending.filter((x) => x.row === r)) row[p.col] = p.text;
    let col = 0;
    $(tr)
      .children("th,td")
      .each((_, cell) => {
        while (row[col] !== undefined) col++;
        const c = $(cell).clone();
        c.find("br").replaceWith(" ");
        c.find("sup").remove();
        const text = cleanText(c.text());
        const colspan = Math.max(1, Number($(cell).attr("colspan") ?? 1) || 1);
        const rowspan = Math.max(1, Number($(cell).attr("rowspan") ?? 1) || 1);
        for (let cc = 0; cc < colspan; cc++) {
          row[col + cc] = text;
          for (let k = 1; k < rowspan; k++) pending.push({ row: r + k, col: col + cc, text });
        }
        col += colspan;
      });
    const filled = Array.from({ length: row.length }, (_, i) => row[i] ?? "");
    // This giant wrapper table runs straight into the (separately extracted) NRE/NRO section
    // with no closing tag of its own in between — stop once that section's heading appears.
    if (/revised roi for non-resident/i.test(filled[0] ?? "")) {
      stopped = true;
      return;
    }
    if (filled.some((v) => v !== "")) rows.push(filled);
  });
  return rows;
}

const DOMESTIC_COLUMNS = [
  { idx: 1, customer: "general", callable: true },
  { idx: 3, customer: "senior", callable: true },
  { idx: 5, customer: "general", callable: false },
  { idx: 7, customer: "senior", callable: false },
] as const;
const DOMESTIC_HEADER_ROWS = 6;

function parseDomesticCard(html: string): { rows: RateRow[]; effectiveFrom: string | null } {
  const grid = domesticRows(html);
  const effectiveFrom = findEffectiveDate(grid.slice(0, DOMESTIC_HEADER_ROWS).flat().join(" | "));
  const rows: RateRow[] = [];
  for (const row of grid.slice(DOMESTIC_HEADER_ROWS)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const rates = DOMESTIC_COLUMNS.map((c) => parseRate(row[c.idx] ?? ""));
    if (rates.every((r) => r === null)) continue; // e.g. the "Term Deposits (All Maturities)" separator row (all "—")
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`canara-bank: cannot read domestic tenure "${label}"`);
    DOMESTIC_COLUMNS.forEach((c, i) => {
      const rate = rates[i];
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: c.callable ? 0 : CRORE + 1,
        amountMax: 3 * CRORE,
        customer: c.customer,
        residency: "resident",
        callable: c.callable,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("canara-bank: domestic table produced no rows");
  return { rows, effectiveFrom };
}

function parseGreenRetail(g: Grid): RateRow[] {
  const rows: RateRow[] = [];
  for (const row of g.rows.slice(1)) {
    const label = cleanText(row[1] ?? "");
    const rate = parseRate(row[2] ?? "");
    if (!label || rate === null) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`canara-bank: cannot read Green Deposit tenure "${label}"`);
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      special: true,
      schemeName: "Canara Retail Green Deposit",
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer: "general",
      residency: "resident",
      callable: true,
      payout: null,
      rate,
    });
  }
  if (rows.length === 0) throw new AdapterError("canara-bank: Green Deposit table produced no rows");
  return rows;
}

/** Bulk SLABS table: column headers are amount bands (all at the "general public" rate). */
function parseBulkSlabs(g: Grid, callable: boolean): RateRow[] {
  const bandHeaders = g.rows[2]?.slice(2) ?? [];
  const bands = bandHeaders.map((h) => parseAmountBand(h));
  const rows: RateRow[] = [];
  for (const row of g.rows.slice(3)) {
    const label = cleanText(row[1] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`canara-bank: cannot read bulk tenure "${label}"`);
    row.slice(2).forEach((cell, i) => {
      const rate = parseRate(cell);
      if (rate === null) return;
      const band = bands[i];
      if (!band) throw new AdapterError(`canara-bank: cannot read amount-band header "${bandHeaders[i]}"`);
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("canara-bank: bulk slabs table produced no rows");
  return rows;
}

/** Bulk Green Deposits (1111/2222/3333 days), ₹3cr & above, callable + non-callable columns. */
function parseBulkGreen(g: Grid): { rows: RateRow[]; effectiveFrom: string | null } {
  const effectiveFrom = findEffectiveDate(g.rows.slice(0, 4).flat().join(" | "));
  // Strip the trailing "(w.e.f 25.09.2026)" note first — parseAmountBand has no concept of a
  // parenthetical aside, so left in place it reads "25.09" out of the date as a second amount.
  const band = parseAmountBand((g.rows[2]?.[2] ?? "").replace(/\(.*?\)/g, ""));
  if (!band) throw new AdapterError(`canara-bank: cannot read Bulk Green Deposit amount band "${g.rows[2]?.[2]}"`);
  const rows: RateRow[] = [];
  for (const row of g.rows.slice(4)) {
    const label = cleanText(row[1] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`canara-bank: cannot read Bulk Green Deposit tenure "${label}"`);
    ([true, false] as const).forEach((callable, i) => {
      const rate = parseRate(row[2 + i] ?? "");
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: true,
        schemeName: "Canara Bulk Green Deposit",
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("canara-bank: Bulk Green Deposit table produced no rows");
  return { rows, effectiveFrom };
}

export const canaraBankFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const { rows: domestic, effectiveFrom: domesticDate } = parseDomesticCard(html);
  const grids = extractTables(html);
  // This table's own heading ("ROI on Canara Retail Green Deposits w.e.f....") is its own
  // first (merged) row, not preceding context — the preceding text is an unrelated footnote.
  const green = requireGrid(grids, (g) => /canara retail green deposits/i.test(g.rows[0]?.[0] ?? ""), "Canara Retail Green Deposits table");
  const greenDate = findEffectiveDate(green.rows[0]?.[0] ?? "");
  const effectiveFrom = domesticDate ?? greenDate;
  if (!effectiveFrom) throw new AdapterError("canara-bank: retail effective date not found");

  const rows = [...domestic, ...parseGreenRetail(green)];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom });
  const rd = deriveRdFromFd(fd, "Canara Bank Recurring Deposit — Interest Rate: \"As applicable to term deposits of various tenures prevailing from time to time.\"");
  return {
    cards: [fd, rd],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% for deposits below ₹3 crore, tenor 180 days and above", prematurePenalty: "1.00% (RD); domestic <3cr extension waived if extended for a longer period than originally agreed" }],
  };
};

export const canaraBankBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // The "Callable"/"Non-Callable" slabs tables share near-identical row0/context text (the
  // context capture leaks the Callable table's own heading into the Non-Callable table right
  // after it — same kind of leakage as bank-of-maharashtra.ts). Row 1 itself unambiguously says
  // which is which, so match on that directly instead; the `wide` check keeps the much
  // narrower 4-column Bulk Green Deposits table (matched separately below) out of both.
  const wide = (g: Grid) => Math.max(...g.rows.map((r) => r.length)) > 5;
  const isBulkCallable = (g: Grid) => wide(g) && (g.rows[1] ?? []).some((c) => /^callable deposits/i.test(c));
  const isBulkNonCallable = (g: Grid) => wide(g) && (g.rows[1] ?? []).some((c) => /non\s*-?\s*callable deposits/i.test(c));
  const callable = requireGrid(grids, isBulkCallable, "bulk callable slabs table");
  const nonCallable = requireGrid(grids, isBulkNonCallable, "bulk non-callable slabs table");
  const green = requireGrid(grids, (g) => /bulk green deposits/i.test(g.context), "Bulk Green Deposits table");
  const effectiveFrom = findEffectiveDate(callable.rows.slice(0, 3).flat().join(" | "));
  if (!effectiveFrom) throw new AdapterError("canara-bank: bulk effective date not found");

  const { rows: greenRows } = parseBulkGreen(green);
  const rows = [...parseBulkSlabs(callable, true), ...parseBulkSlabs(nonCallable, false), ...greenRows];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom })], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE }] };
};

export const canaraBankSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings bank deposits/i.test(x.context), "savings slab table");
  const effectiveFrom = findEffectiveDate(g.context);
  if (!effectiveFrom) throw new AdapterError("canara-bank: savings effective date not found");

  const slabs: SavingsSlab[] = g.rows.slice(1).map((r) => {
    const label = cleanText(r[1] ?? "");
    const rate = parseRate(r[2] ?? "");
    if (rate === null) throw new AdapterError(`canara-bank: cannot read savings rate for slab "${label}"`);
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`canara-bank: cannot read savings balance slab "${label}"`);
    return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
  });
  if (slabs.length === 0) throw new AdapterError("canara-bank: no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
