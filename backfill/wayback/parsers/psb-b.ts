/**
 * Custom historical parsers for Indian Bank, Indian Overseas Bank, Punjab & Sind Bank, Punjab National Bank, UCO Bank, Union Bank of India and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/psb-b.json.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { parseAmountBand } from "../../../collectors/src/parse/amount";
import { findEffectiveDate, parseRate } from "../../../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../../../collectors/src/parse/html-table";
import { parseTenure } from "../../../collectors/src/parse/tenure";
import type { GenericResult, HistoricalParser, Target } from "../types";

/**
 * Reads a deposit table whose non-tenure column(s) each carry an AMOUNT tier in their own
 * header -- e.g. Indian Bank's pre-2011 pages, which split retail rates into "Less than Rs.
 * 15 lakhs" / "Rs. 15 lakhs to less than Rs.1 Crore" columns on one table, and print higher
 * bulk bands ("Rs.1 Crore to Rs.5 Crores", "Above Rs 5 Crore") as further tables of the same
 * shape -- with no senior/staff columns anywhere. The shared generic reader
 * (`readTermTables`/`classifyColumn`) always maps a header containing "crore"/"bulk"/
 * "non-callable" to `"skip"` (a sensible default when such a column sits ALONGSIDE a plain
 * "general"-labelled column, so the bulk column is dropped and the retail one kept), and has
 * no way at all to turn a surviving amount-worded header into `amountMin`/`amountMax` -- it
 * only ever reads CUSTOMER type from a header, so even a header it doesn't skip (e.g. "Less
 * than Rs. 15 lakhs", which contains no skip-word) gets misfiled as a plain "general" row with
 * no amount band recorded, silently implying "no cap" (`amountMax: null`) for a column that is
 * explicitly capped. This parser is for that whole family of layouts: every non-tenure column
 * is read as its OWN amount tier via `parseAmountBand` on that column's own header text
 * (falling back to the table's `context`, the text immediately above it, for a single-column
 * table where the amount is stated once in a heading rather than repeated in the header cell)
 * -- never an invented band. A column whose header cannot be read as an amount band is skipped
 * and logged, not guessed at; `customer` is always `"general"` since none of these tables carry
 * a senior-citizen column.
 *
 * Indian Overseas Bank's 2006-2007 `irate.asp` captures hit the same shape from the other
 * direction: its two amount-tier columns ("Deposits up to Rs.15 lakh...", "Int.rate for >Rs.15
 * lakh") both happen to contain "% p.a." text, which the shared reader's `classifyColumn` reads
 * as a `general` customer label for BOTH columns (neither contains a skip-word like "crore"),
 * so it merges two genuinely different amount tiers into one `general` column and reports
 * `conflicting_rows` when they disagree. Same fix applies; see `normalizeAmountHeader` for the
 * two mechanical text fixes this bank's header text additionally needed.
 *
 * A page can carry BOTH a retail table (amount tiers below ₹1 crore) and a separate bulk table
 * (tiers at/above ₹1 crore) -- Indian Bank's own pages of this era draw that exact line
 * themselves ("...less than Rs.1 Crore" ends one table; "Rs.1 Crore to Rs.5 Crores" starts the
 * next). Every readable amount-tier row from every table on the page is collected, then split
 * on that same ₹1-crore line: the `fd` target keeps only tiers whose upper bound is at or below
 * ₹1 crore, the `fd_bulk` target keeps only tiers whose lower bound is at or above ₹1 crore. A
 * tier that straddles neither side cleanly (open lower bound below ₹1 crore, i.e. `amountMax ===
 * null`) is treated as retail, matching how every page found here actually prints it.
 */
const RETAIL_BULK_LINE = 10_000_000; // ₹1 crore -- the boundary these specific pages draw themselves, not invented here

