/**
 * CSB Bank — csb.bank.in
 * Pages covered:
 *  - "Interest Rates" hub (interest-rates): domestic savings, domestic term deposits (general and
 *    senior-citizen tables are separate tables with matching tenor labels, not columns side by
 *    side), and the domestic non-callable retail table.
 *  - Domestic (Resident) Bulk Deposit PDF, linked from that same hub page as "Click Here" next to
 *    a heading that carries the effective date; the PDF filename itself is dated and 404s once
 *    superseded, so this adapter discovers the current link from the hub page every run instead
 *    of hardcoding a dated URL (the same pattern as Axis's FD PDF).
 *
 * SANDBOX BLOCKER, READ BEFORE TOUCHING active: every csb.bank.in content page is *sometimes*
 * redirected (302) to a Radware/ShieldSquare bot-management challenge at validate.perfdrive.com
 * (an hCaptcha page, confirmed by <title>Radware Captcha Page</title> and zero <table>s) and
 * *sometimes* returns the real page (200, genuine tables) — three plain `curl` requests a few
 * seconds apart in this session came back 200, 200, 302. It is intermittent rate-limiting, not a
 * hard block: the challenge page has no tables at all, so requireGrid() throws AdapterError on a
 * blocked run and the runner keeps the last good card and alerts, exactly the documented
 * fallback — a genuinely bad day here cannot corrupt the data, only delay a refresh. Given that,
 * this source is registered active:true with format "html" (plain fetch, no browser needed); if
 * it turns out to be blocked far more often on the real runner, flip active:false and note why.
 *
 * Quirks handled here:
 *  - General and senior FD rates are two separate tables (own captions, same tenor labels), not
 *    two columns of one table, so rows are matched by tenor label text rather than a
 *    general/senior ColumnSpec pair.
 *  - The savings table restates the *entire* incremental ladder inside every row's rate cell
 *    ("2.10% for amount upto Rs 1 Lakh<br>2.50% for amount above Rs 1 Lakh & up to Rs 25
 *    Lakh<br>...", growing by one clause per row), so this adapter reads only the last (fullest)
 *    row's cell and parses every clause out of it (same technique as Bandhan's savings footnote).
 *  - The bulk PDF's amount-band headers wrap across several lines in the extracted text (each
 *    boundary printed once as a lower bound and once as an upper bound); amountBandsFromHeader()
 *    below dedupes them into N boundaries for N rate columns, the same technique used for Axis's
 *    bulk PDF.
 */
import type { CustomerType, RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

function parseCsbTermGrid(grid: Grid, customer: CustomerType, callable = true): RateRow[] {
  const headerIdx = grid.rows.findIndex((r) => /^slab$/i.test(cleanText(r[0] ?? "")));
  if (headerIdx < 0) throw new AdapterError('CSB term-deposit table: no header row starting with "Slab"');
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(headerIdx + 1)) {
    const label = cleanText(r[1] ?? "");
    if (!label) continue;
    const rate = parseRate(r[2] ?? "");
    if (rate === null) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`CSB term-deposit table: cannot read tenor "${label}"`);
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer,
      residency: "resident",
      callable,
      payout: null,
      rate,
      note: callable ? undefined : "Non-callable (no premature withdrawal); RBI rules mean individuals depositing ₹1 crore or less always keep premature-withdrawal rights, so this row applies above ₹1 crore for individuals (bank's own footnote).",
    });
  }
  if (rows.length === 0) throw new AdapterError("CSB term-deposit table produced no rows");
  return rows;
}

