/**
 * Custom historical parsers for SBI, Bank of Baroda, Bank of India, Bank of Maharashtra, Canara Bank, Central Bank of India and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/psb-a.json.
 */
import type { RateRow, Residency } from "../../../lib/domain";
import { parseAmountBand } from "../../../collectors/src/parse/amount";
import { findEffectiveDate, parseRate } from "../../../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../../../collectors/src/parse/html-table";
import { parseTenure } from "../../../collectors/src/parse/tenure";
import { readTermTables } from "../generic-parse";
import type { HistoricalParser } from "../types";

/**
 * SBI's earliest archived web page (statebankofindia.com/interest.htm, captured exactly once by
 * the Internet Archive, on 1998-12-03) stacks six separate rate tables -- FCNR, NRNR, NRE,
 * Resident+NRO, a one-line Savings rate, and RFC -- one after another under their own numbered
 * headings, each with its own "(w.e.f. ...)" date, with no shared table structure distinguishing
 * them. The generic table reader (backfill/wayback/generic-parse.ts) cannot tell these apart: it
 * hardcodes residency "resident" on whatever table it reads and stops at the first table it can
 * parse -- which on this page is the NRE table, so the generic reader would silently mislabel
 * NRE rates (residency nre) as domestic resident FD rates. This parser reads the page's own
 * section headings to route each table to the right product/residency, and reports (never
 * guesses) what it cannot represent:
 *  - FCNR quotes four different currencies (STG/US$/DM/YEN) in the same row; RateRow has no
 *    currency dimension, so FCNR cannot be represented here without inventing one -- not parsed.
 *  - NRNR (non-resident non-repatriable rupee deposits, discontinued by RBI in 2002) has no
 *    corresponding value in the Product enum -- not parsed.
 *  - RFC (resident foreign currency) likewise has no Product value, and its rates are quoted
 *    against a USD minimum deposit, not a rupee amount band -- not parsed.
 *  - The page's one-line Savings Bank rate (4.5% p.a., w.e.f. 1 Nov 1994) restates the
 *    RBI-prescribed uniform savings rate already covered by data/history/rbi/savings-rate-history.json
 *    for this date (see backfill/notes/psb-a.md) -- deliberately not emitted, to avoid duplicating
 *    a system-wide series with a bank-specific card.
 */
const RESIDENT_NRO_HEADING = /resident and nro deposits/i;
const NRE_HEADING = /nre rupee deposits/i;
const SAVINGS_HEADING = /savings bank deposits/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(year: number, month: number, day: number): string | null {
  if (day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * collectors/src/parse/common.ts's findEffectiveDate/parseDate cannot read two date spellings
 * these old SBI pages actually use, both scoped to this group's own parser module rather than
 * touched in the shared file:
 *  - a 2-digit year, e.g. "w.e.f. 01st May '98" (parseDate's patterns all require 4 digits);
 *    decoded with the conventional >=50 -> 19YY, <50 -> 20YY split.
 *  - an abbreviated month followed by a period, e.g. "Effective from 12th Sept. 2000" (the
 *    period sits between the month letters and the required following whitespace/comma/hyphen
 *    in parseDate's "DD Month YYYY" pattern, so that pattern never matches).
 */
function localEffectiveDate(text: string): string | null {
  let m = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s*'(\d{2})\b/i.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const yy = Number(m[3]);
      return isoDate(yy >= 50 ? 1900 + yy : 2000 + yy, month, Number(m[1]));
    }
  }
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s+(\d{4})\b/i.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) return isoDate(Number(m[3]), month, Number(m[1]));
  }
  return null;
}

/** The first table (in document order) whose own heading/caption context matches `headingRe`, with all "tenure label | rate" rows it contains (other columns, e.g. FCNR's per-currency ones, are not read). */
function findSection(html: string, headingRe: RegExp): { grid: Grid; rows: Array<{ label: string; rate: number }> } | null {
  for (const grid of extractTables(html)) {
    if (!headingRe.test(grid.context)) continue;
    const rows: Array<{ label: string; rate: number }> = [];
    for (const r of grid.rows) {
      const tenure = parseTenure(r[0] ?? "");
      const rate = parseRate(r[1] ?? "");
      if (tenure && rate !== null) rows.push({ label: r[0], rate });
    }
    if (rows.length >= 3) return { grid, rows };
  }
  return null;
}

/** The page's own "(w.e.f. ...)" date for the section starting at `startRe`, bounded by the next section's heading `endRe` so an unrelated section's date is never picked up. */
function sectionEffectiveDate(html: string, startRe: RegExp, endRe: RegExp): string | null {
  const text = pageText(html);
  const start = startRe.exec(text);
  if (!start) return null;
  const rest = text.slice(start.index);
  const end = endRe.exec(rest);
  const window = end && end.index > 0 ? rest.slice(0, end.index) : rest;
  return findEffectiveDate(window) ?? localEffectiveDate(window);
}

function toRateRows(rows: Array<{ label: string; rate: number }>, residency: Residency): RateRow[] {
  const out: RateRow[] = [];
  for (const { label, rate } of rows) {
    const tenure = parseTenure(label);
    if (!tenure) continue; // already validated by findSection; guards this fn if ever reused standalone
    out.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
      amountMin: 0,
      amountMax: null,
      customer: "general",
      residency,
      callable: null,
      payout: null,
      rate,
    });
  }
  return out;
}

