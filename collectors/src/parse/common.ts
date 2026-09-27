/** Small parsing helpers shared by adapters: rates, effective dates, text cleanup. */

export function cleanText(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** "6.25", "6.25%", "6.25 *", "6.25#" → 6.25; "NA", "-", "N.A.", "Not applicable", "" → null. */
export function parseRate(cell: string): number | null {
  const t = cleanText(cell)
    .replace(/[*#@^]+/g, "")
    .replace(/%/g, "")
    .replace(/\b(p\.?\s?a\.?|per annum)\s*$/i, "")
    .trim();
  if (!t || /^(na|n\.a\.?|n\/a|-+|—|nil|not applicable|not available|x)$/i.test(t)) return null;
  const m = /^(\d{1,2}(?:\.\d{1,3})?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 20 ? v : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** Find a date in text; Indian day-first order assumed for numeric dates. */
export function parseDate(text: string): string | null {
  const t = cleanText(text).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
  let m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /(\d{1,2})[\s-]+([a-z]{3,9})[\s,-]+(\d{4})/.exec(t);
  if (m && MONTHS[m[2]]) return iso(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  m = /([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m && MONTHS[m[1]]) return iso(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Effective date from phrases like "w.e.f. 15.12.2025", "effective from 1st June 2026", "with effect from ...". */
export function findEffectiveDate(text: string): string | null {
  const t = cleanText(text);
  const re = /(w\.?\s?e\.?\s?f\.?|with effect from|effective from|effective date|effective)\s*[:\-]?\s*([^|;]{4,40})/gi;
  const found: string[] = [];
  for (const m of t.matchAll(re)) {
    const d = parseDate(m[2]);
    if (d) found.push(d);
  }
  if (found.length === 0) return null;
  // Pages often mention the previous and the revised date; the latest is the one in force.
  return found.sort().at(-1) ?? null;
}
