/**
 * UCO Bank — uco.bank.in
 *
 * Pages covered (all on interest-rates-on-deposit-schemes, one page):
 *  - Savings Bank Rate of Interest (Existing vs Revised columns; 2 slabs)
 *  - Domestic Term Deposits less than ₹3 Crore (general customer only; "Rate % p.a." and
 *    "Yield in %" columns side by side — only the rate column is published)
 *  - Bulk Term Deposits ₹3-10 crore (Callable + Non-Callable columns)
 *  - Bulk Term Deposits above ₹10 crore, split into 3 further amount bands, each with its own
 *    Callable and Non-Callable table
 *
 * Quirks:
 *  - Legacy ucobank.com returns 502 on every path (a broken host, not a redirect); only
 *    uco.bank.in works.
 *  - No senior/staff column is printed on the retail table. The additional-interest table
 *    (0.25%/0.50% general senior, 1.00%/1.00% staff, 1.25%/1.50% ex-staff & senior) is text,
 *    recorded in `terms`, not turned into invented per-row rates.
 *  - The recurring-deposit page states "UCO Sanchayika" RD rates equal "the bank's domestic
 *    card rate for normal term deposit (less than Rs.2 crore)" — note the ₹2 crore wording,
 *    which is narrower than the ₹3 crore retail band the FD rows themselves carry. The derived
 *    RD card's amount band is capped at ₹2 crore to match the bank's own statement, quoted in
 *    `notes`, rather than reusing the wider FD band unexamined.
 *  - The above-₹10cr tables print bare "271D < 1 Year" (no space between the number and its
 *    unit letter, and no "to" before "<") where the ₹3-10cr table two rows above spells the
 *    same tenure out in full ("271 Days to 1 Year"). The shared `parseTenure` sums the two
 *    numbers instead of reading a range for the abbreviated form (see the Indian Overseas Bank
 *    and Punjab & Sind Bank adapters for the same underlying bug). `normaliseTenure()` below
 *    fixes the text before it reaches the shared parser.
 */
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTermTable, type ColumnSpec } from "../parse/term-table";
import type { RateRow } from "../../../lib/domain";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerText, makeCard, requireGrid } from "./helpers";

const GREEN_DEPOSIT_DAYS: Record<number, string> = { 1000: "UCO Green Deposit", 2000: "UCO Green Deposit", 3000: "UCO Green Deposit" };

/** Same bare-"<" fix as the other a2 banks — see file header. */
function normaliseTenure(label: string): string {
  return label.replace(/<\s*/g, " to < ").replace(/\s+/g, " ").trim();
}

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

/** Effective date from a table's own context text (e.g. "... : Revised w.e.f. 21.05.2026"). */
function dateFromContext(g: Grid, re: RegExp): string | null {
  const m = re.exec(g.context);
  return m ? parseDate(m[1]) : null;
}

