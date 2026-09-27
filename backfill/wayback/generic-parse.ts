/**
 * Generic reader for historical bank rate pages: finds tables whose first column holds
 * tenures and whose other columns hold rates, and maps "senior"/"general" columns when the
 * header says so. Anything it cannot read confidently is skipped (and reported) — never guessed.
 */
import type { CustomerType, Product, RateRow } from "../../lib/domain";
import { parseAmountBand } from "../../collectors/src/parse/amount";
import { findEffectiveDate, parseRate } from "../../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../../collectors/src/parse/html-table";
import { parseTenure } from "../../collectors/src/parse/tenure";
import type { GenericResult } from "./types";

export type { GenericResult } from "./types";

function classifyColumn(header: string): CustomerType | "skip" | "general_default" {
  const h = header.toLowerCase();
  if (/existing|old|previous|earlier/.test(h)) return "skip";
  // Derived figures printed next to the rate (annualised/effective yield, maturity value) are not rates.
  if (/yield|annuali[sz]ed|effective\s+(annual|yield|rate of return)|maturity value|amount on maturity/.test(h)) return "skip";
  if (/super\s*senior|80\s*years/.test(h)) return "super_senior";
  if (/senior|sr\.?\s*cit/.test(h)) return "senior";
  if (/staff|nri|nre|nro|fcnr|bulk|crore|non[- ]?callable/.test(h)) return "skip";
  if (/general|public|others|resident|rate|%|p\.a/.test(h)) return "general";
  return "general_default";
}

/**
 * The heading nearest a table: the text after the last rate-like number before it (so a previous
 * table's figures are left out), capped to its last 120 characters (so a site-wide menu such as
 * "Loans | NRIs" further up the page does not count).
 */
export function tableHeading(context: string): string {
  const lastRate = [...context.matchAll(/\d+(?:\.\d+)?\s*%/g)].at(-1);
  const tail = lastRate ? context.slice((lastRate.index ?? 0) + lastRate[0].length) : context;
  return tail.slice(-120).trim();
}

/** Words that mark a table as something other than the product's main card. */
const OTHER: Partial<Record<Product, RegExp>> = {
  fd: /mclr|marginal cost|lending|\bloans?\b|advances|\bb?plr\b|base rate|recurring|savings|\bs\.?b\.?\b|bulk|liquid|sweep|flexi|yield|non[- ]?callable|without premature|monthly|payout|staff|tax[- ]?sav/i,
  tax_saver: /mclr|lending|\bloans?\b|recurring|savings|bulk|yield|senior|staff/i,
  rd: /mclr|lending|\bloans?\b|savings|bulk|yield|senior|staff/i,
  fd_bulk: /mclr|lending|\bloans?\b|recurring|savings|yield|senior|staff/i,
  nre: /mclr|lending|\bloans?\b|recurring|savings|yield|senior/i,
  nro: /mclr|lending|\bloans?\b|recurring|savings|yield|senior/i,
};
/**
 * Wording that a combined table shares with its own general/domestic columns: non-resident and
 * senior citizen. It disqualifies a table only when the title does not also say domestic, resident,
 * general or public — "Domestic / Seniors / NRO Term Deposits" is one table with a senior column,
 * while "For Senior Citizen" alone is a senior-only table the generic reader must not read.
 */
