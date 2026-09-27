/**
 * Union Bank of India — unionbankofindia.bank.in
 *
 * Pages covered:
 *  - en/details/rate-of-interest: domestic/NRO term deposits (<₹3 crore callable + ₹1-3 crore
 *    non-callable) AND the savings-bank slabs on one page.
 *  - pdf/interest-rates-for-bulk-deposit.pdf: a STATIC filename (unlike PNB's tokenised link)
 *    covering Callable, Notice Period, Non-Callable and NRE Callable deposits across 6 amount
 *    bands from ₹3 crore up to "above ₹500 crore".
 *
 * Quirks:
 *  - No senior/super-senior column is printed on the term-deposit table. The page states
 *    "+0.50% over normal rate on term deposits up to ₹5.00 crore" (senior) and "+0.75% over
 *    normal rate ... i.e. +0.25% over the senior-citizen rate" (super senior, deposits opened
 *    or renewed on/after 01.12.2022) as plain text — recorded in `terms`, not invented rows.
 *  - The PDF's "Notice Period Deposit" and "NRE Callable Deposit" sections, and its per-band
 *    "1 year" outlier for deposits above ₹500 crore (6.83-6.85%, far above every other cell in
 *    that row), are all read and simply not carried into the `fd_bulk` card: Notice Period is
 *    not one of this tracker's products and NRE is a different residency (out of scope for this
 *    adapter) — see `readBulkPdf()` below, which only keeps the "Callable Deposit" and
 *    "Non-Callable Deposit" sections.
 *  - `parseAmountBand` (shared) strips "rs"/"Rs." with a bare, non-word-bounded regex, which
 *    also eats the "rs" hiding inside the bank's own "Crs" abbreviation (e.g. "50 Crs" loses its
 *    unit and reads as 50 rupees, not ₹50 crore) — the Bank of Baroda adapter in this same repo
 *    hit the identical bug. `readSavingsBand()` below expands "Crs" to "Crore" before delegating
 *    to the shared parser, rather than editing it.
 */
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** See file header note on the shared "Crs" bug (also hit by the bank-of-baroda adapter). */
function readSavingsBand(label: string) {
  return parseAmountBand(label.replace(/\bcrs\b/gi, "crore"));
}

export const unionBankFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const term = requireGrid(grids, (g) => /callable deposits/i.test(g.rows[0]?.join(" ") ?? "") && /period\s*\/\s*tenor/i.test(g.rows[0]?.[0] ?? ""), "domestic/NRO term deposit table");
  const dateMatch = /effective from\s+([0-9a-z ]+?)\s+are given below/i.exec(term.context);
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("effective date not found on Union Bank term deposit table");

  const callable = parseTermTable(term, {
    columns: [{ header: /callable deposits/i, customer: "general", exclude: /non/i }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  const nonCallable = parseTermTable(term, {
    columns: [{ header: /non.{0,3}callable deposits/i, customer: "general" }],
    amountMin: CRORE + 1,
    amountMax: 3 * CRORE,
    callable: false,
  });
  const rows = [...callable, ...nonCallable];
  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "Union Bank: senior citizens get +0.50% over the normal rate on term deposits up to ₹5.00 crore (not printed as a per-row rate).",
      "Union Bank: super senior citizens get +0.75% over the normal rate (i.e. +0.25% over the senior rate), for deposits opened/renewed on/after 01.12.2022 (not printed as a per-row rate).",
    ],
  });

  const savings = requireGrid(grids, (g) => /credit balance/i.test(g.rows[0]?.[0] ?? ""), "savings table");
  const savingsDateMatch = /w\.?e\.?f\.?\s*([0-9.]+)\s*will be as under/i.exec(savings.context);
  const savingsEffectiveFrom = savingsDateMatch ? parseDate(savingsDateMatch[1]) : null;
  const savingsSlabs: SavingsSlab[] = savings.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    const band = readSavingsBand(cleanText(r[0] ?? ""));
    if (!band) throw new AdapterError(`unrecognised Union Bank savings slab "${r[0]}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (savingsSlabs.length === 0) throw new AdapterError("no Union Bank savings slabs found");
  const savingsCard = makeCard(ctx, "savings", [], { effectiveFrom: savingsEffectiveFrom, savingsSlabs, slabMethod: "unknown" });

  return {
    cards: [fd, savingsCard],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% up to ₹5 crore", seniorPremiumCap: "₹5 crore", superSeniorPremium: "+0.75% (+0.25% over senior), deposits opened/renewed on/after 01.12.2022" }],
  };
};

/**
 * The bank's own bulk PDF text (extracted with unpdf) keeps every tenure label and its 6 rates
 * on one line, one section per deposit type. Only "Callable Deposit" and "Non-Callable Deposit"
 * are read — see file header for why "Notice Period Deposit" and "NRE Callable Deposit" are not.
 */
const BULK_BANDS: Array<{ min: number; max: number | null }> = [
  { min: 3 * CRORE, max: 10 * CRORE + 1 },
  { min: 10 * CRORE + 1, max: 25 * CRORE + 1 },
  { min: 25 * CRORE + 1, max: 50 * CRORE + 1 },
  { min: 50 * CRORE + 1, max: 100 * CRORE + 1 },
  { min: 100 * CRORE + 1, max: 500 * CRORE + 1 },
  { min: 500 * CRORE + 1, max: null },
];
const ROW_RE = /^(.+?)\s+(\d+\.\d{1,2})\s+(\d+\.\d{1,2})\s+(\d+\.\d{1,2})\s+(\d+\.\d{1,2})\s+(\d+\.\d{1,2})\s+(\d+\.\d{1,2})\s*$/;

function readBulkPdfSection(lines: string[], startIdx: number, endIdx: number, callable: boolean): RateRow[] {
  const rows: RateRow[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const m = ROW_RE.exec(lines[i].trim());
    if (!m) continue;
    const label = cleanText(m[1]);
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read Union Bank bulk tenure "${label}"`);
    for (let b = 0; b < 6; b++) {
      const rate = parseRate(m[2 + b]);
      if (rate === null) continue;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: BULK_BANDS[b].min,
        amountMax: BULK_BANDS[b].max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("no rows read from Union Bank bulk PDF section");
  return rows;
}

export const unionBankBulk: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const dateMatch = /for\s+(\d{1,2}\.\d{1,2}\.\d{4})/.exec(text);
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("effective date not found on Union Bank bulk PDF");

  const lines = text.split("\n");
  const sectionStart = (label: string) => lines.findIndex((l) => l.trim() === label);
  const callableStart = sectionStart("Callable Deposit");
  const noticeStart = sectionStart("Notice Period Deposit");
  const nonCallableStart = sectionStart("Non-Callable Deposit");
  const nreStart = sectionStart("NRE Callable Deposit");
  if (callableStart < 0 || noticeStart < 0 || nonCallableStart < 0 || nreStart < 0) {
    throw new AdapterError("Union Bank bulk PDF section headings not found — layout may have changed");
  }

  const rows = [...readBulkPdfSection(lines, callableStart + 1, noticeStart, true), ...readBulkPdfSection(lines, nonCallableStart + 1, nreStart, false)];
  return {
    cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes: ["Only the Callable and Non-Callable sections of the PDF are read; Notice Period Deposit (not a tracked product) and NRE Callable Deposit (different residency, out of scope) are skipped."] })],
  };
};
