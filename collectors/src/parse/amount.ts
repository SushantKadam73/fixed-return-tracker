/**
 * Parse Indian amount labels ("Below ₹3 Crore", "Rs. 3 Cr & above", "₹1,00,01,000 to less than
 * ₹3,00,00,000", "upto Rs 1 lakh") into a half-open rupee band [min, max).
 */
export interface AmountBand {
  min: number; // inclusive
  max: number | null; // exclusive, null = no upper limit
}

const UNIT: Record<string, number> = { crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, thousand: 1e3, k: 1e3 };

const AMOUNT_RE = /(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|l\b|thousand|k\b)?/g;

interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

/** Find every amount in `text`, in rupees, together with its position in the (currency-marker
 * stripped) text those positions refer to — callers that need to know what qualifier sits before
 * or after a given number use the returned `text`, not the original string, to stay aligned.
 * "rs"/"Rs." is only stripped as a currency marker at a word boundary, so it doesn't eat the "rs"
 * hiding inside an abbreviation like "Crs" (crores) — the un-anchored version turns "3 Crs" into
 * "3 C ", losing the crore multiplier entirely. */
function findAmounts(text: string): { matches: AmountMatch[]; text: string } {
  const t = text.toLowerCase().replace(/₹|\brs\.?|inr/g, " ").replace(/ /g, " ");
  const matches: AmountMatch[] = [];
  for (const m of t.matchAll(AMOUNT_RE)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    matches.push({ value: m[2] ? n * (UNIT[m[2]] ?? 1) : n, start: m.index, end: m.index + m[0].length });
  }
  return { matches, text: t };
}

/** Every amount mentioned in the text, in rupees, in order. */
export function amountsIn(text: string): number[] {
  return findAmounts(text).matches.map((m) => m.value);
}

// Word forms use `\b`. ">"/"<"/"≥"/"≤" are matched as bare characters in a class instead of
// `\b`-wrapped, because `\b` never matches around a symbol with a space (or start-of-string) on
// both sides — e.g. in "> 3 Cr" a naive `\b>\b` silently never fires. The "&"-spelled inclusive
// forms below have the same problem and are likewise left un-wrapped.
const BELOW_WORDS = /\b(below|less than|under|upto|up to)\b/;
const ABOVE_WORDS = /\b(above|more than|over|exceeding|onwards)\b/;
const INCLUSIVE_LOWER = /\band above\b|& above|≥/; // "X and above" / "X & above" / "≥X": inclusive of X
const INCLUSIVE_UPPER = /\bupto\b|\bup to\b|\band including\b|\binclusive\b|≤/; // inclusive of X
const LESS_WORDS_ONLY = /less than|below/; // guards the upper check against a plain exclusive upper

export function parseAmountBand(label: string): AmountBand | null {
  const t = label.toLowerCase();
  const { matches, text: stripped } = findAmounts(t);
  if (matches.length === 0) return null;
  const below = BELOW_WORDS.test(t) || /[<≤]/.test(t);
  const above = ABOVE_WORDS.test(t) || /[>≥]/.test(t);

  if (matches.length >= 2) {
    const [a, b] = [matches[0].value, matches[1].value];
    // The qualifier for the first number sits in the text right before it — reading it there,
    // rather than anchoring to the very start of the label, still finds it behind a long prose
    // prefix such as "for single deposit of above ₹1 Crore to less than ₹3 Crore".
    const prefix = stripped.slice(0, matches[0].start);
    const lowerExclusive = (ABOVE_WORDS.test(prefix) || /[>≥]/.test(prefix)) && !INCLUSIVE_LOWER.test(prefix);
    // The qualifier for the second number sits somewhere after the first ("... to less than Y",
    // "... upto Y", "... upto and including Y", "... to Y inclusive") — found the same way, not
    // by splitting on a literal "to" word, which "upto" written as one word has none of.
    const between = stripped.slice(matches[0].end);
    const upperInclusive = INCLUSIVE_UPPER.test(between) && !LESS_WORDS_ONLY.test(between);
    return { min: lowerExclusive ? a + 1 : a, max: upperInclusive ? b + 1 : b };
  }

  const [x] = [matches[0].value];
  if (below) return { min: 0, max: INCLUSIVE_UPPER.test(t) ? x + 1 : x };
  if (above) return { min: INCLUSIVE_LOWER.test(t) ? x : x + 1, max: null };
  return null;
}
