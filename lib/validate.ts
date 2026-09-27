/**
 * Plausibility checks applied to every rate card before it can replace the last good one.
 * The same checks run in the collectors (so a bad parse never leaves the runner) and again
 * in Convex (the final gate). A rejected card never overwrites data; the previous card stays
 * current and an alert is raised.
 */
import type { Product, RateCard, RateRow } from "./domain";

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export const RATE_MIN = 0.01; // % p.a.
export const RATE_MAX = 15; // % p.a. — no Indian bank deposit rate has come close in decades
export const TENURE_MAX_DAYS = 3660; // 10 years + leap days

/** Stable string for hashing: sorted rows with fixed key order. */
export function canonicalRows(card: Pick<RateCard, "rows" | "savingsSlabs" | "slabMethod">): string {
  const rows = [...card.rows]
    .map((r) => [r.tenureMinDays, r.tenureMaxDays, r.customer, r.residency, r.amountMin, r.amountMax, r.callable, r.payout ?? null, r.rate, r.schemeName ?? null])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const slabs = [...(card.savingsSlabs ?? [])]
    .map((s) => [s.balanceMin, s.balanceMax, s.residency, s.rate])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ rows, slabs, method: card.slabMethod ?? null });
}

function rowKey(r: RateRow): string {
  return [r.tenureMinDays, r.tenureMaxDays, r.customer, r.residency, r.amountMin, r.amountMax, r.callable, r.payout ?? null, r.schemeName ?? null].join("|");
}

export function validateCard(card: RateCard, previous?: Pick<RateCard, "rows" | "savingsSlabs"> | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) => issues.push({ level: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ level: "warning", code, message });

  const isSavings = card.product === ("savings" as Product);
  if (isSavings) {
    if (!card.savingsSlabs || card.savingsSlabs.length === 0) err("no_slabs", "savings card has no balance slabs");
  } else if (card.rows.length === 0) {
    err("no_rows", "rate card has no rows");
  }

  for (const r of card.rows) {
    if (!(r.rate >= RATE_MIN && r.rate <= RATE_MAX)) err("rate_range", `rate ${r.rate} outside ${RATE_MIN}–${RATE_MAX}% (${r.tenureLabel})`);
    if (!(r.tenureMinDays >= 1 && r.tenureMaxDays >= r.tenureMinDays && r.tenureMaxDays <= TENURE_MAX_DAYS)) {
      err("tenure_range", `invalid tenure ${r.tenureMinDays}–${r.tenureMaxDays} days (${r.tenureLabel})`);
    }
    if (r.amountMax !== null && r.amountMax <= r.amountMin) err("amount_range", `invalid amount band ${r.amountMin}–${r.amountMax}`);
  }
  for (const s of card.savingsSlabs ?? []) {
    if (!(s.rate >= 0 && s.rate <= RATE_MAX)) err("rate_range", `savings rate ${s.rate} outside 0–${RATE_MAX}%`);
    if (s.balanceMax !== null && s.balanceMax <= s.balanceMin) err("slab_range", `invalid slab ${s.balanceMin}–${s.balanceMax}`);
  }

  // Duplicate keys with different rates mean the parser mixed up columns.
  const seen = new Map<string, number>();
  for (const r of card.rows) {
    const k = rowKey(r);
    const prior = seen.get(k);
    if (prior !== undefined && prior !== r.rate) err("conflicting_rows", `two different rates for the same slab (${r.tenureLabel}, ${r.customer})`);
    seen.set(k, r.rate);
  }

  // Senior citizens should never get less than the general public for the same slab.
  const general = new Map(card.rows.filter((r) => r.customer === "general").map((r) => [`${r.tenureMinDays}|${r.tenureMaxDays}|${r.amountMin}|${r.residency}|${r.callable}`, r.rate]));
  for (const r of card.rows.filter((x) => x.customer === "senior")) {
    const g = general.get(`${r.tenureMinDays}|${r.tenureMaxDays}|${r.amountMin}|${r.residency}|${r.callable}`);
    if (g !== undefined && r.rate < g) warn("senior_below_general", `senior rate below general rate for ${r.tenureLabel}`);
  }

  if (previous && previous.rows.length > 0 && !isSavings) {
    // A sudden large drop in the number of rows usually means a partial page or a changed layout.
    if (card.rows.length < previous.rows.length * 0.5) {
      err("row_count_drop", `rows dropped from ${previous.rows.length} to ${card.rows.length}`);
    }
    // Rates rarely move more than 2 percentage points in one revision.
    const prevByKey = new Map(previous.rows.map((r) => [rowKey(r), r.rate]));
    const jumps = card.rows.filter((r) => {
      const p = prevByKey.get(rowKey(r));
      return p !== undefined && Math.abs(p - r.rate) > 2;
    });
    if (jumps.length > 0) err("rate_jump", `${jumps.length} slab(s) moved by more than 2 percentage points`);
  }
  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
