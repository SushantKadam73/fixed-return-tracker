/**
 * Equitas Small Finance Bank — equitas.bank.in
 * Pages: retail FD (< ₹3 crore), Recurring Deposit.
 *
 * Quirks:
 *  - The site renders its rate tables as plain `<div>` rows (one `<p>` per column) rather than
 *    `<table>`/`<tr>`/`<td>` — `extractTables()` finds nothing here. `divGrid()` below locates the
 *    row whose first cell is the exact word "Tenure" (the header) and reads that row plus every
 *    following sibling `<div>` that still has the same number of `<p>` children, then hands the
 *    result to the *same* shared `parseTermTable`/`parseTenure` used everywhere else. Local to
 *    this adapter only — no shared parser file was changed.
 *  - Senior citizens get a flat "+0.50% p.a., all tenures" (not applicable to NRE/NRO) stated in
 *    page text, not as its own printed column — kept as a note (never computed into a row), the
 *    same treatment the reference SBI adapter gives its own text-only premiums.
 *  - "3 years 1 day (36 months 1 day) (Maxima FD)" is Equitas's own named point tenure (8.00%,
 *    16 Jun 2026 card) — parenthetical notes are stripped by the shared `parseTenure`, so it
 *    reduces to a plain "3 years 1 day" point; `schemeNames` re-attaches the name.
 *  - No numeric savings-slab table was found on the savings product page (marketing headline
 *    only), and no public bulk (≥₹3 crore) page — both skipped, see the run report.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { RateRow } from "../../../lib/domain";
import { cleanText, parseDate } from "../parse/common";
import type { Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard } from "./helpers";

/** Read a "one `<p>` per column" div-grid table, anchored on the header row's exact text. */
function divGrid(html: string, headerCell: RegExp): Grid {
  const $ = cheerio.load(html);
  let header: Element | null = null;
  $("p").each((_, el) => {
    if (header) return;
    if (headerCell.test(cleanText($(el).text()))) header = el as Element;
  });
  if (!header) throw new AdapterError(`header cell not found: ${headerCell}`);
  const headerRow = $(header).parent();
  const readRow = (row: cheerio.Cheerio<AnyNode>) => row.children("p").map((_, p) => cleanText($(p).text())).get();
  const rows: string[][] = [readRow(headerRow)];
  let sib = headerRow.next();
  const width = rows[0].length;
  while (sib.length > 0 && sib.is("div")) {
    const cells = readRow(sib);
    if (cells.length !== width || cells.length === 0) break;
    rows.push(cells);
    sib = sib.next();
  }
  return { index: 0, context: "", rows };
}

/** The page states its own effective date once, e.g. "Effective from: 16th June, 2026". */
function pageEffectiveDate(html: string): string | null {
  const m = /effective from:?\s*([^<|]{4,40})/i.exec(html);
  return m ? parseDate(m[1]) : null;
}

export const equitasSfbFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grid = divGrid(html, /^tenure$/i);
  const effectiveFrom = pageEffectiveDate(html);
  if (!effectiveFrom) throw new AdapterError("no 'Effective from' date found on the FD page");

  const rows: RateRow[] = parseTermTable(grid, {
    columns: [{ header: /interest rate/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    schemeNames: { 1096: "Equitas Maxima FD" }, // 3 years 1 day = 36 months 1 day
  });
  rows.forEach((r) => {
    if (r.schemeName) r.note = "Own 1% premature-closure penalty (bank T&C), separate from the standard FD penalty";
  });

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "Resident senior citizens get +0.50% p.a. over the general rate on all tenures (not applicable to NRE/NRO) per the bank's own statement — not printed as its own column, so no separate senior rows are published here.",
      "No numeric savings-slab table or public bulk (≥₹3 crore) rate page was found; only the retail FD and RD cards are covered.",
    ],
  });
  return { cards: [fd] };
};

export const equitasSfbRd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grid = divGrid(html, /^tenure$/i);
  const effectiveFrom = pageEffectiveDate(html);
  if (!effectiveFrom) throw new AdapterError("no 'Effective from' date found on the RD page");

  const rows = parseTermTable(grid, {
    tenureHeader: /^tenure$/i,
    columns: [{ header: /individual/i, customer: "general" }],
    amountMin: 0,
    amountMax: null,
    callable: true,
  });
  return {
    cards: [
      makeCard(ctx, "rd", rows, {
        effectiveFrom,
        notes: ["This is Equitas's own dedicated RD table (not derived from the FD card). Resident senior citizens get +0.5% p.a. from 12 months onwards per page text; not printed as a column, so not published as separate rows."],
      }),
    ],
  };
};