const sbi1998MultiSection: HistoricalParser = (html, target) => {
  if (target.product === "fd" || target.product === "nro") {
    const section = findSection(html, RESIDENT_NRO_HEADING);
    if (!section) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"RESIDENT AND NRO DEPOSITS" table not found on this page'] };
    const effectiveFrom = sectionEffectiveDate(html, RESIDENT_NRO_HEADING, SAVINGS_HEADING);
    return { rows: toRateRows(section.rows, target.product === "nro" ? "nro" : "resident"), effectiveFrom, tablesRead: 1, skipped: [] };
  }
  if (target.product === "nre") {
    const section = findSection(html, NRE_HEADING);
    if (!section) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"NRE RUPEE DEPOSITS" table not found on this page'] };
    const effectiveFrom = sectionEffectiveDate(html, NRE_HEADING, RESIDENT_NRO_HEADING);
    return { rows: toRateRows(section.rows, "nre"), effectiveFrom, tablesRead: 1, skipped: [] };
  }
  return {
    rows: [],
    effectiveFrom: null,
    tablesRead: 0,
    skipped: [
      `sbi/1998-multi-section does not support product "${target.product}" (this page only has fd/nro/nre-shaped tables; FCNR has no currency dimension in RateRow, and NRNR/RFC have no matching Product value)`,
    ],
  };
};

/**
 * SBI's Feb-2001-era per-product pages (e.g. statebankofindia.com/statebank/sbinew/termdeposit.htm)
 * carry one clean "Period | %p.a" table the generic reader parses correctly on its own -- the
 * only thing it gets wrong is the effective date, "Effective from 12th Sept. 2000", which
 * `findEffectiveDate` cannot read (see `localEffectiveDate` above). This wrapper reuses the
 * generic reader's rows and only substitutes the date.
 */
const sbi2001ProductPage: HistoricalParser = (html) => {
  const generic = readTermTables(html);
  if (generic.effectiveFrom || generic.rows.length === 0) return generic;
  return { ...generic, effectiveFrom: localEffectiveDate(pageText(html)) };
};

const SBP_DEPOSITS_HEADING = /interest rates on deposits/i;
const SBP_HOUSING_LOANS_HEADING = /rates of interest on housing loans/i;

/**
 * State Bank of Patiala's 2003 rate page (sbp.co.in/interestrate.htm) has one domestic
 * term-deposit table with THREE numeric columns per tenure: two rate columns split by deposit
 * amount ("Upto Less Than Rs.15 lacs" and "above Rs.15 lacs & less than Rs.1 crore"), plus a
 * third "EFFECTIVE ANNUALISED RETURN TO CUSTOMER" column that is a compounded-yield restatement
 * of the >=15-lacs rate, not a separate rate offering -- RateRow has no field for a derived
 * yield, so that column is read and then dropped. This table also sits above several *lending*
 * rate tables (housing loans, PLR, agriculture advances) on the same page, each with their own
 * later "w.e.f." date, so the effective date is read from a text window bounded to just this
 * table's own heading, the same way as sbi/1998-multi-section above -- reading the whole page's
 * text for a date would otherwise return one of those later lending-rate dates instead.
 *
 * This table's own footnotes are marked up as a `<caption>` INSIDE the table (rather than as a
 * proper title) -- html-table.ts's `extractTables` treats a table's own `<caption>` as that
 * table's `context` whenever one is present (a reasonable default for tables that use it as an
 * actual title), which here means `context` is the footnote text, not the "Interest Rates on
 * Deposits" heading that actually precedes this table. So the right grid is found by its own
 * distinctive header cell text ("annualised return") instead of by heading/context matching.
 */
const sbp2003Portal: HistoricalParser = (html) => {
  const grid = extractTables(html).find((g) => g.rows.slice(0, 2).some((r) => r.some((cell) => /annualised return|annualized return/i.test(cell))));
  if (!grid) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"Interest Rates on Deposits" table not found on this page'] };
  const width = Math.max(...grid.rows.map((r) => r.length));
  // This page's table always has a 2-row header (a rowspan/colspan-expanded "PERIOD | INTEREST
  // RATE(% pa) [spanning the 2 amount bands] | EFFECTIVE ANNUALISED RETURN..." layout).
  const headerRows = grid.rows.slice(0, 2);
  const bands = Array.from({ length: width }, (_, c) => parseAmountBand(headerRows.map((r) => r[c] ?? "").join(" ")));
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(2)) {
    const tenure = parseTenure(r[0] ?? "");
    if (!tenure) continue;
    for (let c = 1; c < width; c++) {
      const band = bands[c];
      if (!band) continue; // no amount band read from this column's header -> not a rate-by-amount column (e.g. the yield column)
      const rate = parseRate(r[c] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: r[0],
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no readable rate cells in the Deposits table"] };
  const text = pageText(html);
  const start = SBP_DEPOSITS_HEADING.exec(text);
  const rest = start ? text.slice(start.index) : text;
  const end = SBP_HOUSING_LOANS_HEADING.exec(rest);
  const effectiveFrom = findEffectiveDate(end && end.index > 0 ? rest.slice(0, end.index) : rest);
  return { rows, effectiveFrom, tablesRead: 1, skipped: [] };
};

export const parsers: Record<string, HistoricalParser> = {
  "sbi/1998-multi-section": sbi1998MultiSection,
  "sbi/2001-product-page": sbi2001ProductPage,
  "state-bank-of-patiala/2003-portal": sbp2003Portal,
};
