/**
 * Punjab & Sind Bank — punjabandsind.bank.in
 *
 * Pages covered:
 *  - /content/interestdom: savings slabs AND the domestic term-deposit table on one page. The
 *    same page's title literally says the table covers "domestic term deposits, NRO accounts,
 *    capital gain accounts scheme 1988, RECURRING DEPOSIT SCHEME and psb fixed deposit
 *    tax-saver scheme" — i.e. the bank states RD/NRO/tax-saver rates equal the FD card rate,
 *    quoted below via `deriveRdFromFd`.
 *
 * Quirks:
 *  - Legacy punjabandsindbank.co.in returns 502 on every path (a broken host, not a redirect);
 *    only the punjabandsind.bank.in domain works.
 *  - No senior/super-senior column is printed: the page states the senior premium (+0.50%, for
 *    deposits <₹3cr and tenor >=180 days) and the super-senior premium (+0.15% over the senior
 *    rate, but only on the named special tenures) as plain text. Recorded in `terms`, not turned
 *    into invented per-row rates.
 *  - There is only ONE rate column ("Fixed Deposit Less than Rs.3 Cr"); callable vs non-callable
 *    is instead encoded INSIDE the tenure label itself — e.g. "375 Days (Callable)" next to
 *    "375 Days (Non‑Callable*)" (footnote *: non-callable is only for ₹1,00,01,000-₹2,99,00,000).
 *    `parseTermTable`'s column spec has no way to vary `callable`/`amountMin`/`amountMax` per
 *    row, so this table is read with a small manual loop instead of the shared table parser.
 *  - No bulk (₹3 crore and above) table was found on this page or discoverable from it in this
 *    pass, so no `fd_bulk` adapter is registered for this bank yet.
 *  - Shared-parser gaps worked around locally (not fixed in the shared files):
 *      1. `extractTables`' `precedingContext()` walks back through a table's PREVIOUS SIBLING
 *         elements to build `Grid.context`, but explicitly skips any plain text node it meets
 *         on the way to the nearest tag ("while (prev && prev.type !== 'tag') prev = prev.prev").
 *         This page's effective date ("Revised w.e.f. 16/06/2026 (% p.a.)") is exactly such a
 *         bare text node between the `<h2>` heading and the `<table>`, so `Grid.context` never
 *         contains it. This adapter reads the date from `pageText()` instead, anchored to the
 *         same heading text so it can't pick up a different table's date.
 *      2. `parseTenure` doesn't throw on a bare "<" with no preceding "to" (e.g. "1000 Days -
 *         <3 Years", ">667 < 22 Month") — it silently sums the two numbers instead of reading a
 *         range. `normaliseTenure()` below inserts the missing "to" in the label text (never
 *         touching a digit) before handing it to the same shared `parseTenure`.
 */
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, pageText, type Grid } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import { parseAmountBand } from "../parse/amount";
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerText, makeCard, requireGrid } from "./helpers";

const NON_CALLABLE_MIN = 1_00_01_000; // ₹100.01 lakh
const NON_CALLABLE_MAX = 2_99_00_000; // ₹299.00 lakh (< ₹3 crore)

/** See file header note 2: inserts the "to" a bare "<" is missing. Never rewrites a digit. */
function normaliseTenure(label: string): string {
  return label
    .replace(/>\s*(\d+)(?!\s*[a-zA-Z])\s*</, "> $1 days <") // "> 667 < 22 Month" needs a unit on 667 too
    .replace(/<\s*/g, " to < ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The three "PSB Green Earth" rows print their rate as e.g. "5.95($)" — `parseRate` requires
 * the whole cleaned cell to be just a number, so strip the footnote parenthetical first. */
function readRate(cell: string): number | null {
  return parseRate(cell.replace(/\(.*?\)/g, ""));
}

export const psbFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);

  const fdGrid = requireGrid(grids, (g) => /fixed deposit less than rs\.?\s*3\s*cr/i.test(headerText(g, 1)), "domestic term deposit table");
  // The date sits in a bare text node between the heading and the table (see file header note 1),
  // so `Grid.context` doesn't carry it; anchor the search to this table's own unique heading text.
  const dateMatch = /tax-saver scheme\s*revised w\.?\s?e\.?\s?f\.?\s*([0-9./-]+)/i.exec(text);
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("effective date not found for PSB domestic term deposit table");

  const rows: RateRow[] = [];
  for (const row of fdGrid.rows.slice(1)) {
    const rawLabel = row[0] ?? "";
    if (!rawLabel) continue;
    const rate = readRate(row[1] ?? "");
    if (rate === null) continue;
    const nonCallable = /non.?callable/i.test(rawLabel);
    const greenEarth = /green earth/i.test(rawLabel);
    const tenure = parseTenure(normaliseTenure(rawLabel));
    if (!tenure) throw new AdapterError(`cannot read PSB tenure "${rawLabel}"`);
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: cleanText(rawLabel),
      special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
      schemeName: greenEarth ? "PSB Green Earth" : undefined,
      amountMin: nonCallable ? NON_CALLABLE_MIN : 0,
      amountMax: nonCallable ? NON_CALLABLE_MAX : 3 * CRORE,
      customer: "general",
      residency: "resident",
      callable: !nonCallable,
      payout: null,
      rate,
    });
  }
  if (rows.length === 0) throw new AdapterError("no rows read from PSB domestic term deposit table");

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "PSB: senior citizens get +0.50% over the general rate for deposits <₹3cr with tenor >=180 days (not applicable to NRE/NRO/capital-gain/bulk deposits) — not printed as a per-row rate.",
      "PSB: super senior citizens get a further +0.15% over the senior rate, but only on the named special tenures (375/444/666/999 days, PSB Green Earth) — not printed as a per-row rate.",
      'PSB states this table also sets the rate for NRO accounts, the Capital Gains Accounts Scheme 1988, the Recurring Deposit scheme and the PSB Fixed Deposit Tax-Saver scheme ("Rate of interest on domestic term deposits, NRO accounts, capital gain accounts scheme 1988, RECURRING DEPOSIT SCHEME and psb fixed deposit tax-saver scheme").',
    ],
  });
  const rd = deriveRdFromFd(fd, "PSB: the RD, NRO, Capital Gains and Tax-Saver schemes share this same domestic term-deposit rate table (page heading)", 365);

  const savingsGrid = requireGrid(grids, (g) => /saving bank deposit including nre\/nro/i.test(headerText(g, 1)) || /particular/i.test(headerText(g, 1)), "savings table");
  const savingsEffectiveFrom = parseDate(savingsGrid.rows[1]?.[1] ?? "");
  const savingsSlabs: SavingsSlab[] = savingsGrid.rows.slice(2).flatMap((r) => {
    const slabRate = parseRate(r[1] ?? "");
    if (slabRate === null) return [];
    const band = parseAmountBand(cleanText(r[0] ?? ""));
    if (!band) throw new AdapterError(`unrecognised PSB savings slab "${r[0]}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate: slabRate, residency: "resident" as const }];
  });
  if (savingsSlabs.length === 0) throw new AdapterError("no PSB savings slabs found");
  const savings = makeCard(ctx, "savings", [], { effectiveFrom: savingsEffectiveFrom, savingsSlabs, slabMethod: "unknown" });

  return {
    cards: [fd, rd, savings],
    terms: [
      { product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% (<3cr, tenor >=180 days)", superSeniorPremium: "+0.15% over senior (named special tenures only)", other: ["Non-callable variant (₹100.01 lakh-₹299.00 lakh) available on the 375/444/666/999-day tenures only."] },
    ],
  };
};
