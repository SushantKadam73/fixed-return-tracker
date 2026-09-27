/**
 * History coverage: for each bank (and merged predecessor) and product, how far back the
 * recorded evidence goes, how precise it is, which kinds of sources it rests on, and where the
 * gaps are. Pure functions, shared by the snapshot builder and the site.
 *
 * Before deregulation RBI set deposit rates for every bank, so a bank's own evidence is only
 * expected from the later of its founding date and the deregulation date:
 *   - term deposits (FD, RD, bulk, NRI, tax-saver): 22 Oct 1997
 *   - savings accounts: 25 Oct 2011
 * Earlier periods are covered by the RBI-prescribed series shown on the history page.
 */
import type { Product } from "./domain";
import { cardDate, type StoredCard } from "./summary-build";

export const TD_DEREGULATED = "1997-10-22";
export const SB_DEREGULATED = "2011-10-25";
/** A stretch longer than this with no card in force (or observed) is reported as a gap. */
export const GAP_DAYS = 184;

export type Granularity = "exact" | "window" | "snapshot";

export interface CoverageGap {
  from: string;
  to: string;
  days: number;
  kind: "before_first" | "between" | "after_last" | "none";
}

export interface ProductCoverage {
  product: Product;
  versions: number;
  /** First day any recorded card applies to (effective date, or first capture). */
  earliest: string | null;
  /** Last day the recorded evidence reaches. */
  latest: string | null;
  live: boolean;
  bySource: Record<string, number>;
  byGranularity: Record<Granularity, number>;
  /** Start of the period in which the bank set this product's rates itself. */
  expectedFrom: string;
  expectedTo: string;
  gaps: CoverageGap[];
}

export interface BankCoverage {
  slug: string;
  name: string;
  kind: "bank" | "predecessor";
  group: string | null;
  founded: string | null;
  mergedInto: string | null;
  mergedOn: string | null;
  /** Periods in which this bank's rates were the RBI-prescribed ones (null if it did not exist then). */
  regulated: { termDeposits: { from: string | null; to: string } | null; savings: { from: string | null; to: string } | null };
  earliestEvidence: string | null;
  products: ProductCoverage[];
}

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toDate(toTime(d) + n * DAY);
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Founding values can be "1906", "1906-09" or "1906-09-07"; use the first day they allow. */
export function foundingDay(founded: string | null): string | null {
  if (!founded) return null;
  if (/^\d{4}$/.test(founded)) return `${founded}-01-01`;
  if (/^\d{4}s$/.test(founded)) return `${founded.slice(0, 4)}-01-01`;
  if (/^\d{4}-\d{2}$/.test(founded)) return `${founded}-01`;
  return /^\d{4}-\d{2}-\d{2}$/.test(founded) ? founded : null;
}

export function deregulationFor(product: Product): string {
  return product === "savings" ? SB_DEREGULATED : TD_DEREGULATED;
}

/**
 * Cards from complete revision lists stay in force until the next revision: live cards (the
 * collector re-reads the page daily; staleness is flagged separately on the status page) and
 * dated entries in a bank's own archive.
 */
function runsUntilNext(c: StoredCard): boolean {
  return c.sourceType === "bank_official" || (!!c.effectiveFrom && c.sourceType === "bank_archive");
}

export function productCoverage(product: Product, cards: StoredCard[], ctx: { founded: string | null; endDate: string }): ProductCoverage {
  const founded = foundingDay(ctx.founded);
  const expectedFrom = founded ? maxDate(founded, deregulationFor(product)) : deregulationFor(product);
  const expectedTo = ctx.endDate;
  const sorted = [...cards].sort((a, b) => cardDate(a).localeCompare(cardDate(b)));
  const bySource: Record<string, number> = {};
  const byGranularity: Record<Granularity, number> = { exact: 0, window: 0, snapshot: 0 };
  const spans: Array<{ start: string; end: string }> = [];
  sorted.forEach((c, i) => {
    bySource[c.sourceType] = (bySource[c.sourceType] ?? 0) + 1;
    byGranularity[c.effectiveFrom ? "exact" : c.observedFrom ? "window" : "snapshot"]++;
    const start = cardDate(c);
    const next = sorted[i + 1] ? cardDate(sorted[i + 1]) : null;
    let end = c.validTo ?? c.observedTo ?? null;
    if (!end && runsUntilNext(c)) end = next ? addDays(next, -1) : expectedTo;
    spans.push({ start, end: maxDate(end ?? start, start) });
  });

  const gaps: CoverageGap[] = [];
  if (spans.length === 0) {
    if (daysBetween(expectedFrom, expectedTo) > 0) gaps.push({ from: expectedFrom, to: expectedTo, days: daysBetween(expectedFrom, expectedTo), kind: "none" });
  } else {
    let cursor = expectedFrom;
    spans.forEach((s, i) => {
      const startInScope = maxDate(s.start, expectedFrom);
      const d = daysBetween(cursor, startInScope);
      if (d > GAP_DAYS) gaps.push({ from: cursor, to: addDays(startInScope, -1), days: d, kind: i === 0 ? "before_first" : "between" });
      cursor = maxDate(cursor, addDays(s.end, 1));
    });
    const tail = daysBetween(cursor, expectedTo);
    if (tail > GAP_DAYS) gaps.push({ from: cursor, to: expectedTo, days: tail, kind: "after_last" });
  }

  return {
    product,
    versions: sorted.length,
    earliest: spans[0]?.start ?? null,
    latest: spans.length ? minDate(spans.reduce((m, s) => maxDate(m, s.end), spans[0].end), expectedTo) : null,
    live: sorted.some((c) => c.sourceType === "bank_official"),
    bySource,
    byGranularity,
    expectedFrom,
    expectedTo,
    gaps,
  };
}

export function regulatedPeriods(founded: string | null, endDate: string): BankCoverage["regulated"] {
  const f = foundingDay(founded);
  const span = (until: string) => {
    if (f && f >= until) return null; // the bank did not exist before deregulation
    return { from: f, to: minDate(addDays(until, -1), endDate) };
  };
  return { termDeposits: span(TD_DEREGULATED), savings: span(SB_DEREGULATED) };
}

export const COVERAGE_PRODUCTS: Product[] = ["fd", "rd", "savings", "fd_bulk"];

export function bankCoverage(
  bank: { slug: string; name: string; group?: string | null; founded: string | null; mergedInto?: string | null; mergedOn?: string | null },
  productsCards: Partial<Record<Product, StoredCard[]>>,
  today: string,
): BankCoverage {
  const endDate = bank.mergedOn ? minDate(addDays(bank.mergedOn, -1), today) : today;
  const products = [...new Set<Product>([...COVERAGE_PRODUCTS, ...(Object.keys(productsCards) as Product[])])]
    .filter((p) => COVERAGE_PRODUCTS.includes(p) || (productsCards[p]?.length ?? 0) > 0)
    .map((p) => productCoverage(p, productsCards[p] ?? [], { founded: bank.founded, endDate }));
  const earliest = products.map((p) => p.earliest).filter((d): d is string => !!d).sort()[0] ?? null;
  return {
    slug: bank.slug,
    name: bank.name,
    kind: bank.mergedInto ? "predecessor" : "bank",
    group: bank.group ?? null,
    founded: bank.founded,
    mergedInto: bank.mergedInto ?? null,
    mergedOn: bank.mergedOn ?? null,
    regulated: regulatedPeriods(bank.founded, endDate),
    earliestEvidence: earliest,
    products,
  };
}
