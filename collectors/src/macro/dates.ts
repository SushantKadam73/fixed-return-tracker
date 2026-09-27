/** Date/quarter/fiscal-year helpers shared by the macro tasks. All dates are YYYY-MM-DD. */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Indian financial year (1 Apr - 31 Mar) containing `date`. */
export function fyOf(date: string): { startYear: number; start: string; end: string; label: string } {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return { startYear, start: iso(startYear, 4, 1), end: iso(startYear + 1, 3, 31), label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}` };
}

export type QuarterName = "April-June" | "July-Sep" | "Oct-Dec" | "Jan-Mar";

const QUARTERS: Array<{ name: QuarterName; startMonth: number; endMonth: number; fyOffset: 0 | 1 }> = [
  { name: "April-June", startMonth: 4, endMonth: 6, fyOffset: 0 },
  { name: "July-Sep", startMonth: 7, endMonth: 9, fyOffset: 0 },
  { name: "Oct-Dec", startMonth: 10, endMonth: 12, fyOffset: 0 },
  { name: "Jan-Mar", startMonth: 1, endMonth: 3, fyOffset: 1 },
];

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The small-savings/GPF quarter (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar) containing `date`. */
export function quarterOf(date: string): { start: string; end: string; name: QuarterName; fyStartYear: number } {
  const { startYear } = fyOf(date);
  const [, m] = date.split("-").map(Number);
  const q = QUARTERS.find((q) => m >= q.startMonth && m <= q.endMonth) ?? QUARTERS[3];
  const y = startYear + q.fyOffset;
  return { start: iso(y, q.startMonth, 1), end: iso(y, q.endMonth, lastDayOfMonth(y, q.endMonth)), name: q.name, fyStartYear: startYear };
}

export function nextQuarter(q: { start: string }): { start: string; end: string; name: QuarterName; fyStartYear: number } {
  const d = new Date(`${q.start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 3, 1);
  return quarterOf(d.toISOString().slice(0, 10));
}

/** RBI Floating Rate Savings Bond half-year (Jan-Jun, Jul-Dec) containing `date`. */
export function halfYearOf(date: string): { start: string; end: string } {
  const [y, m] = date.split("-").map(Number);
  return m <= 6 ? { start: iso(y, 1, 1), end: iso(y, 6, 30) } : { start: iso(y, 7, 1), end: iso(y, 12, 31) };
}

export function nextHalfYear(h: { end: string }): { start: string; end: string } {
  return halfYearOf(dayAfter(h.end));
}

/** Parses an NSI-style FY column header ("2025- 2026", "2022 - 2023", "2011-2012(w.e.f 01/12/2011)"). */
export function parseFyLabel(label: string): { startYear: number; endYear: number } | null {
  const years = [...label.matchAll(/\d{4}/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;
  const startYear = years[0];
  const endYear = years.length > 1 && years[1] === startYear + 1 ? years[1] : startYear + 1;
  return { startYear, endYear };
}

/** Maps a quarter column header text (tolerant of case/whitespace/hyphen variants) plus its FY start year to a date range. */
export function quarterNameToRange(text: string, fyStartYear: number): { start: string; end: string; name: QuarterName } | null {
  const t = text.toLowerCase().replace(/\s+/g, "");
  if (/^april?-?jun/i.test(t) || /^apr-?jun/.test(t)) return { name: "April-June", start: iso(fyStartYear, 4, 1), end: iso(fyStartYear, 6, 30) };
  if (/^july?-?sep/.test(t)) return { name: "July-Sep", start: iso(fyStartYear, 7, 1), end: iso(fyStartYear, 9, 30) };
  if (/^oct-?dec/.test(t)) return { name: "Oct-Dec", start: iso(fyStartYear, 10, 1), end: iso(fyStartYear, 12, 31) };
  if (/^jan-?mar/.test(t)) return { name: "Jan-Mar", start: iso(fyStartYear + 1, 1, 1), end: iso(fyStartYear + 1, 3, 31) };
  return null;
}

/** True if `a` is strictly before `b` (both YYYY-MM-DD). */
export function before(a: string, b: string): boolean {
  return a < b;
}

/** Whole days from `from` to `to` (positive when `to` is later, negative when it's past); both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
