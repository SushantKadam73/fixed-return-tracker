/**
 * Turn a "tenure × customer" rate grid into RateRows.
 *
 * Most Indian bank pages publish one table per amount band with a tenure column and one
 * or more rate columns (general public, senior citizen, super senior; sometimes "existing"
 * and "revised" side by side). Adapters describe which columns mean what; this module does
 * the rest and refuses to guess: any row whose tenure cannot be parsed makes the whole
 * table fail, so a layout change is caught instead of producing wrong data.
 */
import type { CustomerType, Payout, RateRow, Residency } from "../../../lib/domain";
import { parseRate } from "./common";
import type { Grid } from "./html-table";
import { parseTenure } from "./tenure";

export interface ColumnSpec {
  /** Header regex identifying the column (matched against the joined header text). */
  header: RegExp;
  customer: CustomerType;
  /** Optional header regex that must NOT match (e.g. exclude "existing" columns). */
  exclude?: RegExp;
}

export interface TermTableSpec {
  tenureHeader?: RegExp; // defaults to /tenor|tenure|period|maturity|duration/i
  columns: ColumnSpec[];
  amountMin: number;
  amountMax: number | null;
  residency?: Residency;
  callable?: boolean | null;
  payout?: Payout | null;
  /** Number of header rows at the top of the grid (auto-detected when omitted). */
  headerRows?: number;
  /** Rows whose first cell matches are skipped (notes, sub-headings). */
  skipRow?: RegExp;
  /** Special-tenure scheme names by exact day count, e.g. { 444: "Amrit Vrishti" }. */
  schemeNames?: Record<number, string>;
}

export class ParseError extends Error {}

function detectHeaderRows(grid: Grid): number {
  // Header rows are the leading rows where no cell looks like a rate.
  let n = 0;
  for (const row of grid.rows) {
    const rateCells = row.slice(1).filter((c) => parseRate(c) !== null).length;
    if (rateCells > 0) break;
    n++;
    if (n >= 4) break;
  }
  return Math.max(1, n);
}

export function parseTermTable(grid: Grid, spec: TermTableSpec): RateRow[] {
  const headerRows = spec.headerRows ?? detectHeaderRows(grid);
  const width = Math.max(...grid.rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, c) =>
    grid.rows
      .slice(0, headerRows)
      .map((r) => r[c] ?? "")
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .join(" | "),
  );
  const tenureRe = spec.tenureHeader ?? /tenor|tenure|period|maturity|duration|days|term/i;
  const tenureCol = headers.findIndex((h) => tenureRe.test(h));
  if (tenureCol < 0) throw new ParseError(`no tenure column in headers: ${headers.join(" || ")}`);

  const columns = spec.columns.map((c) => {
    const idx = headers.findIndex((h, i) => i !== tenureCol && c.header.test(h) && !(c.exclude && c.exclude.test(h)));
    return { ...c, idx };
  });
  const found = columns.filter((c) => c.idx >= 0);
  if (found.length === 0) throw new ParseError(`no rate columns matched in headers: ${headers.join(" || ")}`);

  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(headerRows)) {
    const label = row[tenureCol] ?? "";
    if (!label || (spec.skipRow && spec.skipRow.test(label))) continue;
    const rates = found.map((c) => parseRate(row[c.idx] ?? ""));
    if (rates.every((x) => x === null)) continue; // note rows, blank separators
    const tenure = parseTenure(label);
    if (!tenure) throw new ParseError(`cannot read tenure "${label}"`);
    found.forEach((c, i) => {
      const rate = rates[i];
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        // A single-tenure row is a "special" scheme unless it is a whole number of years (e.g. 5-year tax saver).
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        schemeName: spec.schemeNames?.[tenure.minDays],
        amountMin: spec.amountMin,
        amountMax: spec.amountMax,
        customer: c.customer,
        residency: spec.residency ?? "resident",
        callable: spec.callable ?? true,
        payout: spec.payout ?? null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new ParseError("table produced no rows");
  return rows;
}
