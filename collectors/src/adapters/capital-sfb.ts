/**
 * Capital Small Finance Bank — www.capital.bank.in
 * Pages: callable domestic term deposits (general table + a separate senior-citizen table,
 * each with a plain slab section and a "Special category" section of named-peak tenures),
 * savings bank account (one flat rate, no slabs).
 *
 * Quirks:
 *  - General and senior rates are on two *separate* single-column tables (not one table with
 *    two columns), each headed "Slab" / "RATE OF INTEREST" — `tenureHeader` must be overridden
 *    since "Slab" isn't matched by the shared tenure-header regex.
 *  - Each table has a mid-table divider row ("Special category" repeated across every column,
 *    from a colspan cell) introducing a handful of named-peak point tenures (12 months, 400,
 *    600, 900 days). We split the grid at that row and parse the two halves separately so the
 *    peak tenures are correctly flagged `special` even when — like "12 Months" — they land on
 *    an exact year and the shared point/365 heuristic wouldn't flag them on its own.
 *  - No bulk (≥₹3 crore) page was found; only the callable retail card is published.
 */
import type { RateRow } from "../../../lib/domain";
import { parseDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import type { Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, headerText, makeCard, requireGrid } from "./helpers";

const SLAB_HEADER = /slab/i;
const RATE_HEADER = /rate of interest/i;

/** The effective date sits in the table's own preceding heading text, e.g.
 * "Interest on Domestic Term Deposit (w.e.f. June 30, 2026)" — not inside the table itself,
 * so we read it from `context` (via a "w.e.f." anchor) rather than `headerEffectiveDate`. */
function capitalDate(context: string): string | null {
  const m = /w\.?\s?e\.?\s?f\.?\s*([^()]{4,30})/i.exec(context);
  return m ? parseDate(m[1]) : null;
}

/** Split a grid at its "Special category" divider row (present on both AU-style rate tables here). */
function splitSpecial(g: Grid): { standard: Grid; special: Grid | null } {
  const header = g.rows[0];
  const idx = g.rows.findIndex((r) => /special categor/i.test(r[0] ?? ""));
  if (idx < 0) return { standard: g, special: null };
  return {
    standard: { ...g, rows: g.rows.slice(0, idx) },
    special: { ...g, rows: [header, ...g.rows.slice(idx + 1)] },
  };
}

function parseSide(g: Grid, customer: "general" | "senior"): RateRow[] {
  const { standard, special } = splitSpecial(g);
  const rows = parseTermTable(standard, { tenureHeader: SLAB_HEADER, columns: [{ header: RATE_HEADER, customer }], amountMin: 0, amountMax: null, callable: true });
  if (special) {
    const specialRows = parseTermTable(special, { tenureHeader: SLAB_HEADER, columns: [{ header: RATE_HEADER, customer }], amountMin: 0, amountMax: null, callable: true });
    specialRows.forEach((r) => {
      r.special = true;
      r.note = "Listed by the bank under its own \"Special category\" peak-rate tenures";
    });
    rows.push(...specialRows);
  }
  return rows;
}

export const capitalSfbFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  const general = requireGrid(grids, (g) => SLAB_HEADER.test(headerText(g, 1)) && !/senior citizen/i.test(g.context), "callable term-deposit table (general)");
  const effectiveFrom = capitalDate(general.context);
  if (!effectiveFrom) throw new AdapterError("no effective date found for the general callable table");
  const rows = parseSide(general, "general");

  const senior = requireGrid(grids, (g) => SLAB_HEADER.test(headerText(g, 1)) && /senior citizen/i.test(g.context), "callable term-deposit table (senior)");
  rows.push(...parseSide(senior, "senior"));

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: ["No bulk (≥₹3 crore) rate page was found; this is the callable retail card only. Capital SFB's own pages give no explicit bulk threshold for this card."],
  });
  return {
    cards: [fd],
    terms: [{ product: "fd", seniorPremium: "+0.50% p.a. flat across every slab and special tenure (60+ with proof of age)", prematurePenalty: "1% penal rate on premature closure" }],
  };
};

export const capitalSfbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /nature/i.test(headerText(x, 1)) && /rate of interest/i.test(headerText(x, 1)), "savings/current-account rate table");

  const slabs = g.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[2] ?? "");
    if (rate === null) return [];
    const type = (r[1] ?? "").toLowerCase();
    const residency = type.includes("nre") ? ("nre" as const) : type.includes("nro") ? ("nro" as const) : "resident" as const;
    return [{ balanceMin: 0, balanceMax: null, rate, residency, note: r[1] }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings rate rows found");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom: null, // the page prints no date for this table
        savingsSlabs: slabs,
        slabMethod: "whole",
        notes: ["Single flat rate for every account variant shown (Savings Bank Account, Basic/Suvidha Bachat, NRO, NRE) — no balance slabs are published."],
      }),
    ],
  };
};
