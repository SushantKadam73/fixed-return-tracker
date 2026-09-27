/**
 * Bank of Baroda — bankofbaroda.bank.in
 *
 * Pages covered:
 *  - Fixed Deposits Callable & Non-Callable upto ₹10 Crore ("retail" adapter reads the <3cr
 *    callable + ₹1-3cr non-callable tables; "bulk" adapter reads the ₹3-10cr callable +
 *    non-callable tables on the SAME page)
 *  - Fixed Deposits Callable & Non-Callable above ₹10 Crore (fetched by the bulk adapter via
 *    ctx.fetch and merged into the SAME fd_bulk card — see note below)
 *  - Savings Bank Deposits
 *  - Fixed Deposits (Tax Saving) — own page, read by the `tax_saver` adapter
 *
 * Quirks:
 *  - BoB does not publish a separate "below ₹3 crore" retail-only page: the "upto ₹10 crore"
 *    page carries both the retail (<3cr) and small-bulk (3-10cr) tables side by side, each in
 *    a callable and a non-callable variant. The "above ₹10 crore" table lives on its own page
 *    with amount bands up to "above ₹1000 crore".
 *  - The bulk adapter merges BOTH bulk pages (3-10cr and >10cr) into one `fd_bulk` card via
 *    `ctx.fetch`, instead of registering two sources for the same product: the repo-backed
 *    store (`collectors/src/store.ts`) keeps only the latest card per (bank, product), so two
 *    independent sources writing `fd_bulk` would race and each run would silently discard the
 *    other page's amount bands. If the above-10cr fetch fails, the card still ships with the
 *    3-10cr rows and a warning is returned (not an error) — losing that supplementary page
 *    should not block the primary 3-10cr rates.
 *  - One tenure row is printed as "271 days & above and less than 1 year". The shared tenure
 *    parser (`parseTenure`) splits ranges on the FIRST " and " that precedes "less/below/upto",
 *    which for this label lands on "...above AND LESS than 1 year" and leaves the lower phrase
 *    as "271 days and above" (its own OPEN_END branch not taken because an upper half exists),
 *    then fails to strip "less than" (already consumed by the split) so the upper bound comes
 *    out as 365 instead of 364. Rather than edit the shared parser, this adapter recognises the
 *    exact phrase locally and computes the 271-364 day range itself.
 *  - "bob Square Drive Deposit Scheme (444 Days)" / "bob Golden Goal deposit Scheme (555 Days)"
 *    sit inside the ordinary tenure column. `parseTenure` drops any "(...)" content (so it can
 *    ignore notes like "(Tax Saver)"), which here would strip the only digits in the label. This
 *    adapter recognises the two scheme names by name and reads the day count with its own regex
 *    instead, keeping the bank's exact label text in `tenureLabel`.
 *  - "Above 10 years (MACAD only)" has no stated upper bound; the tracker's tenure range tops
 *    out at 10 years (`TENURE_MAX_DAYS` in lib/validate.ts), so this row is skipped rather than
 *    guessing a cap, and a note says so.
 *  - No RD adapter: the research survey's claim that BoB states "RD rate = FD card rate" could
 *    not be found verbatim anywhere in the saved bob_rd_sdp fixture (checked directly), only
 *    generic senior/staff-premium language. Re-checked live on 2026-09-27 against the bob SDP
 *    page and the bob Lakhpati/Millionaire/Crorepati/Flexible RD scheme pages (the only other RD
 *    product pages linked from the site) and the RD index page's own FAQ, which just points back
 *    to the ordinary Deposits Interest Rates page for "latest interest rates" — a page that has
 *    no Recurring Deposit tab at all (Savings/Tax-Saving FD/FCNR/FD-upto-10cr/Green FD/FD-above-
 *    10cr only). None of these pages carries a rate table or an "RD = FD" statement, so RD stays
 *    uncovered for this bank rather than guessing or derived from FD.
 *  - Tax Saver FD: a genuine, separate page ("Fixed Deposits (Tax Saving)", same accordion-style
 *    "Deposits Interest Rates" template as the FD/savings pages) publishes exactly one row (5
 *    years, the statutory 80C lock-in) for General/Senior/Super Senior. A second "Above 5 years
 *    to up to 10 years" row exists in the page's raw markup but is wrapped in an HTML comment
 *    (confirmed on the live page 2026-09-27) — i.e. deliberately not rendered by the bank itself,
 *    so it is correctly invisible to `extractTables` and is not published.
 *  - Shared-parser gap (worked around locally, not fixed in parse/common.ts): `parseRate` only
 *    strips the footnote markers "*#@^" before parsing a cell. BoB's two named-scheme rows use
 *    "$" as a footnote marker on real super-senior rates (e.g. "7.05$" for bob Square Drive),
 *    so the shared parser silently read those four cells as "no rate" and dropped them.
 *    `readRate()` below strips "$" too before delegating to `parseRate`.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseRate as parseRateShared } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const ABOVE_10CR_URL =
  "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/fixed-deposits-callable-and-non-callable-above-ten-crores";

/** `parseRate` strips "*#@^" but not BoB's own "$" footnote marker — see file header note. */
function readRate(cell: string): number | null {
  return parseRateShared(cell.replace(/\$/g, ""));
}