export const csbFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const generalGrid = requireGrid(grids, (g) => /domestic term deposits/i.test(headerText(g, 1)) && !/senior citizen|tax saving/i.test(headerText(g, 1)), "domestic term-deposit table (general)");
  const seniorGrid = grids.find((g) => /senior citizen term deposits/i.test(headerText(g, 1)) && !/tax saving/i.test(headerText(g, 1)));
  const nonCallableGrid = grids.find((g) => /non-callable deposits/i.test(headerText(g, 1)));
  const effectiveFrom = findEffectiveDate(headerText(generalGrid, 1));
  if (!effectiveFrom) throw new AdapterError("CSB FD: effective date not found in the table caption");

  const rows = parseCsbTermGrid(generalGrid, "general");
  const notes: string[] = [];
  if (seniorGrid) {
    rows.push(...parseCsbTermGrid(seniorGrid, "senior"));
    notes.push("Senior-citizen rates are published as a separate table (own caption) matched here by tenor label, not as a column next to general.");
  } else {
    notes.push("Senior-citizen table not found on this page/fixture; only general rates are published in this card.");
  }
  if (nonCallableGrid) {
    rows.push(...parseCsbTermGrid(nonCallableGrid, "general", false));
  }

  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes })],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "Bank states the senior-citizen premium on resident term deposits (see the page's notes list, not a table) — check the current figure on the page as it has changed before (0.15% -> 0.25% p.a. in one revision seen this session); this adapter reads the printed senior table rather than adding a premium itself.",
        prematurePenalty: "1% below the card rate for the period held, or the contracted rate, whichever is lower (bank's own wording); non-callable rows cannot be withdrawn before maturity at all.",
      },
    ],
  };
};

const CALLABLE_CAPTION = /INTEREST RATES \(P\.A\.\) ON DOMESTIC CALLABLE[^\n]*/i;
const NON_CALLABLE_CAPTION = /INTEREST RATES \(P\.A\.\) ON NON-CALLABLE DOMESTIC[^\n]*/i;

function sectionAfter(text: string, captionRe: RegExp): { caption: string; body: string } {
  const m = captionRe.exec(text);
  if (!m) throw new AdapterError(`CSB bulk PDF: section not found (${captionRe})`);
  const from = m.index + m[0].length;
  const rest = text.slice(from);
  const end = /\n\d\)\s*INTEREST RATES/i.exec(rest);
  return { caption: m[0], body: end ? rest.slice(0, end.index) : rest };
}

/** The amount-band header wraps across several lines with each boundary printed once as a lower
 * bound and once as an upper bound (e.g. "...to Rs 10 Crore" then "Rs 10 crore to..."); dedupe
 * into N boundaries for N rate columns and build [low, high) bands, the last one open-ended. */
function amountBandsFromHeader(headerBlock: string, expectedBands: number): Array<{ min: number; max: number | null }> {
  const seen = new Set<number>();
  const boundaries: number[] = [];
  for (const n of amountsIn(headerBlock)) {
    if (!seen.has(n)) {
      seen.add(n);
      boundaries.push(n);
    }
  }
  if (boundaries.length !== expectedBands) {
    throw new AdapterError(`CSB bulk PDF: expected ${expectedBands} amount-band boundaries in the header, found ${boundaries.length} (${boundaries.join(", ")})`);
  }
  return boundaries.map((b, i) => ({ min: b, max: i < boundaries.length - 1 ? boundaries[i + 1] : null }));
}

function parseBulkSection(text: string, captionRe: RegExp, firstRowRe: RegExp, bandCount: number, callable: boolean): { effectiveFrom: string | null; rows: RateRow[] } {
  const section = sectionAfter(text, captionRe);
  const effectiveFrom = parseDate(section.caption);
  const headerEnd = section.body.search(firstRowRe);
  if (headerEnd < 0) throw new AdapterError(`CSB bulk PDF: first data row not found in "${captionRe}" section`);
  const bands = amountBandsFromHeader(section.body.slice(0, headerEnd), bandCount);

  const tail = Array.from({ length: bandCount }, () => String.raw`(\d+(?:\.\d+)?)%`).join(String.raw`\s+`);
  const rowRe = new RegExp(`^(\\d+)\\s+(.+?)\\s+${tail}\\s*$`);
  const rows: RateRow[] = [];
  for (const raw of section.body.split(/\n/)) {
    const line = cleanText(raw);
    if (!line) continue;
    const m = rowRe.exec(line);
    if (!m) continue;
    const label = m[2].trim();
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`CSB bulk PDF: cannot read tenor "${label}"`);
    const rates = m.slice(3, 3 + bandCount).map(Number);
    bands.forEach((band, i) => {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate: rates[i],
      });
    });
  }
  if (rows.length === 0) throw new AdapterError(`CSB bulk PDF: no rows matched in "${captionRe}" section`);
  return { effectiveFrom, rows };
}

