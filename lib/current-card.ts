/** One date rule for live collection, imports and fallback summaries. */
export interface DatedCard {
  sourceType: string;
  effectiveFrom?: string | null;
  observedAt: string;
  validTo?: string | null;
}

export function eligibleCurrentCard(card: DatedCard, today: string): boolean {
  return card.sourceType === "bank_official" &&
    (card.effectiveFrom ?? card.observedAt) <= today &&
    (!card.validTo || card.validTo >= today);
}

export function currentOfficialCard<T extends DatedCard>(cards: readonly T[], today: string): T | null {
  return cards.filter((card) => eligibleCurrentCard(card, today))
    .sort((a, b) => (a.effectiveFrom ?? a.observedAt).localeCompare(b.effectiveFrom ?? b.observedAt) ||
      a.observedAt.localeCompare(b.observedAt)).at(-1) ?? null;
}