/**
 * `parseAmountBand`/`amountsIn` strip a leading "Rs." by matching the bare regex `rs\.?`
 * anywhere in the string — which also eats the "rs" hiding inside BoB's "Crs" (crores)
 * abbreviation, e.g. "3.00 Crs" loses its "cr" and is read as the bare number 3 instead of
 * ₹3 crore. Expanding "Crs" to "Crore" first (shared parser left untouched) avoids that.
 */
function readAmountBand(label: string) {
  return parseAmountBand(label.replace(/\bcrs\b/gi, "crore"));
}

// -- table finders (matched on the caption/lead-in text `extractTables` captures, not on cell
//    contents, because BoB's callable/non-callable/amount-band tables share column headers) --
const isRetailCallable = (g: Grid) => /domestic term deposits including nro deposits below/i.test(g.context);
const isRetailNonCallable = (g: Grid) => /minimum single deposit above/i.test(g.context) && /below.*3\s*crores?/i.test(g.context);
const isBulkCallable = (g: Grid) => /domestic term deposits (&|and) nro deposits/i.test(g.context) && /3\.00 crores? to/i.test(g.context);
const isBulkNonCallable = (g: Grid) => /domestic term deposits including nre\/nro of/i.test(g.context) && /3\.00 crores? to/i.test(g.context);
const isBulkAboveCallable = (g: Grid) => /domestic term deposits including nro deposits of above/i.test(g.context);
const isBulkAboveNonCallable = (g: Grid) => /\(domestic\) accounts of above/i.test(g.context);
const isSavings = (g: Grid) => /sb deposits/i.test(g.context) && /slab/i.test(g.context);
const isTaxSaver = (g: Grid) => /tax saving/i.test(g.context) && /baroda tax savings/i.test(g.context);

const SCHEME_NAMES: ReadonlyArray<readonly [RegExp, string, number]> = [
  [/\bbob square drive\b/i, "bob Square Drive Deposit Scheme", 444],
  [/\bbob golden goal\b/i, "bob Golden Goal Deposit Scheme", 555],
];

/** "271 days & above and less than 1 year" -> 271-364 days. See file header note. */
function parse271Days(label: string): { minDays: number; maxDays: number; point: boolean } | null {
  const m = /^(\d+)\s*days?\s*(?:&|and)\s*above\s+and\s+less than\s+1\s*year$/i.exec(cleanText(label));
  return m ? { minDays: Number(m[1]), maxDays: 364, point: false } : null;
}

/**
 * Tenure x {General, Senior, Super Senior} tables (retail <3cr and non-callable ₹1-3cr).
 * Written by hand instead of `parseTermTable` so the 271-day and named-scheme rows above can
 * be recognised without mangling the tenure label the generic parser would otherwise choke on.
 */
