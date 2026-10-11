import type { RateCard } from "./domain";

/**
 * Normalise a card before hashing and storing:
 *  - collapse stray whitespace/newlines in tenure labels (labels are not part of the content hash);
 *  - drop rows that repeat another row exactly apart from the label (some archived pages print
 *    the same slab twice);
 *  - close exact 1-rupee gaps between adjacent amount bands. Banks write "Rs 3 crore to Rs 10 crore"
 *    followed by "above Rs 10 crore"; read label by label the first band ends just below 10 crore
 *    and the second starts just above it, leaving exactly Rs 10 crore in neither. The pair shows
 *    the boundary amount belongs to the lower band, so the lower band's (exclusive) end is moved
 *    up by one rupee. Nothing else is changed.
 */
export function normaliseCard(card: RateCard): RateCard {
  const seen = new Set<string>();
  const rows = card.rows
    .map((r) => ({ ...r, tenureLabel: r.tenureLabel.replace(/\s+/g, " ").trim() }))
    .filter((r) => {
      const { tenureLabel: _label, ...rest } = r;
      void _label;
      const key = JSON.stringify(rest, Object.keys(rest).sort());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = [r.tenureMinDays, r.tenureMaxDays, r.customer, r.residency, r.callable, r.payout, r.schemeName ?? ""].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.amountMin - b.amountMin);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const cur = sorted[i];
      if (cur.amountMax !== null && sorted[i + 1].amountMin === cur.amountMax + 1) cur.amountMax = sorted[i + 1].amountMin;
    }
  }
  let savingsSlabs = card.savingsSlabs;
  if (savingsSlabs && savingsSlabs.length > 1) {
    savingsSlabs = savingsSlabs.map((s) => ({ ...s }));
    const byRes = new Map<string, typeof savingsSlabs>();
    for (const s of savingsSlabs) byRes.set(s.residency, [...(byRes.get(s.residency) ?? []), s]);
    for (const list of byRes.values()) {
      const sorted = [...list].sort((a, b) => a.balanceMin - b.balanceMin);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const cur = sorted[i];
        if (cur.balanceMax !== null && sorted[i + 1].balanceMin === cur.balanceMax + 1) cur.balanceMax = sorted[i + 1].balanceMin;
      }
    }
  }
  return { ...card, rows, ...(savingsSlabs ? { savingsSlabs } : {}) };
}
