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
 * Shared-code finding, worked around here rather than fixed there (`collectors/src/parse/amount.ts`
 * is out of this lane): several bank-of-baroda amount-band headers on this group's pages print a
 * per-band effective date right inside the same cell, e.g. "For amount Less than Rs. 15
 * lacs(w.e.f. 16.09.2002)". `parseAmountBand`'s two-number "a to b" reading always takes the
 * FIRST two numbers it finds in the whole header text, with no awareness that a parenthesised
 * note might not be part of the amount phrase at all -- so a single-amount header like the one
 * above (just "15 lacs", meant to be read as a below-15-lacs band) gets its second number pulled
 * from the date instead ("16.09" from "16.09.2002", read as if it were rupees), producing a
 * nonsense band such as {min: 1500000, max: 16.09}. Confirmed on a live capture
 * (bankofbaroda.com/interest.asp, 2002-10-12): `validateCard` correctly rejected the resulting
 * card ("invalid amount band ...–16.09"), so no wrong data reached storage, but the whole
 * capture's real numbers were lost as a result.
 * Only a date-shaped parenthetical is stripped (one containing "w.e.f"/"effective" or a
 * DD.MM.YYYY-shaped run of digits) -- unlike `parseTenure`'s blanket "drop anything in
 * parentheses", a later era of this same page's amount-band headers wraps the *entire* band
 * phrase in one pair of parentheses ("(For less than Rs. 15 lacs)"), which a blanket strip would
 * delete outright.
 */
function stripDateParentheticals(s: string): string {
  return s.replace(/\((?:[^()]*(?:w\.?\s?e\.?\s?f\.?|effective)[^()]*|[^()]*\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4}[^()]*)\)/gi, " ");
}

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

// Matches both this page's 2002 heading ("DOMESTIC TERM DEPOSITS, NON-RESIDENT...") and its 2003+
// rewording ("Domestic Term & NRO Deposits") -- the two eras read by the two parsers below.
const BOB_DEPOSITS_HEADING = /domestic term/i;
const BOB_NEXT_HEADING = /penal interest on pre-?mature|savings account interest rate|foreign currency non-resident|interest rates? for senior citizens/i;

/**
 * Bank of Baroda's bankofbaroda.com/interest.asp (captured monthly 2002-2005) stacks PLR/export
 * credit, then one shared "DOMESTIC TERM DEPOSITS, NON-RESIDENT (ORDINARY) AND NON-RESIDENT
 * SPECIAL RUPEE (NRSR) DEPOSITS" table, a one-line Savings rate, then FCNR/NRE/NRNR, each with
 * its own "(Effective from ...)" date. The generic table reader cannot read the domestic table at
 * all: its first column is a bare row number ("Sr.No"), not the tenure -- readGrid hardcodes
 * column 0 as the tenure column, so it would reject this table outright ("first column is not
 * tenures"). The table also carries TWO rate columns split by deposit amount ("Less than Rs. 15
 * lacs" / "Rs. 15 lacs to less than Rs. 1 crore"), which the generic reader has no way to keep
 * separate (one target = one fixed amountMax). This parser reads column 1 (not 0) for the tenure
 * and both amount-banded rate columns, the same way as state-bank-of-patiala/2003-portal.
 * The heading itself states the table's rates cover domestic (resident) AND "non-resident
 * (ordinary)" (NRO) deposits on one shared schedule -- like sbi/1998-multi-section, the identical
 * rows are emitted for both the fd and nro products. NRSR (non-resident special rupee, a
 * discontinued scheme) has no matching Product value and is not emitted. Not parsed from this
 * page (see backfill/notes/psb-a.md): the one-line Savings rate (duplicates the RBI-prescribed
 * uniform savings rate for this era, like SBI's 1998 page); FCNR (currency-denominated, no
 * currency dimension in RateRow); NRE and NRNR (lower priority / no Product value respectively --
 * NRE is a ready lead for a future pass, sharing this same page and parser shape).
 *
 * The table gained a third, open-ended amount band ("Rs. 5 crore & above") at some point within
 * this era (confirmed present by 2002-10-12, not yet present on 2002-02-04) -- read dynamically
 * from however many amount-band columns the header actually has, not hardcoded to two. That
 * third band is stored as `fd_bulk`; the two finite-upper-bound bands are `fd`/`nro` as before.
 */