function retailColumns(grid: Grid, opts: { amountMin: number; amountMax: number; callable: boolean }, notes: string[]): RateRow[] {
  const headers = grid.rows[0] ?? [];
  const gi = headers.findIndex((h) => /general/i.test(h));
  const si = headers.findIndex((h) => /senior citizen|sr\.?\s*citizen/i.test(h) && !/super/i.test(h));
  const ssi = headers.findIndex((h) => /super senior/i.test(h));
  if (gi < 0 || si < 0 || ssi < 0) throw new AdapterError(`bank-of-baroda: General/Senior/Super-Senior columns not found in headers "${headers.join(" | ")}"`);
  const cols = [
    ["general", gi],
    ["senior", si],
    ["super_senior", ssi],
  ] as const;

  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(1)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    if (/macad/i.test(label)) {
      notes.push(`Dropped the "${label}" row: no stated upper bound, and the tracker's tenure range tops out at 10 years.`);
      continue;
    }
    const scheme = SCHEME_NAMES.find(([re]) => re.test(label));
    const tenure = parse271Days(label) ?? (scheme ? { minDays: scheme[2], maxDays: scheme[2], point: true } : parseTenure(label));
    if (!tenure) throw new AdapterError(`bank-of-baroda: cannot read retail tenure "${label}"`);
    for (const [customer, idx] of cols) {
      const rate = readRate(row[idx] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: scheme ? true : tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        schemeName: scheme?.[1],
        amountMin: opts.amountMin,
        amountMax: opts.amountMax,
        customer,
        residency: "resident",
        callable: opts.callable,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("bank-of-baroda: retail table produced no rows");
  return rows;
}

/**
 * Tenure x amount-band tables (bulk ₹3-10cr and ₹>10cr): every column is a different deposit
 * size, all at the "general public" rate (no senior premium is printed for bulk deposits).
 */
function parseAmountBandedBulk(grid: Grid, callable: boolean): RateRow[] {
  // The number of header rows varies: the ₹3-10cr tables carry a merged group-label row above
  // the specific band-label row (2 header rows), but the >₹10cr non-callable table has only
  // the band-label row itself (1). Detect it the same way `parseTermTable` does, rather than
  // assuming a fixed offset.
  let headerRows = 0;
  for (const row of grid.rows) {
    if (row.slice(1).some((c) => readRate(c) !== null)) break;
    headerRows++;
    if (headerRows >= 4) break;
  }
  headerRows = Math.max(1, headerRows);
  const bandHeaders = grid.rows[headerRows - 1]?.slice(1) ?? [];
  const bands = bandHeaders.map((h) => readAmountBand(h));
  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(headerRows)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parse271Days(label) ?? parseTenure(label);
    if (!tenure) throw new AdapterError(`bank-of-baroda: cannot read bulk tenure "${label}"`);
    row.slice(1).forEach((cell, i) => {
      const rate = readRate(cell);
      if (rate === null) return;
      const band = bands[i];
      if (!band) throw new AdapterError(`bank-of-baroda: cannot read amount-band header "${bandHeaders[i]}"`);
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
  if (rows.length === 0) throw new AdapterError("bank-of-baroda: bulk amount-banded table produced no rows");
  return rows;
}

export const bankOfBarodaFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callable = requireGrid(grids, isRetailCallable, "retail callable <3cr table");
  const nonCallable = requireGrid(grids, isRetailNonCallable, "retail non-callable ₹1-3cr table");
  const effectiveFrom = findEffectiveDate(callable.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-baroda: retail effective date not found");

  const notes: string[] = [];
  const rows = [
    ...retailColumns(callable, { amountMin: 0, amountMax: 3 * CRORE, callable: true }, notes),
    ...retailColumns(nonCallable, { amountMin: CRORE + 1, amountMax: 3 * CRORE, callable: false }, notes),
  ];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes: notes.length > 0 ? notes : undefined });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% (some tenure bands carry a further +0.10 to +0.60% for senior/super-senior — see the bank's own footnote markers on the rate table)",
        prematurePenalty: "No penalty up to ₹5 lakh held at least 12 months; not permitted at all on non-callable deposits",
      },
    ],
  };
};

