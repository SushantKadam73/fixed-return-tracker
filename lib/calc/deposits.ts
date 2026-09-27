/**
 * Deposit maths used by the calculators.
 *
 * Conventions follow the Indian Banks' Association practice that banks cite in their
 * deposit policies ("interest calculated at quarterly rests"; monthly payout at a
 * discounted value). Individual banks round differently, so results are labelled as
 * estimates and the bank's own calculator is always linked.
 */
import type { SavingsSlab, SlabMethod } from "../domain";

const DAYS_PER_QUARTER = 365 / 4;

/** Short deposits (below this many days) earn simple interest paid at maturity. */
export const SIMPLE_INTEREST_BELOW_DAYS = 180;

export interface FdResult {
  principal: number;
  maturity: number;
  interest: number;
  method: "simple" | "quarterly_compounding";
  /** Effective annual yield of the quoted rate (for comparing with other products). */
  effectiveAnnualYield: number;
}

/** Cumulative FD: maturity value for `days` at `ratePct` % p.a. */
export function fdMaturity(principal: number, ratePct: number, days: number): FdResult {
  if (principal <= 0 || days <= 0) throw new Error("principal and days must be positive");
  const r = ratePct / 100;
  let maturity: number;
  let method: FdResult["method"];
  if (days < SIMPLE_INTEREST_BELOW_DAYS) {
    maturity = principal * (1 + (r * days) / 365);
    method = "simple";
  } else {
    const fullQuarters = Math.floor(days / DAYS_PER_QUARTER + 1e-9);
    const leftoverDays = Math.max(0, Math.round(days - fullQuarters * DAYS_PER_QUARTER));
    maturity = principal * Math.pow(1 + r / 4, fullQuarters) * (1 + (r * leftoverDays) / 365);
    method = "quarterly_compounding";
  }
  return {
    principal,
    maturity,
    interest: maturity - principal,
    method,
    effectiveAnnualYield: (Math.pow(1 + r / 4, 4) - 1) * 100,
  };
}

/**
 * Non-cumulative FD payouts. Quarterly payout = P × r / 4. Monthly payout is the
 * quarterly interest paid in three discounted monthly parts (IBA convention).
 */
export function fdPayout(principal: number, ratePct: number, frequency: "monthly" | "quarterly"): number {
  const quarterly = (principal * ratePct) / 400;
  if (frequency === "quarterly") return quarterly;
  const i = ratePct / 1200;
  // M + M(1+i) + M(1+i)^2 = quarterly interest  →  M = Q·i / ((1+i)^3 − 1)
  return (quarterly * i) / (Math.pow(1 + i, 3) - 1);
}

export interface RdResult {
  monthlyInstalment: number;
  months: number;
  deposited: number;
  maturity: number;
  interest: number;
}

/**
 * Recurring deposit maturity with quarterly compounding: each instalment compounds
 * for the number of quarters it stays invested (fractional quarters allowed), the
 * formula most Indian bank RD calculators use.
 */
export function rdMaturity(monthlyInstalment: number, ratePct: number, months: number): RdResult {
  if (monthlyInstalment <= 0 || months <= 0) throw new Error("instalment and months must be positive");
  const qRate = ratePct / 400;
  let maturity = 0;
  for (let k = 1; k <= months; k++) {
    const monthsInvested = months - k + 1;
    maturity += monthlyInstalment * Math.pow(1 + qRate, monthsInvested / 3);
  }
  const deposited = monthlyInstalment * months;
  return { monthlyInstalment, months, deposited, maturity, interest: maturity - deposited };
}

/** Interest rate that applies to a balance under the bank's slab method, as a blended % p.a. */
export function savingsBlendedRate(balance: number, slabs: SavingsSlab[], method: SlabMethod): number | null {
  if (balance <= 0 || slabs.length === 0) return null;
  const sorted = [...slabs].sort((a, b) => a.balanceMin - b.balanceMin);
  if (method === "incremental") {
    let interest = 0;
    for (const s of sorted) {
      const top = s.balanceMax === null ? balance : Math.min(balance, s.balanceMax);
      const slice = top - s.balanceMin;
      if (slice > 0) interest += (slice * s.rate) / 100;
    }
    return (interest / balance) * 100;
  }
  // "whole" (and "unknown", shown with a caveat): the slab containing the balance applies to all of it.
  const slab = sorted.find((s) => balance >= s.balanceMin && (s.balanceMax === null || balance < s.balanceMax));
  return slab ? slab.rate : null;
}

/**
 * One year of savings interest on a steady balance, credited `creditsPerYear` times
 * (quarterly by default; interest is computed on the daily balance, so a steady
 * balance gives the same result as the daily-product method).
 */
export function savingsYearInterest(
  balance: number,
  slabs: SavingsSlab[],
  method: SlabMethod,
  creditsPerYear = 4,
): number | null {
  let current = balance;
  for (let i = 0; i < creditsPerYear; i++) {
    const rate = savingsBlendedRate(current, slabs, method);
    if (rate === null) return null;
    current += (current * rate) / 100 / creditsPerYear;
  }
  return current - balance;
}

/** Real (inflation-adjusted) return using the Fisher relation: (1+n)/(1+i) − 1, in %. */
export function realRate(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
