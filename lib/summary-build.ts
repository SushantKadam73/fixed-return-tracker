/**
 * Pure functions that build the website's summary documents from rate cards.
 * Shared by Convex (convex/summaries.ts) and the collectors (committed snapshots), so both
 * data paths produce identical shapes.
 */
import type { Product, RateCard, RateRow } from "./domain";
import { FIXED_DURATIONS, rateForTenure } from "./tenure";

export const REFERENCE_AMOUNT = 1_00_000; // ₹1 lakh: reference deposit for history lines

export interface StoredCard extends RateCard {
  contentHash: string;
  validTo?: string | null;
}

export function keyRates(rows: RateRow[], customer: "general" | "senior"): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of FIXED_DURATIONS) out[d.key] = rateForTenure(rows, d.days, { amount: REFERENCE_AMOUNT, customer })?.rate ?? null;
  return out;
}

export function cardMeta(c: StoredCard) {
  return {
    effectiveFrom: c.effectiveFrom ?? null,
    validTo: c.validTo ?? null,
    observedAt: c.observedAt,
    observedFrom: c.observedFrom ?? null,
    observedTo: c.observedTo ?? null,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl,
    archiveUrl: c.archiveUrl ?? null,
    confidence: c.confidence,
  };
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const cardDate = (c: Pick<RateCard, "effectiveFrom" | "observedFrom" | "observedAt">) => c.effectiveFrom ?? c.observedFrom ?? c.observedAt;

export function productSummary(product: Product, cards: StoredCard[], current: StoredCard | null) {
  const sorted = [...cards].sort((a, b) => cardDate(a).localeCompare(cardDate(b)));
  const versions = sorted
    .map((c, i) => ({
      ...cardMeta(c),
      // A version without its own end date ends the day before the next dated revision.
      validTo: c.validTo ?? (c.effectiveFrom && sorted[i + 1]?.effectiveFrom ? dayBefore(sorted[i + 1].effectiveFrom as string) : null),
      isCurrent: c === current,
      general: product === "savings" ? null : keyRates(c.rows, "general"),
      senior: product === "savings" ? null : keyRates(c.rows, "senior"),
      baseSavingsRate:
        product === "savings" && c.savingsSlabs && c.savingsSlabs.length > 0 ? [...c.savingsSlabs].sort((a, b) => a.balanceMin - b.balanceMin)[0].rate : null,
    }));
  return {
    current: current
      ? { ...cardMeta(current), rows: current.rows, savingsSlabs: current.savingsSlabs ?? null, slabMethod: current.slabMethod ?? null, notes: current.notes ?? [] }
      : null,
    versions,
  };
}

export function currentEntry(bank: { name: string; shortName: string; group: string }, c: StoredCard) {
  return { name: bank.name, shortName: bank.shortName, group: bank.group, ...cardMeta(c), rows: c.rows, savingsSlabs: c.savingsSlabs ?? null, slabMethod: c.slabMethod ?? null };
}