const BULK_LINK_RE = /href="([^"]*\/pdf\/Interest-Rates-on-Domestic-Resident-Bulk-Deposit[^"]*\.pdf)"/i;

function discoverBulkPdfUrl(html: string, baseUrl: string): string {
  const m = BULK_LINK_RE.exec(html);
  if (!m) throw new AdapterError('CSB: "Domestic (Resident) Bulk Deposit" PDF link not found on the interest-rates page — layout may have changed');
  return new URL(m[1], baseUrl).toString();
}

export const csbBulk: Adapter = async (ctx) => {
  const pdfUrl = discoverBulkPdfUrl(ctx.doc.text, ctx.doc.finalUrl || ctx.source.url);
  const doc = await ctx.fetch(pdfUrl, "pdf");
  const text = doc.text;

  const callable = parseBulkSection(text, CALLABLE_CAPTION, /\n1\s+7 days/, 6, true);
  const nonCallable = parseBulkSection(text, NON_CALLABLE_CAPTION, /\n1\s+1 Months/, 7, false);
  const effectiveFrom = callable.effectiveFrom ?? nonCallable.effectiveFrom;
  if (!effectiveFrom) throw new AdapterError("CSB bulk PDF: effective date not found in either table's caption");

  const card = makeCard(ctx, "fd_bulk", [...callable.rows, ...nonCallable.rows], {
    effectiveFrom,
    sourceUrl: doc.finalUrl || pdfUrl,
    notes: ["No senior-citizen column is published for bulk deposits; Callable and Non-Callable are two separate tables with different amount-band splits (6 bands vs 7)."],
  });
  return { cards: [card], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE }] };
};

interface SlabClause {
  rate: number;
  lo: number;
  hi: number | null;
}

/** The savings table restates the whole ladder inside every row's rate cell; the last (fullest)
 * row's cell has every clause, e.g. "2.10% for amount upto Rs 1 Lakh2.50% for amount above Rs 1
 * Lakh & up to Rs 25 Lakh...7.40% for amount above Rs 300 Crore". */
function parseCumulativeSlabCell(cell: string): SlabClause[] {
  const clauses = cell
    .split(/(?<![\d.])(?=\d+(?:\.\d+)?%\s*for amount)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: SlabClause[] = [];
  for (const clause of clauses) {
    const rateM = /(\d+(?:\.\d+)?)%/.exec(clause);
    if (!rateM) continue;
    const rate = Number(rateM[1]);
    const rangeM = /above\s+(.+?)\s*(?:&|and)\s*up\s*to\s+(.+?)(?=,\s|\.|$)/i.exec(clause);
    if (rangeM) {
      out.push({ rate, lo: amountsIn(rangeM[1])[0], hi: amountsIn(rangeM[2])[0] });
      continue;
    }
    const uptoM = /(?:up\s*to|upto)\s+(.+?)(?=,\s|\.|$)/i.exec(clause);
    if (uptoM && !/above/i.test(clause)) {
      out.push({ rate, lo: 0, hi: amountsIn(uptoM[1])[0] });
      continue;
    }
    const openM = /above\s+(.+?)(?=,\s|\.|$)/i.exec(clause);
    if (openM) {
      out.push({ rate, lo: amountsIn(openM[1])[0], hi: null });
      continue;
    }
    throw new AdapterError(`CSB savings: cannot read slab clause "${clause}"`);
  }
  if (out.length === 0) throw new AdapterError("CSB savings: no slab clauses found in the cell");
  return out;
}

export const csbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /domestic savings bank deposits/i.test(headerText(g, 1)), "savings table");
  const effectiveFrom = findEffectiveDate(headerText(grid, 1));
  const lastRow = grid.rows.at(-1);
  const cell = cleanText(lastRow?.[2] ?? "");
  if (!cell) throw new AdapterError("CSB savings: last slab row has no rate cell to read");
  const clauses = parseCumulativeSlabCell(cell);
  const slabs: SavingsSlab[] = clauses.map((c, i) => ({
    balanceMin: i === 0 ? c.lo : c.lo + 1,
    balanceMax: c.hi === null ? null : c.hi + 1,
    rate: c.rate,
    residency: "resident",
  }));
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: "incremental",
        notes: ['Bank\'s own wording is stacked "for amount above X & up to Y" clauses per slab, confirming incremental application.'],
      }),
    ],
  };
};
