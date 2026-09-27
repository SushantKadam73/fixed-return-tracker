/**
 * Bank of Maharashtra — bankofmaharashtra.bank.in
 *
 * The legacy bankofmaharashtra.in domain returns 502 Bad Gateway on every path (robots.txt
 * included) — it looks decommissioned rather than merely redirecting, so all URLs here use
 * the current *.bank.in domain (per the group survey notes).
 *
 * One page ("Domestic Term Deposits") carries retail AND bulk together as amount-banded
 * columns, split across two adjacent HTML tables purely because of width (same tenure rows,
 * more amount-band columns): "Less than ₹3cr" / "₹3-10cr" in one table, "₹>10-100cr" /
 * "₹100-400cr" / "₹>400cr" in the next. A third table above both carries the two named special
 * tenures (400 days, 1777-day Green Deposit) for the same amount bands. This adapter reads the
 * <3cr columns into the "fd" card and every ≥3cr column (from all three tables) into "fd_bulk".
 *
 * No senior-citizen rows: the page never prints a per-tenure senior number, only a blanket
 * "+0.50% for Resident Senior Citizens, 91 days and above, deposits up to ₹5 crore" footnote.
 * Computing a senior number per row would mean multiplying that rule out ourselves rather than
 * reading a printed figure, so this adapter only emits `customer: "general"` rows and puts the
 * rule in `terms.seniorPremium` instead.
 *
 * Quirk: one tenure label ("One Year", grid with the ≥₹10cr bands) has no digit at all, so the
 * shared `parseTenure` — which requires a number to anchor on — returns null for it. This
 * adapter rewrites that one exact label to "1 year" locally. ("365 days/ One Year", used in the
 * <10cr table for the same bucket, is left alone: `parseTenure` already reads the leading
 * "365 days" and silently ignores the trailing "/ One Year", landing on the correct 365 days by
 * accident — rewriting "One Year" there too would add a second digit+unit token ("1" + "year")
 * that the parser would wrongly add to the first instead of treating as an alternative spelling.)
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseAmountBand, type AmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, makeCard, requireGrid } from "./helpers";

// `extractTables`'s backward-scanning context often accumulates MORE than one heading (a short
// close heading leaves room in its 400-char budget for further-back text too), so grid1's own
// context also contains the words "special schemes" from the heading that precedes grid0. Take
// whichever heading phrase's last occurrence sits closest to the end of the context string —
// that's the one immediately before this specific table.
function lastHeading(context: string): "special" | "regular" | null {
  const c = context.toLowerCase();
  const special = c.lastIndexOf("special schemes");
  const regular = c.lastIndexOf("regular schemes");
  if (special < 0 && regular < 0) return null;
  return special > regular ? "special" : "regular";
}
const isSpecialSchemes = (g: Grid) => lastHeading(g.context) === "special";
const isRegularLow = (g: Grid) => lastHeading(g.context) === "regular";
const isRegularHigh = (g: Grid) => (g.rows[0] ?? []).some((c) => /above rs\.?\s*10\b/i.test(c));

/** "One Year" (no digit) can't be read by `parseTenure`, which needs a number to anchor on. */
function normaliseTenure(label: string): string {
  return /^one year$/i.test(cleanText(label)) ? "1 year" : label;
}

/**
 * Tenure x (amount-band, callable/non-callable) grid: row 0 pairs up two columns per amount
 * band, row 1 says which of the pair is callable vs non-callable ("xx" = not offered).
 */
function parseBomTable(grid: Grid, includeBand: (band: AmountBand) => boolean): RateRow[] {
  const amountHeaders = grid.rows[0] ?? [];
  const calHeaders = grid.rows[1] ?? [];
  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(2)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(normaliseTenure(label));
    if (!tenure) throw new AdapterError(`bank-of-maharashtra: cannot read tenure "${label}"`);
    const schemeName = /\(([^)]+)\)/.exec(label)?.[1];
    for (let c = 1; c < row.length; c++) {
      const band = parseAmountBand(amountHeaders[c] ?? "");
      if (!band || !includeBand(band)) continue;
      const rate = parseRate(row[c] ?? "");
      if (rate === null) continue; // "xx" = not offered for this amount band / callable type
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        schemeName,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: !/non-callable/i.test(calHeaders[c] ?? ""),
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("bank-of-maharashtra: table produced no rows");
  return rows;
}

function loadGrids(html: string) {
  const grids = extractTables(html);
  return {
    special: requireGrid(grids, isSpecialSchemes, "special-schemes table"),
    low: requireGrid(grids, isRegularLow, "regular <3cr/3-10cr table"),
    high: requireGrid(grids, isRegularHigh, "regular >10cr table"),
  };
}

const SENIOR_TERM = "+0.50% p.a. for Resident Senior Citizens, maturity slabs of 91 days and above only, on deposits up to ₹5 crore only (not applicable to non-resident deposits); not printed per tenure so no senior rows are derived here";

export const bankOfMaharashtraFd: Adapter = async (ctx) => {
  const { special, low, high } = loadGrids(ctx.doc.text);
  void high; // >10cr bands never belong to the retail (<3cr) card
  const effectiveFrom = findEffectiveDate(low.context) ?? findEffectiveDate(special.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-maharashtra: retail effective date not found");

  const belowBulk = (band: AmountBand) => band.min < 3 * CRORE;
  const rows = [...parseBomTable(special, belowBulk), ...parseBomTable(low, belowBulk)];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom });
  const rd = deriveRdFromFd(fd, "Bank of Maharashtra: Interest rates offered on Recurring Term Deposits will be same as the interest rates applicable to Term Deposits.");
  return { cards: [fd, rd], terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: SENIOR_TERM, prematurePenalty: "1.00% below the applicable rate for the period actually held; not permitted at all on non-callable deposits" }] };
};

export const bankOfMaharashtraBulk: Adapter = async (ctx) => {
  const { special, low, high } = loadGrids(ctx.doc.text);
  const effectiveFrom = findEffectiveDate(low.context) ?? findEffectiveDate(special.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-maharashtra: bulk effective date not found");

  const atOrAboveBulk = (band: AmountBand) => band.min >= 3 * CRORE;
  const rows = [...parseBomTable(special, atOrAboveBulk), ...parseBomTable(low, atOrAboveBulk), ...parseBomTable(high, atOrAboveBulk)];
  const bulk = makeCard(ctx, "fd_bulk", rows, { effectiveFrom });
  return { cards: [bulk], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "1.00% below the applicable rate for the period actually held; not permitted at all on non-callable deposits" }] };
};

export const bankOfMaharashtraSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings bank deposits/i.test(x.context), "savings slab table");
  const effectiveFrom = findEffectiveDate(g.context);
  if (!effectiveFrom) throw new AdapterError("bank-of-maharashtra: savings effective date not found");

  const headers = g.rows[0] ?? [];
  const revisedIdx = headers.findIndex((h) => /revised/i.test(h));
  if (revisedIdx < 0) throw new AdapterError(`bank-of-maharashtra: no "revised" rate column in savings headers "${headers.join(" | ")}"`);

  const slabs: SavingsSlab[] = g.rows.slice(1).map((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = parseRate(r[revisedIdx] ?? "");
    if (rate === null) throw new AdapterError(`bank-of-maharashtra: cannot read savings rate for slab "${label}"`);
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`bank-of-maharashtra: cannot read savings balance slab "${label}"`);
    return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
  });
  if (slabs.length === 0) throw new AdapterError("bank-of-maharashtra: no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
