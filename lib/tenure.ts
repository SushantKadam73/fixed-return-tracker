/**
 * Tenure handling — the logic behind the "normalise tenure" toggle.
 *
 * Banks publish rates for their own slabs ("1 year to less than 2 years") and for
 * special single tenures ("444 days"). To compare banks side by side we map every
 * published slab onto common buckets. Rules:
 *  - Nothing is interpolated: a bucket shows a rate the bank actually publishes for
 *    some tenure inside that bucket, together with that exact tenure label.
 *  - If a bank's best rate in the bucket is only available for one specific tenure
 *    (e.g. 444 days), the result says so, because the saver must pick exactly that tenure.
 *  - A bucket with no matching slab is "not offered", never zero.
 */
import type { CustomerType, RateRow, Residency } from "./domain";

export const DAYS_PER_YEAR = 365;

export interface TenureBucket {
  key: string;
  label: string; // shown in the UI
  minDays: number; // inclusive
  maxDays: number; // inclusive
}

/**
 * Common buckets. Year boundaries follow the way Indian banks write slabs
 * (1 year = 365 days, "1 year to less than 2 years" = 365–729 days). The 12–24 month
 * range is split into quarters so special tenures (400, 444, 555, 666 days) land
 * in a meaningful place: 444 days → 12–15 months, 555 days → 18–21 months.
 */
export const TENURE_BUCKETS: TenureBucket[] = [
  { key: "d7_45", label: "7–45 days", minDays: 7, maxDays: 45 },
  { key: "d46_90", label: "46–90 days", minDays: 46, maxDays: 90 },
  { key: "m3_6", label: "3–6 months", minDays: 91, maxDays: 180 },
  { key: "m6_9", label: "6–9 months", minDays: 181, maxDays: 270 },
  { key: "m9_12", label: "9–12 months", minDays: 271, maxDays: 364 },
  { key: "m12_15", label: "12–15 months", minDays: 365, maxDays: 455 },
  { key: "m15_18", label: "15–18 months", minDays: 456, maxDays: 547 },
  { key: "m18_21", label: "18–21 months", minDays: 548, maxDays: 638 },
  { key: "m21_24", label: "21–24 months", minDays: 639, maxDays: 729 },
  { key: "y2_3", label: "2–3 years", minDays: 730, maxDays: 1094 },
  { key: "y3_5", label: "3–5 years", minDays: 1095, maxDays: 1824 },
  { key: "y5_10", label: "5–10 years", minDays: 1825, maxDays: 3650 },
];

/** Fixed durations for the simple "1 year / 2 years / ..." view. */
export const FIXED_DURATIONS: Array<{ key: string; label: string; days: number }> = [
  { key: "6m", label: "6 months", days: 182 },
  { key: "1y", label: "1 year", days: 365 },
  { key: "2y", label: "2 years", days: 730 },
  { key: "3y", label: "3 years", days: 1095 },
  { key: "5y", label: "5 years", days: 1825 },
];

/** Convert years/months/days to days using the conventions banks use on rate cards. */
export function toDays(parts: { years?: number; months?: number; days?: number }): number {
  const { years = 0, months = 0, days = 0 } = parts;
  // Months are converted at 365/12 days and rounded, so 12 months === 1 year === 365 days.
  return Math.round(years * DAYS_PER_YEAR + months * (DAYS_PER_YEAR / 12) + days);
}

export interface RowFilter {
  amount: number; // deposit amount in rupees
  customer: CustomerType;
  residency?: Residency;
  callable?: boolean | null; // undefined = accept any; true = only callable; false = only non-callable
}

/** Does this published row apply to the depositor described by the filter? */
export function rowMatches(row: RateRow, f: RowFilter): boolean {
  if (row.customer !== f.customer) return false;
  if ((f.residency ?? "resident") !== row.residency) return false;
  if (f.amount < row.amountMin) return false;
  if (row.amountMax !== null && f.amount >= row.amountMax) return false;
  if (f.callable !== undefined && f.callable !== null && row.callable !== null && row.callable !== f.callable) return false;
  return true;
}

export interface BucketResult {
  bucket: TenureBucket;
  status: "offered" | "not_offered";
  rate: number | null;
  /** Exact tenure label(s) the best rate comes from, as the bank wrote them. */
  tenureLabel: string | null;
  /** True when the best rate needs one specific tenure (e.g. exactly 444 days). */
  specificTenureOnly: boolean;
  /** True when the best rate applies across the whole bucket, any tenure inside it. */
  coversWholeBucket: boolean;
  row: RateRow | null;
}

/** Best published rate for one bank inside one bucket (normalised view). */
export function bestInBucket(rows: RateRow[], bucket: TenureBucket, f: RowFilter): BucketResult {
  let best: RateRow | null = null;
  for (const row of rows) {
    if (!rowMatches(row, f)) continue;
    const overlaps = row.tenureMinDays <= bucket.maxDays && row.tenureMaxDays >= bucket.minDays;
    if (!overlaps) continue;
    if (
      best === null ||
      row.rate > best.rate ||
      // On a tie, prefer the row that covers more of the bucket (more flexibility for the saver).
      (row.rate === best.rate && coverage(row, bucket) > coverage(best, bucket))
    ) {
      best = row;
    }
  }
  if (!best) {
    return { bucket, status: "not_offered", rate: null, tenureLabel: null, specificTenureOnly: false, coversWholeBucket: false, row: null };
  }
  const covers = best.tenureMinDays <= bucket.minDays && best.tenureMaxDays >= bucket.maxDays;
  return {
    bucket,
    status: "offered",
    rate: best.rate,
    tenureLabel: best.tenureLabel,
    specificTenureOnly: best.tenureMinDays === best.tenureMaxDays,
    coversWholeBucket: covers,
    row: best,
  };
}

function coverage(row: RateRow, bucket: TenureBucket): number {
  const lo = Math.max(row.tenureMinDays, bucket.minDays);
  const hi = Math.min(row.tenureMaxDays, bucket.maxDays);
  return Math.max(0, hi - lo + 1);
}

/** Rate that applies to an exact tenure in days (fixed-duration view and calculators). */
export function rateForTenure(rows: RateRow[], days: number, f: RowFilter): RateRow | null {
  const matches = rows.filter((r) => rowMatches(r, f) && r.tenureMinDays <= days && r.tenureMaxDays >= days);
  if (matches.length === 0) return null;
  // Several rows can cover the same day (e.g. a regular slab and a named scheme with the same tenure);
  // pick the highest published rate and let the UI show its label.
  return matches.reduce((a, b) => (b.rate > a.rate ? b : a));
}

/** Which bucket an exact tenure falls into (e.g. 444 → "12–15 months"). */
export function bucketForDays(days: number): TenureBucket | null {
  return TENURE_BUCKETS.find((b) => days >= b.minDays && days <= b.maxDays) ?? null;
}
