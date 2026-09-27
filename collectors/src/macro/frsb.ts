/**
 * Task `frsb`: RBI Floating Rate Savings Bonds 2020 (Taxable), half-yearly coupon.
 * Entirely formulaic — coupon = NSC rate (most recent DEA-notified quarter) + 0.35%,
 * reset every 1 Jan / 1 Jul (Govt Notification F.No.4(10)-B(W&M)/2020, 26 Jun 2020,
 * para 13(ii)) — confirmed by RBI's own semi-annual press release. See README.md.
 */
import type { MacroTaskContext, SchemePeriodChange, TaskResult } from "./types";
import { lastSchemePeriod } from "./store";
import { halfYearOf, nextHalfYear } from "./dates";

const SPREAD = 0.35;

/** True when RBI's press release for this half-year states the coupon (tolerant of "remains at"/"is reset to"). */
export function extractCoupon(text: string): number | null {
  const m = /coupon(?:\/interest)?\s*rate[^%]{0,120}?(?:remains at|is reset to|reset at|set at|of)\s*(\d{1,2}\.\d{1,2})\s*%/i.exec(text);
  return m ? Number(m[1]) : null;
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "frsb", ok: false, sourcesTried: [], changes: [], warnings: [] };

  const nscLast = lastSchemePeriod(ctx.root, "nsc");
  const frsbLast = lastSchemePeriod(ctx.root, "frsb_2020");
  if (!nscLast || !frsbLast) {
    result.error = "data/schemes/nsc.json or frsb_2020.json has no periods";
    return result;
  }
  const half = nextHalfYear(halfYearOf(frsbLast.effectiveTo ?? frsbLast.effectiveFrom));
  const nscCoversHalf = (nscLast.effectiveTo ?? nscLast.effectiveFrom) >= half.start;
  if (!nscCoversHalf || nscLast.rate === null) {
    result.ok = true;
    result.warnings.push(`NSC has not yet confirmed a rate covering ${half.start}; nothing for FRSB to compute yet.`);
    return result;
  }

  const coupon = Math.round((nscLast.rate + SPREAD) * 100) / 100;
  const note = `Coupon = NSC rate (${nscLast.rate}%) + ${SPREAD}% per the reset formula (Govt Notification F.No.4(10)-B(W&M)/2020, para 13(ii)).`;

  // Best-effort confirmation: RBI publishes a press release for each half-year, but there is
  // no safe way to discover its exact URL/prid without guessing (see README "known gaps") —
  // this task therefore relies on the documented formula and does not guess a press-release URL.
  result.ok = true;
  result.warnings.push("RBI's confirming press release for this half-year was not independently located (no safe discovery path); coupon computed from the documented NSC+0.35% formula instead.");

  const change: SchemePeriodChange = {
    kind: "scheme_period",
    scheme: "frsb_2020",
    period: { effectiveFrom: half.start, effectiveTo: half.end, rate: coupon, note, sourceUrl: nscLast.sourceUrl, evidence: "secondary", crossCheckUrl: null },
  };
  result.changes.push(change);
  result.usedSourceUrl = nscLast.sourceUrl;
  return result;
}

/** Exposed for callers/tests that already have RBI press-release text and want to cross-check the formula's output. */
export function crossCheckAgainstPressRelease(text: string, computed: number): { matches: boolean; found: number | null } {
  const found = extractCoupon(text);
  return { matches: found !== null && Math.abs(found - computed) < 1e-6, found };
}