export const ucoFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, (g) => /less than rs\.?\s*3\s*crore/i.test(g.context) && /maturity period/i.test(headerText(g, 1)), "domestic <3cr term deposit table");
  const effectiveFrom = dateFromContext(retail, /revised w\.?\s?e\.?\s?f\.?\s*([0-9.]+)/i);
  if (!effectiveFrom) throw new AdapterError("effective date not found on UCO retail FD table");

  const rows = parseTermTable(retail, {
    columns: [{ header: /rate\s*%/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    schemeNames: GREEN_DEPOSIT_DAYS,
  });
  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "UCO: additional interest over the general-customer rate — senior citizens +0.25% (<=1y) / +0.50% (>1y); staff +1.00% / +1.00%; ex-staff & senior citizens +1.25% / +1.50%. Not printed as a per-row rate.",
    ],
  });

  const rd = deriveRdFromFd(fd, 'UCO ("UCO Sanchayika" RD product page): "the bank\'s domestic card rate for normal term deposit (less than Rs.2 crore)"', 365);
  rd.rows = rd.rows.map((r) => ({ ...r, amountMax: 2 * CRORE }));
  rd.notes = [...(rd.notes ?? []), "RD amount band capped at ₹2 crore per the bank's own RD-specific wording, narrower than the ₹3 crore retail FD band."];

  const savings = requireGrid(grids, (g) => /savings bank rate of interest/i.test(g.context) && /balance/i.test(headerText(g, 2)), "savings table");
  const savingsEffectiveFrom = dateFromContext(savings, /rate of interest w\.?\s?e\.?\s?f\.?\s*([0-9-]+)/i);
  const savingsSlabs = savings.rows.slice(2).flatMap((r) => {
    const rate = parseRate(r[3] ?? ""); // "Revised Rate" balance/rate pair is columns 2 and 3
    if (rate === null) return [];
    const band = parseAmountBand(cleanText(r[2] ?? ""));
    if (!band) throw new AdapterError(`unrecognised UCO savings slab "${r[2]}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (savingsSlabs.length === 0) throw new AdapterError("no UCO savings slabs found");
  const savingsCard = makeCard(ctx, "savings", [], { effectiveFrom: savingsEffectiveFrom, savingsSlabs, slabMethod: "unknown" });

  return {
    cards: [fd, rd, savingsCard],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.25% (<=1y) / +0.50% (>1y)", rdRules: "RD rate = domestic card rate for deposits below ₹2 crore" }],
  };
};

const BULK_310_COLUMNS: ColumnSpec[] = [{ header: /single term deposit/i, customer: "general", exclude: /non-callable/i }];
const BULK_310_NONCALLABLE_COLUMNS: ColumnSpec[] = [{ header: /non-callable/i, customer: "general" }];

/** The three amount bands above ₹10cr are printed as separate columns in the SAME shape,
 * distinguished only by whether the header mentions the next band's ceiling. */
function above10CrColumn(bandLabel: RegExp, exclude?: RegExp): ColumnSpec {
  return { header: bandLabel, customer: "general", exclude };
}

export const ucoBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const bulk310 = requireGrid(grids, (g) => /single term deposit/i.test(headerText(g, 1)), "₹3-10cr bulk table");
  const effectiveFrom310 = dateFromContext(bulk310, /rs\.?10\s*cr\s*w\.?\s?e\.?\s?f\.?\s*([0-9.-]+)/i) ?? dateFromContext(bulk310, /w\.?\s?e\.?\s?f\.?\s*([0-9.-]+)/i);
  if (!effectiveFrom310) throw new AdapterError("effective date not found on UCO ₹3-10cr bulk table");

  const callable310 = parseTermTable(bulk310, { columns: BULK_310_COLUMNS, amountMin: 3 * CRORE, amountMax: 10 * CRORE, callable: true });
  const nonCallable310 = parseTermTable(bulk310, { columns: BULK_310_NONCALLABLE_COLUMNS, amountMin: 3 * CRORE, amountMax: 10 * CRORE, callable: false });

  const callableAbove10 = requireGrid(grids, (g) => /a\)\s*domestic.*callable/i.test(g.context), "callable >₹10cr table");
  const nonCallableAbove10 = requireGrid(grids, (g) => /b\)\s*domestic.*non-callable/i.test(g.context), "non-callable >₹10cr table");

  const above10Bands: RateRow[] = [];
  for (const [grid, callable] of [[callableAbove10, true], [nonCallableAbove10, false]] as const) {
    const { grid: normGrid, restoreLabel } = withNormalisedTenures(grid, 1);
    const specs: Array<[ColumnSpec, number, number | null]> = [
      [above10CrColumn(/10\.00 crs upto/i), 10 * CRORE + 1, 50 * CRORE + 1],
      [above10CrColumn(/50\.00 crs upto/i), 50 * CRORE + 1, 100 * CRORE + 1],
      [above10CrColumn(/100\.00 crs/i, /upto/i), 100 * CRORE + 1, null],
    ];
    for (const [column, amountMin, amountMax] of specs) {
      const rows = parseTermTable(normGrid, { columns: [column], amountMin, amountMax, callable }).map((r) => ({ ...r, tenureLabel: restoreLabel(r.tenureLabel) }));
      above10Bands.push(...rows);
    }
  }

  const rows = [...callable310, ...nonCallable310, ...above10Bands];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom: effectiveFrom310, notes: ["Bands above ₹10 crore are dated 'RATES EFFECTIVE FROM 27-09-2026' in the page text — read from that table's own heading if it differs from the ₹3-10cr table's date."] })] };
};