const NON_RESIDENT = /\bnre\b|\bnro\b|\bnri\b|non[- ]?resident|fcnr|\brfc\b/i;
const SENIOR_ONLY = /senior/i;
const DOMESTIC = /domestic|(?<!non[- ]?)\bresident|general|public/i;
/** Words that positively identify the product's own table. */
const THIS: Partial<Record<Product, RegExp>> = {
  fd: /domestic|(?<!non[- ]?)\bresident|fixed deposit|term deposit|retail/i,
  tax_saver: /tax/i,
  rd: /recurring|\brd\b/i,
  fd_bulk: /bulk|crore/i,
  nre: /\bnre\b|non[- ]?resident \(?external/i,
  nro: /\bnro\b|non[- ]?resident ordinary/i,
};

/**
 * How strongly a table's title (the last 90 characters of its heading) says it is the product's
 * main card: +2 for the product's own words, -3 for another product, a lending table, a derived
 * yield, or a variant (senior-only, non-callable, monthly payout, staff, tax-saver). Non-resident
 * wording counts against domestic products only when the title does not also say domestic or
 * resident — "For Domestic & NRE/NRO Retail Fixed Deposits" is the domestic card. Tables scoring
 * below zero are refused rather than read as the wrong product.
 */
export function headingScore(heading: string, product: Product): number {
  const title = heading.slice(-90);
  let score = THIS[product]?.test(title) ? 2 : 0;
  const domesticProduct = product === "fd" || product === "rd" || product === "tax_saver" || product === "fd_bulk";
  const sharedWordHit = domesticProduct && (NON_RESIDENT.test(title) || SENIOR_ONLY.test(title)) && !DOMESTIC.test(title);
  if (OTHER[product]?.test(title) || sharedWordHit) score -= 3;
  return score;
}

export function readTermTables(html: string, opts: { amountMax: number | null; product?: Product } = { amountMax: null }): GenericResult {
  const product = opts.product ?? "fd";
  const grids = extractTables(html);
  const skipped: string[] = [];
  const candidates: Array<{ rows: RateRow[]; heading: string; score: number; order: number }> = [];
  for (const g of grids) {
    const heading = tableHeading(g.context);
    const score = headingScore(heading, product);
    if (score < 0) {
      skipped.push(`table ${g.index}: heading "${heading.slice(-60)}" looks like another product (score ${score})`);
      continue;
    }
    const r = readGrid(g, opts.amountMax);
    if (r.ok) candidates.push({ rows: r.rows, heading, score, order: candidates.length });
    else if (r.reason) skipped.push(r.reason);
  }
  // Best-labelled table first; among equals, the earliest (on nearly all old pages the domestic
  // retail card comes first).
  const chosen = [...candidates].sort((a, b) => b.score - a.score || a.order - b.order)[0];
  return {
    rows: chosen?.rows ?? [],
    effectiveFrom: findEffectiveDate(pageText(html)),
    tablesRead: chosen ? 1 : 0,
    skipped,
    context: chosen?.heading,
  };
}

function readGrid(g: Grid, amountMax: number | null): { ok: boolean; rows: RateRow[]; reason?: string } {
  if (g.rows.length < 4) return { ok: false, rows: [] };
  // Header rows: leading rows without any rate-looking cell.
  let h = 0;
  while (h < Math.min(3, g.rows.length) && g.rows[h].slice(1).every((c) => parseRate(c) === null)) h++;
  if (h === 0) h = 1;
  const width = Math.max(...g.rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, c) => g.rows.slice(0, h).map((r) => r[c] ?? "").join(" "));
  const body = g.rows.slice(h);
  const tenureOk = body.filter((r) => parseTenure(r[0] ?? "") !== null).length;
  if (tenureOk < Math.max(3, body.length * 0.6)) return { ok: false, rows: [], reason: `table ${g.index}: first column is not tenures` };
  const cols = headers.map((hd, i) => ({ i, kind: i === 0 ? "skip" : classifyColumn(hd) }));
  const rateCols = cols.filter((c) => c.kind !== "skip");
  if (rateCols.length === 0) {
    const tiered = readAmountTiers(g.index, headers, body);
    return tiered ?? { ok: false, rows: [], reason: `table ${g.index}: no rate columns` };
  }
  // If no column is labelled, only accept a single rate column (assumed general) — otherwise ambiguous.
  const labelled = rateCols.filter((c) => c.kind !== "general_default");
  const use = labelled.length > 0 ? labelled : rateCols.length === 1 ? rateCols : [];
  if (use.length === 0) return { ok: false, rows: [], reason: `table ${g.index}: ${rateCols.length} unlabelled rate columns` };
  const rows: RateRow[] = [];
  for (const r of body) {
    const t = parseTenure(r[0] ?? "");
    if (!t) continue;
    for (const c of use) {
      const rate = parseRate(r[c.i] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: 0,
        amountMax,
        customer: (c.kind === "general_default" ? "general" : c.kind) as CustomerType,
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  return rows.length >= 3 ? { ok: true, rows } : { ok: false, rows: [], reason: `table ${g.index}: too few rates` };
}

/**
 * Tables whose rate columns are amount tiers ("Below Rs 15 lakh | Rs 15 lakh and above") rather
 * than customer types: every column header must parse as an amount band, and the bands must not
 * overlap. Rates are for general customers. Anything less clear is refused.
 */
function readAmountTiers(index: number, headers: string[], body: string[][]): { ok: boolean; rows: RateRow[]; reason?: string } | null {
  const tiers = headers
    .map((hd, i) => ({ i, hd, band: i === 0 ? null : parseAmountBand(hd) }))
    .filter((t) => t.i > 0 && headers[t.i].trim() !== "");
  if (tiers.length < 2 || tiers.some((t) => !t.band) || tiers.some((t) => /senior|staff|nre|nro|fcnr|yield|annuali/i.test(t.hd))) return null;
  const sorted = [...tiers].sort((a, b) => a.band!.min - b.band!.min);
  for (let k = 1; k < sorted.length; k++) if (sorted[k - 1].band!.max === null || sorted[k - 1].band!.max! > sorted[k].band!.min) return null;
  const rows: RateRow[] = [];
  for (const r of body) {
    const t = parseTenure(r[0] ?? "");
    if (!t) continue;
    for (const tier of tiers) {
      const rate = parseRate(r[tier.i] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: tier.band!.min,
        amountMax: tier.band!.max,
        customer: "general",
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  return rows.length >= 3 ? { ok: true, rows } : { ok: false, rows: [], reason: `table ${index}: too few rates in amount-tier table` };
}
