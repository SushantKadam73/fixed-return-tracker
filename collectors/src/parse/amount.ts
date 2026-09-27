/**
 * Parse Indian amount labels ("Below ₹3 Crore", "Rs. 3 Cr & above", "₹1,00,01,000 to less than
 * ₹3,00,00,000", "upto Rs 1 lakh") into a half-open rupee band [min, max).
 */
export interface AmountBand {
  min: number; // inclusive
  max: number | null; // exclusive, null = no upper limit
}

const UNIT: Record<string, number> = { crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, thousand: 1e3, k: 1e3 };

/** Every amount mentioned in the text, in rupees, in order. */
export function amountsIn(text: string): number[] {
  const t = text.toLowerCase().replace(/₹|rs\.?|inr/g, " ").replace(/ /g, " ");
  const out: number[] = [];
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l\b|thousand|k\b)?/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push(m[2] ? n * (UNIT[m[2]] ?? 1) : n);
  }
  return out;
}

export function parseAmountBand(label: string): AmountBand | null {
  const t = label.toLowerCase();
  const nums = amountsIn(t);
  if (nums.length === 0) return null;
  const below = /\b(below|less than|under|upto|up to|<)\b/.test(t);
  const above = /\b(above|more than|over|and above|& above|exceeding|>|onwards)\b/.test(t);
  if (nums.length >= 2) {
    const [a, b] = nums;
    // "₹1,00,01,000 to less than ₹3 crore" → [1,00,01,000, 3 crore); "above 2 cr upto 5 cr" → (2 cr, 5 cr]
    const lowerExclusive = /^\s*(above|more than|over|>)/.test(t);
    const upperInclusive = /\b(upto|up to|and including|inclusive)\b/.test(t.split(/\bto\b|-/)[1] ?? "") && !/less than|below/.test(t);
    return { min: lowerExclusive ? a + 1 : a, max: upperInclusive ? b + 1 : b };
  }
  const [x] = nums;
  if (below) return { min: 0, max: /\bupto\b|\bup to\b/.test(t) ? x + 1 : x };
  if (above) return { min: /\band above\b|& above|onwards/.test(t) ? x : x + 1, max: null };
  return null;
}
