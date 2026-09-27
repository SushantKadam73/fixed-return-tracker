/** Building blocks shared by bank adapters. */
import type { Product, RateCard, RateRow, SavingsSlab, SlabMethod } from "../../../lib/domain";
import { cleanText, parseDate } from "../parse/common";
import type { Grid } from "../parse/html-table";
import type { AdapterContext } from "../types";

export class AdapterError extends Error {}

/** First grid whose context or header text matches, or throw (a missing table means the layout changed). */
export function requireGrid(grids: Grid[], test: (g: Grid) => boolean, what: string): Grid {
  const g = grids.find(test);
  if (!g) throw new AdapterError(`table not found: ${what}`);
  return g;
}

export const headerText = (g: Grid, rows = 2) => g.rows.slice(0, rows).flat().join(" | ");

/** Effective date written inside the header cell of the column matching `column`. */
export function headerEffectiveDate(g: Grid, column: RegExp): string | null {
  for (const row of g.rows.slice(0, 3)) {
    for (const cell of row) {
      if (column.test(cell)) {
        const d = parseDate(cell.replace(/.*?(w\.?\s?e\.?\s?f\.?|with effect from|effective)/i, ""));
        if (d) return d;
      }
    }
  }
  return null;
}

export function makeCard(
  ctx: AdapterContext,
  product: Product,
  rows: RateRow[],
  extra: { effectiveFrom: string | null; notes?: string[]; savingsSlabs?: SavingsSlab[]; slabMethod?: SlabMethod; sourceUrl?: string },
): RateCard {
  return {
    bankSlug: ctx.source.bankSlug,
    product,
    effectiveFrom: extra.effectiveFrom,
    observedAt: ctx.today,
    sourceType: "bank_official",
    sourceUrl: extra.sourceUrl ?? ctx.doc.finalUrl ?? ctx.source.url,
    confidence: "high",
    rows,
    savingsSlabs: extra.savingsSlabs,
    slabMethod: extra.slabMethod,
    notes: extra.notes,
  };
}

/**
 * Some banks state that RD rates equal their FD card rates. Only when the bank says so,
 * we derive the RD card from the FD rows for the tenures an RD can have.
 */
export function deriveRdFromFd(fd: RateCard, statement: string, minDays = 180, maxDays = 3650): RateCard {
  const rows = fd.rows
    .filter((r) => r.tenureMaxDays >= minDays && r.tenureMinDays <= maxDays && !r.special && r.callable !== false)
    .map((r) => ({ ...r, tenureMinDays: Math.max(r.tenureMinDays, minDays), payout: null, note: "Same as the FD card rate for this tenure (bank statement)" }));
  return { ...fd, product: "rd", rows, notes: [...(fd.notes ?? []), `RD rates derived from the FD card because the bank states: "${cleanText(statement).slice(0, 200)}"`] };
}

export const CRORE = 1e7;
export const LAKH = 1e5;