const bankOfBaroda2002InterestAsp: HistoricalParser = (html, target) => {
  if (target.product !== "fd" && target.product !== "nro" && target.product !== "fd_bulk") {
    return {
      rows: [],
      effectiveFrom: null,
      tablesRead: 0,
      skipped: [
        `bank-of-baroda/2002-interest-asp does not support product "${target.product}" (this page's other sections have no matching Product value or no currency dimension in RateRow -- see backfill/notes/psb-a.md)`,
      ],
    };
  }
  const grid = extractTables(html).find((g) => /^sr\.?\s*no\.?$/i.test((g.rows[0]?.[0] ?? "").trim()) && g.rows.some((r) => /15\s*lacs?|15\s*lakhs?/i.test(r.join(" "))));
  if (!grid) {
    return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"DOMESTIC TERM DEPOSITS" table (leading Sr.No column, two 15-lac-split amount bands) not found on this page'] };
  }
  const width = Math.max(...grid.rows.map((r) => r.length));
  const headerRows = grid.rows.slice(0, 2);
  const bands = Array.from({ length: width }, (_, c) => (c < 2 ? null : parseAmountBand(stripDateParentheticals(headerRows.map((r) => r[c] ?? "").join(" ")))));
  const wantBulk = target.product === "fd_bulk";
  const residency: Residency = target.product === "nro" ? "nro" : "resident";
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(2)) {
    const tenure = parseTenure(r[1] ?? ""); // column 0 is the bare Sr.No row number, not the tenure
    if (!tenure) continue;
    for (let c = 2; c < width; c++) {
      const band = bands[c];
      if (!band) continue;
      if (wantBulk !== (band.max === null)) continue; // fd/nro want a finite upper bound; fd_bulk wants the open-ended band
      const rate = parseRate(r[c] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: r[1],
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency,
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no readable rate cells in the DOMESTIC TERM DEPOSITS table"] };
  const text = pageText(html);
  const start = BOB_DEPOSITS_HEADING.exec(text);
  const rest = start ? text.slice(start.index) : text;
  const end = BOB_NEXT_HEADING.exec(rest);
  const effectiveFrom = findEffectiveDate(end && end.index > 0 ? rest.slice(0, end.index) : rest);
  return { rows, effectiveFrom, tablesRead: 1, skipped: [] };
};

/**
 * By mid-2003 the same bankofbaroda.com/interest.asp page had restyled its domestic table: the
 * heading became "Domestic Term & NRO Deposits", the leading Sr.No column was dropped, the
 * upper amount-band boundary moved from "Rs.1 crore" to "Rs.5.0 crore" (read from the header
 * text itself, not assumed), and each amount band gained a second, derived "Annualised Yield"
 * column next to its rate column -- RateRow has no field for a derived yield (the same situation
 * as state-bank-of-patiala/2003-portal), so that column is read and dropped. One tenure label on
 * this table carries an inline footnote in parentheses ("7 days to 14 days*(Applicable for
 * Deposits of Rs. 15 lacs and above)"); `parseTenure` already strips parenthesised notes, so it
 * reads correctly unaided. Bank-of-baroda/2002-interest-asp (above) and this parser never match
 * the same capture: one requires a leading "Sr.No" cell, the other requires a "Maturity Range"
 * cell with no row of bare numbers before it, so a target using either parser on a capture from
 * the other era correctly reports "table not found" rather than misreading it.
 */
const bankOfBaroda2003YieldTable: HistoricalParser = (html, target) => {
  if (target.product !== "fd" && target.product !== "nro") {
    return {
      rows: [],
      effectiveFrom: null,
      tablesRead: 0,
      skipped: [`bank-of-baroda/2003-yield-table does not support product "${target.product}" (see backfill/notes/psb-a.md)`],
    };
  }
  const grid = extractTables(html).find(
    (g) => /maturity range/i.test(g.rows[0]?.[0] ?? "") && /15\s*lacs?|15\s*lakhs?/i.test(g.rows[0]?.join(" ") ?? "") && g.rows.some((r) => /yield/i.test(r.join(" "))),
  );
  if (!grid) {
    return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"Domestic Term & NRO Deposits" table (Maturity Range + rate/yield column pairs) not found on this page'] };
  }
  let h = 0;
  while (h < Math.min(3, grid.rows.length) && grid.rows[h].slice(1).every((c) => parseRate(c) === null)) h++;
  if (h === 0) h = 1;
  const width = Math.max(...grid.rows.map((r) => r.length));
  const bandRow = grid.rows[0];
  const subRow = grid.rows[h - 1];
  const bands = Array.from({ length: width }, (_, c) => (c === 0 ? null : parseAmountBand(stripDateParentheticals(bandRow[c] ?? ""))));
  const residency: Residency = target.product === "nro" ? "nro" : "resident";
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(h)) {
    const tenure = parseTenure(r[0] ?? "");
    if (!tenure) continue;
    for (let c = 1; c < width; c++) {
      const band = bands[c];
      if (!band) continue;
      if (/yield|annuali[sz]ed/i.test(subRow[c] ?? "")) continue; // derived figure, not a separate rate
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
        residency,
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no readable rate cells in the Domestic Term & NRO Deposits table"] };
  const text = pageText(html);
  const start = BOB_DEPOSITS_HEADING.exec(text);
  const rest = start ? text.slice(start.index) : text;
  const end = BOB_NEXT_HEADING.exec(rest);
  const effectiveFrom = findEffectiveDate(end && end.index > 0 ? rest.slice(0, end.index) : rest);
  return { rows, effectiveFrom, tablesRead: 1, skipped: [] };
};

/**
 * Bank of India's bankofindia.co.in/rupeetermdeposit.aspx (captured 2009-2012) carries one
 * domestic-deposit table with THREE amount bands ("less than Rs.15 lacs", "Rs.15 lacs and above
 * but less than Rs.1 crore", "Rs.1 crore & above") -- like state-bank-of-patiala/2003-portal and
 * bank-of-baroda/2002-interest-asp, RateRow has no way to keep more than one amount band inside a
 * single generic-reader pass, so this is a custom parser. Several captures additionally split
 * EACH band into two sub-columns, "(Existing) w.e.f. <old date>" and "Revised w.e.f. <new
 * date>" -- i.e. the page shows the immediately-preceding rate alongside the one just
 * announced. Only the "Revised" sub-column is read (the one actually in force as of the date
 * printed in that same cell); the "(Existing)" sub-column is not stored as its own card here --
 * whatever rate was actually in force before this capture's "Revised" date should already be
 * covered by an earlier capture of this same target (or is a gap, honestly left as one, rather
 * than backdated from this page's own "(Existing)" label without a capture confirming when that
 * earlier rate started). The first two bands (which have a finite upper amount) are stored as
 * `fd`; the open-ended "Rs.1 crore & above" band is stored as `fd_bulk`. This shape is read
 * generically enough (by scanning each column's own header text for "existing"/"revised" and
 * amount phrases, rather than hardcoding column positions) to tolerate a capture that drops the
 * Existing/Revised split back to one rate per band; if a future capture changes the table shape
 * more than that, it will simply report "no readable rate cells", not silently misread it.
 */
const bankOfIndia2009RupeeTermDeposit: HistoricalParser = (html, target) => {
  if (target.product !== "fd" && target.product !== "fd_bulk") {
    return {
      rows: [],
      effectiveFrom: null,
      tablesRead: 0,
      skipped: [`bank-of-india/2009-rupeetermdeposit does not support product "${target.product}" (this parser only reads the domestic/bulk rupee term-deposit table)`],
    };
  }
  const grid = extractTables(html).find((g) => /less than rs\.?\s*15\s*lacs/i.test(g.rows[0]?.join(" ") ?? "") && /1\s*crore/i.test(g.rows[0]?.join(" ") ?? ""));
  if (!grid) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"For deposits less than Rs.15 lacs / ... Rs.1 crore & above" table not found on this page'] };

  let h = 0;
  while (h < Math.min(3, grid.rows.length) && grid.rows[h].slice(1).every((c) => parseRate(c) === null)) h++;
  if (h === 0) h = 1;
  const width = Math.max(...grid.rows.map((r) => r.length));
  const bandRow = grid.rows[0];
  const subRow = h > 1 ? grid.rows[1] : null;
  const bands = Array.from({ length: width }, (_, c) => (c === 0 ? null : parseAmountBand(stripDateParentheticals(bandRow[c] ?? ""))));
  const wantBulk = target.product === "fd_bulk";
  const use: number[] = [];
  for (let c = 1; c < width; c++) {
    const band = bands[c];
    if (!band) continue;
    if (wantBulk !== (band.max === null)) continue; // fd wants a finite upper bound; fd_bulk wants the open-ended band
    const sub = (subRow?.[c] ?? "").toLowerCase();
    if (sub.includes("existing")) continue; // only the column actually in force as of its own printed date is read
    use.push(c);
  }
  if (use.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: [`no ${wantBulk ? "Rs.1 crore & above" : "below-Rs.1-crore"} rate column found in this table`] };

  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(h)) {
    const tenure = parseTenure(r[0] ?? "");
    if (!tenure) continue;
    for (const c of use) {
      const rate = parseRate(r[c] ?? "");
      if (rate === null) continue;
      const band = bands[c]!;
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
  if (rows.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no readable rate cells in the selected amount-band column(s)"] };

  // The effective date is read from the same "Revised w.e.f. <date>" cell the rates themselves
  // came from (falling back to the table's own preceding heading if no such cell exists),
  // never from the whole page: this page also carries a news-ticker blurb elsewhere with its own
  // "w.e.f." date for a possibly different, not-yet-tabulated revision.
  let effectiveFrom: string | null = null;
  if (subRow) {
    for (const c of use) {
      effectiveFrom = findEffectiveDate(subRow[c] ?? "");
      if (effectiveFrom) break;
    }
  }
  if (!effectiveFrom) effectiveFrom = findEffectiveDate(grid.context);
  return { rows, effectiveFrom, tablesRead: 1, skipped: [] };
};

const SBBJ_BAND_HEADING = /less than rs\.?\s*15\s*lacs/i;

/**
 * State Bank of Bikaner & Jaipur's sbbjbank.com/interest.htm (captured monthly 2001-2006) has
 * one "Revised Int(e)rst Rate on Domestic Term Deposit" table (the bank's own misspelling,
 * "Interst", not a transcription typo introduced here) with FOUR deposit-size bands ("Normal
 * Rates" for less than Rs.15 lacs, then three "Differential Rates on Single Deposits Only" bands:
 * 15 lacs-<1 crore, 1 crore-<5 crore, 5 crore & above). The three differential-rate cells print
 * the rate *and* its difference over the normal rate in one cell, e.g. "5.50 (0.50)" -- the
 * parenthesised delta is not itself a rate and is stripped before `parseRate` (which requires a
 * cell to be nothing but a bare number, so it would otherwise refuse the whole cell rather than
 * misread it -- this is a per-cell footnote-style suffix, not the same shared-code amount-band
 * bug as bank-of-baroda/2002-interest-asp above, so it is handled directly here rather than via
 * `stripDateParentheticals`). The table's own title row carries the effective date directly
 * ("w.e.f. 12.02.2001"), read from that row alone rather than the whole page, since a footer
 * "Co-Sponsor ... Conclave from 22nd Sept. to 24th Sept. 2000" elsewhere on some captures could
 * otherwise be mistaken for one (in practice `findEffectiveDate`'s own keyword requirement
 * already rules that specific text out, but bounding the search removes the risk generally).
 * The below-1-crore bands (Normal Rates + the 15-lacs-1-crore band) are stored as `fd`; the
 * 1-crore-and-above bands (1-5cr and 5cr-and-above) as `fd_bulk`, matching the retail/bulk split
 * used for Bank of India/Bank of Baroda elsewhere in this file. The title says "Domestic Term
 * Deposit" only (no NRO/NRE mention, unlike SBI's 1998 page or Bank of Baroda's), so this parser
 * only supports `fd`/`fd_bulk`; a separate `interest_nri.htm` on the same domain (captured the
 * same day, 2001-03-02) is a ready lead for NRI-scheme rates, not pursued here (lower priority).
 */
const sbbj2001DomesticTermDeposit: HistoricalParser = (html, target) => {
  if (target.product !== "fd" && target.product !== "fd_bulk") {
    return {
      rows: [],
      effectiveFrom: null,
      tablesRead: 0,
      skipped: [`state-bank-of-bikaner-and-jaipur/2001-domestic-term-deposit does not support product "${target.product}" (this page's title states it is domestic-only; see backfill/notes/psb-a.md)`],
    };
  }
  const grid = extractTables(html).find((g) => g.rows.some((r) => SBBJ_BAND_HEADING.test(r.join(" "))));
  if (!grid) {
    return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ['"Revised Interst Rate on Domestic Term Deposit" table (4 deposit-size bands) not found on this page'] };
  }
  const bandRowIdx = grid.rows.findIndex((r) => SBBJ_BAND_HEADING.test(r.join(" ")));
  const bandRow = grid.rows[bandRowIdx];
  const width = bandRow.length;
  const bands = Array.from({ length: width }, (_, c) => (c === 0 ? null : parseAmountBand(stripDateParentheticals(bandRow[c] ?? ""))));
  const wantBulk = target.product === "fd_bulk";
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(bandRowIdx + 1)) {
    const tenure = parseTenure(r[0] ?? "");
    if (!tenure) continue;
    for (let c = 1; c < width; c++) {
      const band = bands[c];
      if (!band) continue;
      // 1 crore-<5 crore and 5 crore & above are "fd_bulk"; less-than-15-lacs and
      // 15-lacs-<1-crore are "fd" -- both grouped by the same 1-crore boundary used elsewhere in
      // this file, not by the open/finite distinction (this page's own bands are all finite
      // except the last).
      const isBulkBand = band.min >= 10000000;
      if (wantBulk !== isBulkBand) continue;
      const cell = (r[c] ?? "").replace(/\(.*?\)/g, " ").trim(); // drop the "(+0.50)"-style delta-over-normal-rate suffix
      const rate = parseRate(cell);
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
  if (rows.length === 0) return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no readable rate cells in the Domestic Term Deposit table"] };
  const effectiveFrom = findEffectiveDate(grid.rows[0]?.join(" ") ?? "") ?? findEffectiveDate(grid.context);
  return { rows, effectiveFrom, tablesRead: 1, skipped: [] };
};

/**
 * bankofbaroda.com/interest.asp keeps the same URL across both layouts above (2002's Sr.No table,
 * 2003+'s Maturity-Range/yield table) -- and `replaceArchiveCards` (collectors/src/store.ts,
 * shared, out of this lane) identifies "this target's earlier cards" purely by
 * (bankSlug, product, sourceUrl), with no notion of "which parser produced them". Two separate
 * targets pointed at the same URL for the same product would each wipe out the other's cards on
 * every re-run, in file-order, leaving only whichever target happened to run last -- confirmed
 * live (running the 2002 and 2003 fd targets in sequence left only the 2003 parser's 4 cards; the
 * 2002 parser's own 3 cards, stored moments earlier by the exact same command, were gone).
 * This wrapper is the one parser actually referenced from `targets/psb-a.json` for this URL: one
 * target per product, trying the 2002 shape first and falling back to the 2003+ shape, so every
 * capture across both eras is grouped and stored together in a single `replaceArchiveCards` call.
 * The two underlying parsers stay individually exported/tested under their own keys above (their
 * own fixtures/tests are unaffected), since they are also useful to reason about (and test) in
 * isolation for their own eras.
 */
const bankOfBarodaInterestAsp: HistoricalParser = async (html, target) => {
  const first = await bankOfBaroda2002InterestAsp(html, target);
  if (first.rows.length > 0) return first;
  const second = await bankOfBaroda2003YieldTable(html, target);
  if (second.rows.length > 0) return second;
  return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: [...first.skipped, ...second.skipped] };
};

export const parsers: Record<string, HistoricalParser> = {
  "sbi/1998-multi-section": sbi1998MultiSection,
  "sbi/2001-product-page": sbi2001ProductPage,
  "state-bank-of-patiala/2003-portal": sbp2003Portal,
  "bank-of-baroda/2002-interest-asp": bankOfBaroda2002InterestAsp,
  "bank-of-baroda/2003-yield-table": bankOfBaroda2003YieldTable,
  "bank-of-baroda/interest-asp": bankOfBarodaInterestAsp,
  "bank-of-india/2009-rupeetermdeposit": bankOfIndia2009RupeeTermDeposit,
  "state-bank-of-bikaner-and-jaipur/2001-domestic-term-deposit": sbbj2001DomesticTermDeposit,
};
