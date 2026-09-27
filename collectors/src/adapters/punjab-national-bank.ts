/**
 * Punjab National Bank — pnb.bank.in
 *
 * Pages covered:
 *  - Interest-Rates-Deposit.html: savings slabs (+ a savings-rate history back to 2011, not
 *    captured here — optional per the brief), retail domestic/NRO FD (<₹3 crore), "PNB Uttam"
 *    non-callable FD (>₹1 crore to <₹3 crore), and the ₹3-10 crore bulk band (callable +
 *    non-callable) — all on one page.
 *  - interest-rates-bulk-deposit.html: a landing page whose "Click here to Download" link
 *    points at a session-tokenised `downloadprocess.aspx?fid=...` PDF that changes every time
 *    the bank republishes it. The bulk adapter re-derives this link from the landing page on
 *    every run (via `ctx.fetch`) rather than hardcoding a fid, then also re-fetches the deposit
 *    page for the ₹3-10 crore band so the whole `fd_bulk` card comes from one adapter call.
 *
 * Quirks handled locally (see comments below for why each is NOT a fix to the shared parsers):
 *  - PNB's page wraps its ENTIRE body in one ASP.NET `<form id="aspnetForm">` (common on .aspx
 *    sites). `collectors/scripts/trim-fixture.ts` drops every `<form>` wholesale, which for most
 *    banks only removes a stray search box but for PNB deletes the whole page. The fixtures for
 *    this bank were produced by unwrapping (not removing) `<form>` before running the normal
 *    trim script — see the note left for the trim script's maintainers in the final report.
 *  - The same page is also wrapped for `interest-rates-bulk-deposit.html`; on top of that,
 *    `trim-fixture.ts` keeps only `rowspan`/`colspan` attributes, which drops the `href` this
 *    adapter actually needs to read. The bulk-landing fixture therefore also keeps `href` on
 *    `<a>` (again done outside the shared script, not by editing it).
 *  - Savings-slab labels are compound English text, e.g. "Saving Fund Account Balance > Rs. 100
 *    Crore <= Rs. 500 Crore". The shared `parseAmountBand` expects the amount phrase to be the
 *    whole label (its "lower bound is exclusive" test is anchored to the START of the string),
 *    so a label with descriptive text in front never reads as exclusive and slabs would overlap.
 *    `pnbSavingsBand()` below reads these compound labels directly instead of calling the shared
 *    parser.
 *  - The bulk (₹3-10 crore) table prints BOTH the previous ("Existing") and new ("Revised") rate
 *    for two products (plain vs "PNB Uttam" non-callable) side by side. Column selection needs a
 *    two-word lookahead (e.g. "has 'revised' AND 'uttam'") that a single `RegExp.test` can still
 *    express, so no shared-file change was needed there — just documented in the column specs.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter, FetchedDoc } from "../types";
import { AdapterError, CRORE, headerEffectiveDate, headerText, makeCard, requireGrid } from "./helpers";

const DEPOSIT_PAGE_URL = "https://pnb.bank.in/Interest-Rates-Deposit.html";
const BULK_LANDING_URL = "https://pnb.bank.in/interest-rates-bulk-deposit.html";
const SCHEME_NAMES: Record<number, string> = { 1204: "PNB Palaash" };

/**
 * PNB's savings-history table writes slabs as "Saving Fund Account Balance Up to Rs. 100 Crore"
 * / "... > Rs. 100 Crore <= Rs. 500 Crore" / "... > Rs. 2,000 Crore". `parseAmountBand` (shared)
 * can't read these because its exclusivity check requires the amount phrase to be the start of
 * the string. Read the printed ">"/"<="/"Up to" operators directly instead.
 */
