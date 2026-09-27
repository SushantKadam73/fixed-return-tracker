/**
 * "What is this money really worth?" — inflation adjustment using a price index series.
 *
 * value_in_target_period = amount × index(target) / index(base)
 *
 * The index series must already be a single consistent chain (older bases joined with the
 * publisher's official linking factors). Missing months are never filled in: if either
 * end of the comparison has no index value, the result is null and the UI says
 * "not reported".
 */
import type { SeriesPoint } from "../domain";

export interface RealValueResult {
  amount: number;
  fromPeriod: string;
  toPeriod: string;
  fromIndex: number;
  toIndex: number;
  equivalent: number; // amount expressed in `toPeriod` money
  multiple: number; // toIndex / fromIndex
  annualisedInflationPct: number | null;
}

function indexAt(series: SeriesPoint[], period: string): number | null {
  const hit = series.find((p) => p.date === period);
  return hit ? hit.value : null;
}

function yearsBetween(from: string, to: string): number | null {
  const parse = (p: string) => {
    const m = /^(\d{4})(?:-(\d{2}))?/.exec(p);
    if (!m) return null;
    return Number(m[1]) + (m[2] ? (Number(m[2]) - 1) / 12 : 0);
  };
  const a = parse(from);
  const b = parse(to);
  return a === null || b === null ? null : b - a;
}

export function inflationAdjust(
  amount: number,
  fromPeriod: string,
  toPeriod: string,
  series: SeriesPoint[],
): RealValueResult | null {
  const fromIndex = indexAt(series, fromPeriod);
  const toIndex = indexAt(series, toPeriod);
  if (fromIndex === null || toIndex === null || fromIndex <= 0) return null;
  const multiple = toIndex / fromIndex;
  const years = yearsBetween(fromPeriod, toPeriod);
  const annualised = years && years > 0 ? (Math.pow(multiple, 1 / years) - 1) * 100 : null;
  return { amount, fromPeriod, toPeriod, fromIndex, toIndex, equivalent: amount * multiple, multiple, annualisedInflationPct: annualised };
}
