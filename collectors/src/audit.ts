/**
 * Cross-bank sanity audit of the current live rate cards (a review aid, not a gate — the
 * collector's validation already rejects hard errors). Flags things a single adapter test
 * would not catch:
 *   - tenure holes in the retail card (a stretch of days no row covers)
 *   - overlapping rows with the same conditions but different rates
 *   - amount bands that leave a gap (e.g. max ₹2,99,99,999 then min ₹3,00,00,001)
 *   - senior rate below the general rate for the same tenure and band
 *   - rates outside a plausible range for the product
 *   - effective dates older than 18 months (possibly a stale page)
 *   - banks with no live FD or savings card
 *
 *   npx tsx collectors/src/audit.ts [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Product, RateRow } from "../../lib/domain";
import { todayIST } from "../../lib/format";
import type { StoredCard } from "../../lib/summary-build";
import { allProductFiles } from "./store";

type Finding = { bank: string; product: Product | "-"; kind: string; detail: string };

const PLAUSIBLE: Partial<Record<Product, [number, number]>> = { fd: [2.5, 9.75], rd: [2.5, 9.75], fd_bulk: [2.0, 9.5], tax_saver: [4, 9.5], nre: [2.5, 9.75], nro: [2.5, 9.75] };

const condKey = (r: RateRow) => `${r.customer}|${r.residency}|${r.callable}|${r.payout}|${r.amountMin}|${r.amountMax}`;

function tenureHoles(rows: RateRow[]): string[] {
  // Retail view: general, resident, lowest amount band, callable or unspecified, standard payout.
  // Special single tenures (e.g. 444 days) count as covering their day.
  const base = rows.filter((r) => r.customer === "general" && r.residency === "resident" && r.callable !== false && (r.payout === null || r.payout === "cumulative" || r.payout === "quarterly"));
  if (base.length === 0) return [];
  const minAmt = Math.min(...base.map((r) => r.amountMin));
  const band = base.filter((r) => r.amountMin === minAmt).sort((a, b) => a.tenureMinDays - b.tenureMinDays);
  const holes: string[] = [];
  let reach = band[0].tenureMaxDays;
  for (const r of band.slice(1)) {
    if (r.tenureMinDays > reach + 1) holes.push(`${reach + 1}–${r.tenureMinDays - 1} days`);
    reach = Math.max(reach, r.tenureMaxDays);
  }
  return holes;
}

function overlaps(rows: RateRow[]): string[] {
  const out: string[] = [];
  const groups = new Map<string, RateRow[]>();
  for (const r of rows) groups.set(condKey(r), [...(groups.get(condKey(r)) ?? []), r]);
  for (const [k, g] of groups) {
    const s = [...g].sort((a, b) => a.tenureMinDays - b.tenureMinDays);
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length && s[j].tenureMinDays <= s[i].tenureMaxDays; j++) {
        const a = s[i];
        const b = s[j];
        // A special single-day tenure inside a range is normal (e.g. 444 days within 1–2 years).
        if (a.special || b.special || a.tenureMinDays === a.tenureMaxDays || b.tenureMinDays === b.tenureMaxDays) continue;
        if (a.rate !== b.rate && (a.schemeName ?? "") === (b.schemeName ?? "")) out.push(`${a.tenureLabel} (${a.rate}) overlaps ${b.tenureLabel} (${b.rate}) [${k}]`);
      }
  }
  return out.slice(0, 5);
}

function amountGaps(rows: RateRow[]): string[] {
  const out = new Set<string>();
  const byTenure = new Map<string, RateRow[]>();
  for (const r of rows) {
    const k = `${r.tenureMinDays}-${r.tenureMaxDays}|${r.customer}|${r.residency}|${r.callable}`;
    byTenure.set(k, [...(byTenure.get(k) ?? []), r]);
  }
  for (const g of byTenure.values()) {
    const s = [...g].sort((a, b) => a.amountMin - b.amountMin);
    for (let i = 0; i + 1 < s.length; i++) {
      const max = s[i].amountMax;
      const nextMin = s[i + 1].amountMin;
      if (max !== null && nextMin > max && nextMin - max <= 1000) out.add(`gap between ${max} and ${nextMin} (${s[i].tenureLabel})`);
    }
  }
  return [...out].slice(0, 3);
}

function seniorBelowGeneral(rows: RateRow[]): string[] {
  const out: string[] = [];
  const gen = rows.filter((r) => r.customer === "general");
  for (const s of rows.filter((r) => r.customer === "senior")) {
    const g = gen.find(
      (r) =>
        r.tenureMinDays === s.tenureMinDays &&
        r.tenureMaxDays === s.tenureMaxDays &&
        r.amountMin === s.amountMin &&
        r.residency === s.residency &&
        r.callable === s.callable &&
        r.payout === s.payout &&
        (r.schemeName ?? "") === (s.schemeName ?? ""),
    );
    if (g && s.rate < g.rate) out.push(`${s.tenureLabel}: senior ${s.rate} < general ${g.rate}`);
  }
  return out.slice(0, 3);
}

export function audit(root: string): Finding[] {
  const today = todayIST();
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 548 * 86_400_000).toISOString().slice(0, 10);
  const master = JSON.parse(readFileSync(path.join(root, "data", "banks", "banks.json"), "utf8")) as { banks: Array<{ slug: string; group: string; tracking: string }> };
  const tracked = master.banks.filter((b) => b.group !== "payments" && b.tracking !== "deferred").map((b) => b.slug);
  const findings: Finding[] = [];
  const live = new Map<string, Map<Product, StoredCard>>();
  for (const pf of allProductFiles(root)) {
    const cur = pf.cards.filter((c) => c.sourceType === "bank_official").at(-1);
    if (!cur) continue;
    live.set(pf.bankSlug, (live.get(pf.bankSlug) ?? new Map()).set(pf.product, cur));
  }
  for (const bank of tracked) {
    const products = live.get(bank);
    if (!products?.has("fd")) findings.push({ bank, product: "-", kind: "missing", detail: "no live FD card yet" });
    if (!products?.has("savings")) findings.push({ bank, product: "-", kind: "missing", detail: "no live savings card yet" });
    for (const [product, c] of products ?? []) {
      if (c.effectiveFrom && c.effectiveFrom < cutoff) findings.push({ bank, product, kind: "old-effective-date", detail: `effective ${c.effectiveFrom}` });
      if (product === "savings") {
        for (const s of c.savingsSlabs ?? []) if (s.rate < 1.5 || s.rate > 8.5) findings.push({ bank, product, kind: "implausible-rate", detail: `slab from ${s.balanceMin}: ${s.rate}%` });
        continue;
      }
      const range = PLAUSIBLE[product];
      if (range) for (const r of c.rows) if (r.rate < range[0] || r.rate > range[1]) findings.push({ bank, product, kind: "implausible-rate", detail: `${r.tenureLabel} ${r.customer}: ${r.rate}%` });
      // RD schedules often list fixed month terms (6, 9, 12 months...), so holes are only checked for FDs.
      if (product === "fd") for (const h of tenureHoles(c.rows)) findings.push({ bank, product, kind: "tenure-hole", detail: h });
      for (const o of overlaps(c.rows)) findings.push({ bank, product, kind: "overlap", detail: o });
      for (const g of amountGaps(c.rows)) findings.push({ bank, product, kind: "amount-gap", detail: g });
      for (const s of seniorBelowGeneral(c.rows)) findings.push({ bank, product, kind: "senior-below-general", detail: s });
    }
  }
  return findings;
}

if (process.argv[1] && /audit\.ts$/.test(process.argv[1])) {
  const root = process.cwd();
  const f = audit(root);
  const byKind = f.reduce<Record<string, number>>((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {});
  for (const x of f) console.log(`${x.kind.padEnd(22)} ${x.bank.padEnd(26)} ${String(x.product).padEnd(9)} ${x.detail}`);
  console.log(JSON.stringify(byKind));
  const i = process.argv.indexOf("--json");
  if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(f, null, 1));
}
