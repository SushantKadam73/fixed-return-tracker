/**
 * Parse the many ways Indian banks write deposit tenures into an inclusive day range.
 *
 * Conventions (documented so every adapter behaves the same):
 *  - 1 year = 365 days; 1 month = 365/12 days (rounded), so 12 months = 365, 15 months = 456.
 *  - "less than X" / "below X" / "upto but excluding" → X − 1 day.
 *  - "above X" / "more than X" / "over X" / "> X" → X + 1 day.
 *  - "X and above" / "X & above" → X (inclusive).
 *  - A single duration ("444 days", "5 years") is a point tenure: min = max.
 *  - "1 year 1 day" = 366; "15 months 1 day" = 457.
 * Returns null when the label cannot be read with confidence — adapters must then fail
 * loudly rather than guess.
 */
export interface TenureRange {
  minDays: number;
  maxDays: number;
  point: boolean;
}

const DAYS_PER_YEAR = 365;
const MAX_DAYS = 3650;

type Unit = "d" | "m" | "y";

function unitOf(word: string): Unit | null {
  const w = word.toLowerCase();
  if (/^(d|day|days)$/.test(w)) return "d";
  if (/^(m|mo|mon|mnth|mnths|month|months)$/.test(w)) return "m";
  if (/^(y|yr|yrs|year|years)$/.test(w)) return "y";
  return null;
}

function toDays(n: number, unit: Unit): number {
  if (unit === "d") return n;
  if (unit === "m") return Math.round((n * DAYS_PER_YEAR) / 12);
  return Math.round(n * DAYS_PER_YEAR);
}

/** Parse a duration such as "1 year 1 day", "15 months", "444 days", "2 yrs", "1 Yr". Unit may be inherited. */
function parseDuration(text: string, inheritUnit?: Unit | null): { days: number; unit: Unit } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const parts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)?/g)];
  if (parts.length === 0) return null;
  let total = 0;
  let lastUnit: Unit | null = null;
  for (const p of parts) {
    const n = Number(p[1]);
    const u = p[2] ? unitOf(p[2]) : null;
    const unit = u ?? (parts.length === 1 ? (inheritUnit ?? null) : null);
    if (!unit) return null;
    total += toDays(n, unit);
    lastUnit = unit;
  }
  return lastUnit ? { days: total, unit: lastUnit } : null;
}

const LESS = /(?:\b(?:less than|below|upto but less than|under)\b|<)\s*/;
const ABOVE = /(?:\b(?:above|more than|over|exceeding|beyond)\b|>)\s*/;
const OPEN_END = /\b(and above|and more|onwards|and over)\b/;

export function parseTenure(label: string): TenureRange | null {
  let t = label
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\(.*?\)/g, " ") // drop notes like "(Tax Saver)" or "(Amrit Vrishti)"
    .replace(/[*#@^]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  t = t.replace(/\bup ?to\b/g, "upto").replace(/\bupto and including\b/g, "upto");

  // Split into lower and upper bounds.
  let lower = t;
  let upper: string | null = null;
  const splitters = [/\s+to\s+/, /\s*-\s*(?=\d|less|below|upto|under)/, /\s+upto\s+/, /\s+and\s+(?=less|below|upto|under)/, /\s+but\s+/, /\s+till\s+/];
  for (const s of splitters) {
    const m = t.split(s);
    if (m.length === 2 && /\d/.test(m[0]) && /\d/.test(m[1])) {
      lower = m[0];
      upper = m[1];
      break;
    }
  }

  // "5 years and above" / "X and above" (no upper bound): open-ended up to 10 years.
  const andAbove = OPEN_END.test(lower) && !upper;
  let lowerCore = lower.replace(OPEN_END, " ");
  const lowerExclusive = ABOVE.test(lowerCore);
  lowerCore = lowerCore.replace(ABOVE, " ").replace(/\bfrom\b/g, " ").replace(/\band\s*$/, " ").trim();
  const lowerClean = lowerCore;

  if (upper === null) {
    const d = parseDuration(lowerClean);
    if (!d) return null;
    if (andAbove) return clamp({ minDays: d.days, maxDays: MAX_DAYS, point: false });
    if (lowerExclusive) return clamp({ minDays: d.days + 1, maxDays: MAX_DAYS, point: false });
    if (LESS.test(lower)) return clamp({ minDays: 1, maxDays: d.days - 1, point: false });
    return clamp({ minDays: d.days, maxDays: d.days, point: true });
  }

  const upperExclusive = LESS.test(upper);
  const upperClean = upper.replace(LESS, "").replace(/\b(upto|and|inclusive)\b/g, " ").trim();
  const hi = parseDuration(upperClean);
  if (!hi) return null;
  const lo = parseDuration(lowerClean, hi.unit);
  if (!lo) return null;
  const minDays = lowerExclusive ? lo.days + 1 : lo.days;
  const maxDays = upperExclusive ? hi.days - 1 : hi.days;
  if (maxDays < minDays) return null;
  return clamp({ minDays, maxDays, point: false });
}

function clamp(r: TenureRange): TenureRange | null {
  if (r.minDays < 1 || r.maxDays > MAX_DAYS + 10 || r.maxDays < r.minDays) return null;
  return r;
}