function pnbSavingsBand(label: string): { min: number; max: number | null } {
  const nums = amountsIn(label);
  if (nums.length === 0) throw new AdapterError(`cannot read PNB savings slab "${label}"`);
  if (/up ?to/i.test(label) && !/>/.test(label)) return { min: 0, max: nums[0] + 1 };
  const hasLower = />\s*rs/i.test(label);
  const hasUpper = /<=\s*rs/i.test(label);
  if (hasLower && hasUpper) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (hasLower && !hasUpper) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised PNB savings slab "${label}"`);
}

function findDepositGrids(html: string) {
  const grids = extractTables(html);
  const savings = requireGrid(grids, (g) => /saving deposit interest rate/i.test(headerText(g, 1)), "savings table");
  const retail = requireGrid(grids, (g) => /^domestic\/nro/i.test(headerText(g, 1)), "retail <3cr table");
  const uttamRetail = requireGrid(
    grids,
    (g) => /pnb uttam/i.test(headerText(g, 1)) && /less than rs\.?\s*3\s*crore/i.test(headerText(g, 1)),
    "PNB Uttam non-callable (1-3cr) table",
  );
  const bulk35 = requireGrid(grids, (g) => /3\s*cr\.?\s*to\s*10\s*cr/i.test(headerText(g, 1)), "3-10cr bulk table");
  return { savings, retail, uttamRetail, bulk35 };
}

function parseSavings(g: Grid) {
  const effectiveFrom = parseDate(g.rows[1]?.[1] ?? "") ?? null;
  const slabs: SavingsSlab[] = g.rows.slice(2).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    const band = pnbSavingsBand(cleanText(r[0] ?? ""));
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no PNB savings slabs found");
  return { effectiveFrom, slabs };
}

/** Retail <3cr and PNB Uttam (1-3cr non-callable) tables share the same column layout. */
function parseRetailLikeTable(g: Grid, amountMin: number, amountMax: number, callable: boolean): RateRow[] {
  return parseTermTable(g, {
    columns: [
      { header: /revised rates for public/i, customer: "general" },
      { header: /revised rates for senior citizens/i, customer: "senior", exclude: /super senior/i },
      { header: /revised rates for super senior citizens/i, customer: "super_senior" },
    ],
    amountMin,
    amountMax,
    callable,
    schemeNames: SCHEME_NAMES,
  });
}

export const pnbFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const { savings, retail, uttamRetail } = findDepositGrids(html);

  const retailEffectiveFrom = headerEffectiveDate(retail, /revised rates for public/i);
  if (!retailEffectiveFrom) throw new AdapterError("effective date not found on PNB retail FD table");
  const rows = parseRetailLikeTable(retail, 0, 3 * CRORE, true);
  rows.push(...parseRetailLikeTable(uttamRetail, CRORE + 1, 3 * CRORE, false));

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom: retailEffectiveFrom,
    notes: [
      "Senior citizens (60 to <80): +50bps up to 5 years, +80bps beyond 5 years over the card rate (not printed as a number).",
      "Retired-staff senior citizens: up to +150bps (<=5y) / +180bps (>5y) over the card rate (not printed as a number).",
      "Super senior citizens (80+): +80bps over the card rate across all maturities (retired-staff super seniors: up to +180bps); not printed as a number beyond the *,# columns already included above.",
    ],
  });

  const { effectiveFrom: savingsEffectiveFrom, slabs } = parseSavings(savings);
  const savingsCard = makeCard(ctx, "savings", [], { effectiveFrom: savingsEffectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" });

  return {
    cards: [fd, savingsCard],
    terms: [
      { product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+50bps (<=5y) / +80bps (>5y)", superSeniorPremium: "+80bps across all maturities" },
    ],
  };
};

/** The exact text of the visible "Click here to Download" link on PNB's bulk-deposit landing page. */
function findBulkPdfUrl(doc: FetchedDoc): string {
  const m = /<a href="([^"]+)"[^>]*>\s*Click here to Download/i.exec(doc.text);
  if (!m) throw new AdapterError("PNB bulk-deposit download link not found on landing page");
  return new URL(m[1], doc.finalUrl || doc.url).toString();
}

/**
 * PNB's own PDF text (via unpdf) interleaves several tables and loses the row/number alignment
 * for anything past the first ("Callable") block — e.g. the Non-Callable >₹10cr block's tenure
 * labels are extracted in a different order than its rates. Only the Callable block keeps every
 * number on the SAME line as its tenure label (`<label> r1 r2 r3 r4 <5th-col-or-XXX>`), so only
 * that block is read; everything else is skipped rather than guessed. The unlabelled 5th column
 * is PNB's NRE rate (RBI requires NRE deposits to run >=1 year, which is why every row except
 * "1 year" prints "XXX" there) — out of scope for this adapter, so it is read and discarded.
 */
const ABOVE_10CR_BANDS: Array<{ min: number; max: number | null }> = [
  { min: 10 * CRORE + 1, max: 25 * CRORE + 1 },
  { min: 25 * CRORE + 1, max: 100 * CRORE + 1 },
  { min: 100 * CRORE + 1, max: 500 * CRORE + 1 },
  { min: 500 * CRORE + 1, max: 1000 * CRORE + 1 },
];

function parseAbove10CrCallable(pdfText: string): RateRow[] {
  const rows: RateRow[] = [];
  const lineRe = /^(.+?)\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})\s+\S+\s*$/;
  for (const line of pdfText.split("\n")) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    const label = cleanText(m[1]);
    const range = parseTenure(label);
    if (!range) continue; // a non-tenure line (e.g. a stray heading) happened to match the numeric shape
    for (let b = 0; b < 4; b++) {
      const rate = parseRate(m[2 + b]);
      if (rate === null) continue;
      rows.push({
        tenureMinDays: range.minDays,
        tenureMaxDays: range.maxDays,
        tenureLabel: label,
        special: range.minDays === range.maxDays && range.minDays % 365 !== 0 ? true : undefined,
        amountMin: ABOVE_10CR_BANDS[b].min,
        amountMax: ABOVE_10CR_BANDS[b].max,
        customer: "general",
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    }
  }
  return rows;
}

export const pnbBulk: Adapter = async (ctx) => {
  const bulkPdfUrl = findBulkPdfUrl(ctx.doc);
  const pdf = await ctx.fetch(bulkPdfUrl, "pdf");
  const above10cr = parseAbove10CrCallable(pdf.text);
  const above10crDate = findEffectiveDate(pdf.text);

  const depositDoc = await ctx.fetch(DEPOSIT_PAGE_URL, "html");
  const { bulk35 } = findDepositGrids(depositDoc.text);
  const bulk35EffectiveFrom = headerEffectiveDate(bulk35, /revised rates for public/i);
  if (!bulk35EffectiveFrom) throw new AdapterError("effective date not found on PNB 3-10cr bulk table");

  const callable35 = parseTermTable(bulk35, {
    columns: [{ header: /(?=.*revised)(?=.*domestic fixed deposit scheme)/i, customer: "general" }],
    amountMin: 3 * CRORE,
    amountMax: 10 * CRORE,
    callable: true,
  });
  const nonCallable35 = parseTermTable(bulk35, {
    columns: [{ header: /(?=.*revised)(?=.*uttam)/i, customer: "general" }],
    amountMin: 3 * CRORE,
    amountMax: 10 * CRORE,
    callable: false,
  });

  const rows = [...callable35, ...nonCallable35, ...above10cr];
  const notes = [
    "Rows above ₹10 crore cover only the callable table from the bulk-deposit PDF; the PDF's Non-Callable >₹10cr table and its NRE column are not read because unpdf's text extraction does not keep their tenure labels aligned with their rates (see file header).",
    above10crDate ? `The >₹10 crore PDF band is dated ${above10crDate} in the document text.` : "The >₹10 crore PDF band carries no readable date.",
  ];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom: bulk35EffectiveFrom, notes })] };
};