/**
 * Two mechanical text fixes before handing a header cell to `parseAmountBand` (never touching a
 * digit or a comparison word, only spelling out symbols/clauses it doesn't already recognise):
 *  1. A bare leading "<"/">" (e.g. IOB's "Int.rate for >Rs.15 lakh") fails `parseAmountBand`'s
 *     word-boundary-anchored "above"/"below" check, because "\b" needs a word character on one
 *     side and there isn't one immediately before a punctuation symbol -- the same limitation
 *     already documented and worked around in `pnb-savings-archive.ts`. Spelled out as the
 *     words `parseAmountBand` already understands.
 *  2. A header cell that states a validity window alongside the amount, e.g. IOB's "Deposits up
 *     to Rs.15 lakh valid 19.1.2007 to 31.3.2007", confuses `parseAmountBand` -- it takes the
 *     first two numbers in the whole string, so with two numbers already present ("15" then the
 *     "19.1" that starts the date) it reads the validity date as the upper end of the amount
 *     band instead of leaving the band open-ended. The validity clause is stripped (never the
 *     amount clause before it) before parsing.
 */
function normalizeAmountHeader(label: string): string {
  return label
    .replace(/\b(valid|w\.?\s?e\.?\s?f\.?|effective(?:\s+from)?)\b.*$/i, "")
    .replace(/(?<![\w])</g, "below ")
    .replace(/(?<![\w])>/g, "above ")
    .trim();
}

function readAmountTieredTable(html: string, target: Target): GenericResult {
  const grids = extractTables(html);
  const skipped: string[] = [];
  const rows: RateRow[] = [];
  let tablesRead = 0;
  for (const g of grids) {
    const r = readAmountTierGrid(g);
    if (r.rows.length > 0) {
      tablesRead++;
      rows.push(...r.rows);
    }
    if (r.skipped.length) skipped.push(...r.skipped);
  }
  const wanted = rows.filter((r) => (target.product === "fd_bulk" ? r.amountMin >= RETAIL_BULK_LINE : r.amountMax === null || r.amountMax <= RETAIL_BULK_LINE));
  return { rows: wanted, effectiveFrom: findEffectiveDate(pageText(html)), tablesRead, skipped };
}

function readAmountTierGrid(g: Grid): { rows: RateRow[]; skipped: string[] } {
  if (g.rows.length < 4) return { rows: [], skipped: [] };
  let h = 0;
  while (h < Math.min(3, g.rows.length) && g.rows[h].slice(1).every((c) => parseRate(c) === null)) h++;
  if (h === 0) h = 1;
  const width = Math.max(...g.rows.map((r) => r.length));
  // Read the amount band from the LAST header row only (the one nearest the data), never the
  // full multi-row join: an outer header row repeated across every column via colspan (e.g. a
  // single "... (w.e.f. 07.08.2009)" banner row sitting above the real column headers) would
  // otherwise hand its own date's digits to `parseAmountBand`, which reads the first two numbers
  // it finds in the string -- silently reading "07.08" / "2009" as the amount band instead of the
  // "15 lakhs" / "1 Crore" that make the column what it is.
  const lastHeaderRow = g.rows[h - 1] ?? [];
  const body = g.rows.slice(h);
  const tenureOk = body.filter((r) => parseTenure(r[0] ?? "") !== null).length;
  if (tenureOk < Math.max(3, body.length * 0.6)) return { rows: [], skipped: [`table ${g.index}: first column is not tenures`] };
  const skipped: string[] = [];
  const cols: Array<{ i: number; band: { min: number; max: number | null } }> = [];
  for (let i = 1; i < width; i++) {
    const headerCell = lastHeaderRow[i] ?? "";
    const band = parseAmountBand(normalizeAmountHeader(headerCell)) ?? parseAmountBand(normalizeAmountHeader(g.context));
    if (!band) {
      skipped.push(`table ${g.index} col ${i}: header "${headerCell}" (and table context) is not a readable amount band`);
      continue;
    }
    cols.push({ i, band });
  }
  if (cols.length === 0) return { rows: [], skipped };
  const rows: RateRow[] = [];
  for (const r of body) {
    const t = parseTenure(r[0] ?? "");
    if (!t) continue;
    for (const c of cols) {
      const rate = parseRate(r[c.i] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: c.band.min,
        amountMax: c.band.max,
        customer: "general" as CustomerType,
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  return { rows, skipped };
}

// Registered under both banks' own keys (naming convention: "<bankSlug>/<layout>") since both
// hit the identical layout independently: an amount-tiered table with no customer columns.
export const parsers: Record<string, HistoricalParser> = {
  "indian-bank/amount-tiered-table": readAmountTieredTable,
  "indian-overseas-bank/amount-tiered-table": readAmountTieredTable,
};