export const bankOfBarodaBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callable = requireGrid(grids, isBulkCallable, "bulk callable ₹3-10cr table");
  const nonCallable = requireGrid(grids, isBulkNonCallable, "bulk non-callable ₹3-10cr table");
  const effectiveFrom = findEffectiveDate(callable.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-baroda: bulk effective date not found");

  const rows = [...parseAmountBandedBulk(callable, true), ...parseAmountBandedBulk(nonCallable, false)];
  const warnings: string[] = [];
  try {
    const above = await ctx.fetch(ABOVE_10CR_URL, "html");
    const aGrids = extractTables(above.text);
    const aCallable = requireGrid(aGrids, isBulkAboveCallable, "bulk callable >10cr table");
    const aNonCallable = requireGrid(aGrids, isBulkAboveNonCallable, "bulk non-callable >10cr table");
    rows.push(...parseAmountBandedBulk(aCallable, true), ...parseAmountBandedBulk(aNonCallable, false));
  } catch (e) {
    warnings.push(`bank-of-baroda: could not add the above-₹10-crore band page (${(e as Error).message}); this card covers ₹3-10 crore only`);
  }

  const bulk = makeCard(ctx, "fd_bulk", rows, { effectiveFrom });
  return { cards: [bulk], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "Not permitted on non-callable deposits" }], warnings };
};

export const bankOfBarodaSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, isSavings, "savings slab table");
  const effectiveFrom = findEffectiveDate(g.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-baroda: savings effective date not found");

  const slabs: SavingsSlab[] = g.rows.slice(1).map((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = readRate(r[1] ?? "");
    if (rate === null) throw new AdapterError(`bank-of-baroda: cannot read savings rate for slab "${label}"`);
    const band = readAmountBand(label);
    if (!band) throw new AdapterError(`bank-of-baroda: cannot read savings balance slab "${label}"`);
    return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
  });
  if (slabs.length === 0) throw new AdapterError("bank-of-baroda: no savings slabs found");
  // The page states each slab's rate without saying whether it applies to the whole balance or
  // incrementally, so per collectors/README.md this stays "unknown" rather than a guess.
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};

/**
 * Baroda Tax Savings Fixed Deposit — a separate page (own accordion tab) from the retail FD
 * page, publishing only the statutory 5-year (60-month) lock-in tenure for General/Senior/Super
 * Senior. No amount band is printed (tax-saver deposits are capped by the ₹1.5 lakh/PAN/FY 80C
 * limit, not by a bulk-deposit band), so amountMax is left null rather than assumed.
 */
export const bankOfBarodaTaxSaver: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, isTaxSaver, "tax-saving FD table");
  const effectiveFrom = findEffectiveDate(g.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-baroda: tax-saver effective date not found");

  const headers = g.rows[0] ?? [];
  const gi = headers.findIndex((h) => /general public/i.test(h));
  const si = headers.findIndex((h) => /senior citizen/i.test(h) && !/super/i.test(h));
  const ssi = headers.findIndex((h) => /super senior/i.test(h));
  if (gi < 0 || si < 0 || ssi < 0) throw new AdapterError(`bank-of-baroda: General/Senior/Super-Senior columns not found in tax-saver headers "${headers.join(" | ")}"`);
  const cols = [
    ["general", gi],
    ["senior", si],
    ["super_senior", ssi],
  ] as const;

  const rows: RateRow[] = [];
  for (const row of g.rows.slice(1)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`bank-of-baroda: cannot read tax-saver tenure "${label}"`);
    for (const [customer, idx] of cols) {
      const rate = readRate(row[idx] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: 0,
        amountMax: null,
        customer,
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("bank-of-baroda: tax-saver table produced no rows");
  return {
    cards: [
      makeCard(ctx, "tax_saver", rows, {
        effectiveFrom,
        notes: [
          "Statutory 5-year (60-month) lock-in Tax Saving FD (Section 80C); max ₹1,50,000 per PAN per financial year. The bank's page markup also contains an 'Above 5 years to up to 10 years' row wrapped in an HTML comment (not rendered), so only the 5-year row is published.",
        ],
      }),
    ],
  };
};
