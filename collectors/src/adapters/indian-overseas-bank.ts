/**
 * Indian Overseas Bank — iob.bank.in
 *
 * Pages covered:
 *  - domestic-nro-nre-retail-term-deposit-rates: retail domestic FD (<₹3 crore) and the Bulk
 *    Deposit table (₹3 crore and above, callable + non-callable) on the same page.
 *  - savings-interest-rates: savings bank slabs (a separate, unlinked page — not referenced
 *    from the deposit-rates page's own navigation; found by trying the bank's own URL
 *    conventions, see the final report).
 *
 * Quirks:
 *  - Legacy iob.in is fully dead (no redirect); iob.bank.in is the only working domain.
 *  - Neither table prints a senior/super-senior column. The bank instead states, as plain
 *    text, "For Senior Citizens (aged 60 years and above), additional interest rate of 0.50%
 *    and for Super Senior Citizens (aged 80 years and above), additional interest rate of
 *    0.75% continues." Per the brief, that is recorded in `terms`, not turned into invented
 *    per-row rates.
 *  - The retail table's "Non-Callable" columns need a minimum deposit of more than ₹100 crore
 *    (a separate footnote, "# Minimum amount more than Rs. 100 Crore for Non-Callable
 *    Deposits") and are printed as TWO successive revisions ("...W.E.F 15.05.2026" then a
 *    later "...11.06.2026" column with different numbers). Picking between two same-shaped
 *    "Revised" columns by date, for a product whose real minimum sits so far above either the
 *    retail or the ordinary bulk band, adds a lot of column-selection complexity for one narrow
 *    product; this adapter does not read them (see notes on the `fd` card).
 *  - `parseTenure` (shared) silently mis-parses two label shapes that only appear in the Bulk
 *    Deposit table: a bare "<" with no preceding "to" (e.g. "270 Days < 1 Year") sums the two
 *    numbers instead of treating them as a range, and "Above X <Y" (e.g. "Above 1 Year <2
 *    Year") reads as open-ended from X+1 instead of the range (X, Y). Both happen to return a
 *    plausible-looking number rather than throwing, so the "never guess" rule means this must
 *    be caught before it reaches the shared parser. `normaliseTenure()` below rewrites the
 *    label text only (never a number) into a form the same shared `parseTenure` already
 *    handles correctly elsewhere on this bank's own retail table ("... to < ...").
 */
import { parseAmountBand } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerEffectiveDate, headerText, makeCard, requireGrid } from "./helpers";

/**
 * Fixes the two bare-"<" label shapes described in the file header, without touching the
 * shared `parseTenure`. Only inserts the word "to" where it is missing; never changes a digit.
 */
function normaliseTenure(label: string): string {
  return label
    .replace(/^above\s+/i, "> ") // "Above 1 Year <2 Year" -> "> 1 Year <2 Year"
    .replace(/<\s*/g, " to < ") // any bare "<" (with or without a following space) gets its "to"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Feeds `normaliseTenure()`'s rewritten text to `parseTenure`, but `RateRow.tenureLabel` must
 * stay "exactly as the bank wrote it" — so this also returns a lookup to put the original label
 * back once `parseTermTable` (which reads the tenure column for both purposes) has run.
 */
function withNormalisedTenures(g: Grid, col: number): { grid: Grid; restoreLabel: (label: string) => string } {
  const originalOf = new Map<string, string>();
  const rows = g.rows.map((r) => {
    const original = r[col];
    if (!original) return r;
    const normalised = normaliseTenure(original);
    originalOf.set(normalised, original);
    return [...r.slice(0, col), normalised, ...r.slice(col + 1)];
  });
  return { grid: { ...g, rows }, restoreLabel: (label) => originalOf.get(label) ?? label };
}

function findRetailGrid(html: string): Grid {
  const grids = extractTables(html);
  return requireGrid(grids, (g) => /below rs\.?\s*3\s*crore/i.test(headerText(g, 1)) && /non-callable/i.test(headerText(g, 1)), "retail <3cr table");
}

export const iobFd: Adapter = async (ctx) => {
  const retail = findRetailGrid(ctx.doc.text);
  const effectiveFrom = headerEffectiveDate(retail, /revised rates for deposits below/i);
  if (!effectiveFrom) throw new AdapterError("effective date not found on IOB retail FD table");

  const { grid: normRetail, restoreLabel } = withNormalisedTenures(retail, 0);
  const rows = parseTermTable(normRetail, {
    columns: [{ header: /revised rates for deposits below/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  }).map((r) => ({ ...r, tenureLabel: restoreLabel(r.tenureLabel) }));

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      'IOB: "For Senior Citizens (aged 60 years and above), additional interest rate of 0.50% and for Super Senior Citizens (aged 80 years and above), additional interest rate of 0.75% continues" — not printed as a per-row rate, so only the general-public row is published here.',
      "The retail table's Non-Callable columns (minimum deposit more than ₹100 crore) are not read by this adapter — see file header.",
    ],
  });
  return { cards: [fd], terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% (age 60+)", superSeniorPremium: "+0.75% (age 80+)", prematurePenalty: "Nil up to ₹15,000; 0.50% for ₹15,001-5 lakh; 1.00% above ₹5 lakh and below ₹3 crore" }] };
};

export const iobBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const bulk = requireGrid(grids, (g) => /bulk deposit/i.test(headerText(g, 1)), "bulk deposit table");
  const effectiveFrom = headerEffectiveDate(bulk, /interest rate as on/i);
  if (!effectiveFrom) throw new AdapterError("effective date not found on IOB bulk table");

  const { grid: normBulk, restoreLabel } = withNormalisedTenures(bulk, 0);
  const callable = parseTermTable(normBulk, {
    columns: [{ header: /(?<!non-)\bcallable\b/i, customer: "general" }],
    amountMin: 3 * CRORE,
    amountMax: null,
    callable: true,
  });
  const nonCallable = parseTermTable(normBulk, {
    columns: [{ header: /non-callable/i, customer: "general" }],
    amountMin: 3 * CRORE,
    amountMax: null,
    callable: false,
  });
  const rows = [...callable, ...nonCallable].map((r) => ({ ...r, tenureLabel: restoreLabel(r.tenureLabel) }));
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom })] };
};

/**
 * IOB's two repo-linked slabs print the rate cell as e.g. "2.20% (i.e. Repo Rate 5.25% minus
 * 3.05%=2.20%)" — the shared `parseRate` requires the whole cleaned cell to be just a number,
 * so it correctly returns null for these (they are not "just a number"). Read the leading
 * percentage instead of the bank's own worked example.
 */
function readLeadingRate(cell: string): number | null {
  const m = /^(\d{1,2}(?:\.\d{1,3})?)\s*%/.exec(cleanText(cell));
  return m ? Number(m[1]) : parseRate(cell);
}

export const iobSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /sb balance amount/i.test(headerText(x, 1)), "savings table");
  const effectiveFrom = parseDate(g.rows[0]?.[1] ?? "") ?? null;
  const slabs = g.rows.slice(1).flatMap((r) => {
    const rate = readLeadingRate(r[1] ?? "");
    if (rate === null) return [];
    const band = parseAmountBand(cleanText(r[0] ?? ""));
    if (!band) throw new AdapterError(`unrecognised IOB savings slab "${r[0]}"`);
    const linked = /\(linked to repo rate\)/i.test(r[0] ?? "");
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const, note: linked ? cleanText(r[0]) : undefined }];
  });
  if (slabs.length === 0) throw new AdapterError("no IOB savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "whole" })] };
};
