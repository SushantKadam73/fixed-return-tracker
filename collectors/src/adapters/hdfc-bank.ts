/**
 * HDFC Bank — hdfc.bank.in
 *
 * Single source page: /interest-rates (also mirrored at /fixed-deposit/fd-interest-rate for
 * just the FD tables). One page holds, as separate HTML tables: Domestic/NRO/NRE FD <₹3 crore,
 * FD ₹3–<5 crore, FD ≥₹5 crore (ten amount sub-bands as columns, general public only — HDFC
 * does not publish a senior-citizen rate for this band), a Recurring Deposit table with a
 * per-tenure "Effective From" column, and a flat-rate Savings Account table.
 *
 * Quirks worked around here (not in the shared parsers):
 *  - Several tenure labels use "<=" instead of the word "to" (e.g. "90 days <= 6 months",
 *    "2 Years 11 Months 1 day <= 3 Year"). The shared `parseTenure` only recognises "to",
 *    "upto", a bare hyphen, etc. — it has no rule for "<=". We rewrite "<=" to " to " on the
 *    tenure column before handing the grid to `parseTermTable` (a plain "to" is the correct
 *    reading here: comparing with the neighbouring rows shows these are inclusive-inclusive
 *    joins, not "less-than-or-equal" in the mathematical sense).
 *  - The ≥₹5 crore table has ten amount bands as separate COLUMNS rather than one amount band
 *    per table, which `parseTermTable` (one amount band per call) can't express. It is parsed
 *    with a small local loop instead.
 *  - The RD table publishes one "Effective From" date per tenure row rather than one date for
 *    the whole table. We take the latest such date as the card's `effectiveFrom` and note the
 *    (few) tenures that were last revised on an earlier date on the row itself.
 *
 * Not covered: the "Non-Withdrawable" (non-callable) table for ≥₹2 crore, and the historical
 * rate-archive PDFs linked from this page — out of scope for this pass, noted as a gap.
 */
import type { RateRow } from "../../../lib/domain";
import { parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

const RATE_COL = /rate/i;
const SENIOR = /senior/i;

/** "<=" is used in place of "to" on several rows; parseTenure has no rule for it (see file header). */
function normaliseTenureCells(g: Grid): Grid {
  return { ...g, rows: g.rows.map((r) => r.map((c, i) => (i === 0 ? c.replace(/<=/g, " to ") : c))) };
}

export const hdfcFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, (g) => /<\s*3\s*crore/i.test(headerText(g, 1)), "< 3 crore FD table");
  const effectiveFrom = dateFromContext(retail.context);
  const rows = parseTermTable(normaliseTenureCells(retail), {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  if (!effectiveFrom) throw new AdapterError("effective date not found for the < 3 crore FD table");
  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom })],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50pp across all tenures (bank's own column)", superSeniorPremium: "not offered — only General and Senior Citizen columns are published" }],
  };
};

export const hdfcBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  const midBand = requireGrid(grids, (g) => />=\s*3\s*crore to\s*<\s*5\s*crore/i.test(headerText(g, 1)), "3–5 crore FD table");
  const effectiveFrom = dateFromContext(midBand.context);
  const rows: RateRow[] = parseTermTable(normaliseTenureCells(midBand), {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 3 * CRORE,
    amountMax: 5 * CRORE,
    callable: true,
  });

  const topBand = requireGrid(grids, (g) => /equal\s*&\s*more than.{0,10}5\s*cr/i.test(g.context) || /equal\s*&\s*more than.{0,10}5\s*cr/i.test(headerText(g, 1)), "≥5 crore FD table");
  rows.push(...parseAbove5Crore(topBand));

  if (!effectiveFrom) throw new AdapterError("effective date not found for the 3–5 crore FD table");
  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: ["≥₹5 crore rows have no senior-citizen column on this page — HDFC only publishes General rates for that band (verified: no 'Senior' text appears anywhere near that table)."],
      }),
    ],
  };
};

/** ≥₹5 crore table: ten amount bands as columns, not one amount band per call — parsed by hand. */
function parseAbove5Crore(g: Grid): RateRow[] {
  const header = g.rows[2] ?? [];
  if (!/period/i.test(header[0] ?? "")) throw new AdapterError("≥5 crore table layout changed: expected a 'Period' header row");
  const bands = header.slice(1).map((h) => parseCroreColumn(h));
  const rows: RateRow[] = [];
  for (const raw of g.rows.slice(3)) {
    const label = (raw[0] ?? "").replace(/<=/g, " to ");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read ≥5 crore tenure "${raw[0]}"`);
    bands.forEach((band, i) => {
      const rate = parseRate(raw[i + 1] ?? "");
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: raw[0],
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("≥5 crore table produced no rows");
  return rows;
}

/** "5crore to <5.25 crore" / ">= 1000 crore" -> a rupee band. Not a `parseAmountBand` shape (that
 * helper reads one band per label, not a same-currency-unit pair like this), so parsed locally. */
function parseCroreColumn(label: string): { min: number; max: number | null } {
  const nums = [...label.matchAll(/([\d.]+)\s*crore/gi)].map((m) => Math.round(Number(m[1]) * CRORE));
  if (nums.length === 2) return { min: nums[0], max: nums[1] };
  if (nums.length === 1) return { min: nums[0], max: null };
  throw new AdapterError(`cannot read amount column "${label}"`);
}

export const hdfcRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /period/i.test(headerText(x, 1)) && /effective from/i.test(headerText(x, 1)), "RD table");
  const rows = parseTermTable(g, {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: null,
  });

  // One "Effective From" date per tenure row, not one for the whole table (see file header).
  const body = g.rows.slice(1);
  const dates = body.map((r) => parseDate(r[3] ?? ""));
  const latest = dates.filter((d): d is string => !!d).sort().at(-1) ?? null;
  if (!latest) throw new AdapterError("no 'Effective From' date found in the RD table");
  rows.forEach((row, i) => {
    const d = dates[Math.floor(i / 2)];
    if (d && d !== latest) row.note = `Effective from ${d} (this tenure was last revised separately from the rest of the RD table, which is effective from ${latest}).`;
  });

  return { cards: [makeCard(ctx, "rd", rows, { effectiveFrom: latest })] };
};

export const hdfcSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings balance/i.test(headerText(x, 1)), "savings table");
  const effectiveFrom = dateFromContext(g.context);
  const rate = g.rows.slice(1).reduce<number | null>((found, r) => (found === null && /across all/i.test(r[0] ?? "") ? parseRate(r[1] ?? "") : found), null);
  if (rate === null) throw new AdapterError("no flat savings rate found (layout may have added slabs)");
  if (!effectiveFrom) throw new AdapterError("effective date not found for the savings table");
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: [{ balanceMin: 0, balanceMax: null, rate, residency: "resident" }],
        slabMethod: "whole",
      }),
    ],
  };
};

/** The effective date sits in the free-text paragraph right before each table, not in its header row. */
function dateFromContext(context: string): string | null {
  const m = /(applicable from|effective|w\.?\s?e\.?\s?f\.?)\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[a-z]+,?\s+[0-9]{4})/i.exec(context);
  return m ? parseDate(m[2]) : null;
}
