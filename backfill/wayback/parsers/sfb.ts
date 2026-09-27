/**
 * Custom historical parsers for the eleven small finance banks and their predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/sfb.json.
 */
import { findEffectiveDate, parseRate } from "../../../collectors/src/parse/common";
import { extractTables, pageText } from "../../../collectors/src/parse/html-table";
import { parseTenure } from "../../../collectors/src/parse/tenure";
import type { GenericResult, HistoricalParser } from "../types";

/**
 * AU SFB's retail FD page (aubank.in/interest-rates/fixed-deposit-interest-rates and the older
 * aubank.in/interest-rates hub) prints two "general" columns per table -- a plain rate and its
 * "(Annualized)" derivative -- with headers like "Interest Rates" / "Interest Rates
 * (Annualized)" or "ROI" / "Annualized Rate". Both match generic-parse.ts's classifyColumn's
 * `/rate|%/` fallback and neither says "senior", so the generic reader emits two conflicting
 * "general" rows per tenure and the card gets rejected by validateCard ("two different rates
 * for the same slab"). This parser reads only the first (non-annualized) rate column and
 * ignores the annualized derivative.
 *
 * Which table to read: checked two captures 17 months apart (2023-12-23 and 2025-05-01, spanning
 * the page's own retail-ceiling change from <2cr to <3cr) and both have the exact same table
 * order: table 0 is the complete general cumulative retail table (all 11-12 tenure rows, 7 days
 * to 120 months); table 1 repeats a handful of the SAME tenure labels ("12 Months 1 Day to 15
 * Months" etc.) at DIFFERENT, higher rates under what reads as the identical heading -- most
 * likely an NRE-specific sub-table (NRE deposits have a 12-month floor, which matches exactly
 * where table 1 starts), but the page does not say so explicitly enough to be confident, so
 * rather than risk mislabelling table 1's rows as either "general" (creating the very conflict
 * this parser exists to avoid) or "nre" on a guess, table 1 is left unread; table 2 is
 * "Non-callable ... >=1 Crore" (a different, bigger-ticket product); table 3 is headed "Senior
 * Citizen" but its own column headers are actually the "Monthly Payout" variant for BOTH
 * residents and seniors -- i.e. a true "Senior Citizen" *cumulative* table matching table 0's
 * tenures was not found as its own <table> in either capture (the heading text exists on the
 * page; no table with matching data follows it). This parser therefore only ever reads table 0,
 * general customer only, and the resulting card notes both gaps rather than guessing.
 */
const auAnnualizedFd: HistoricalParser = (html: string): GenericResult => {
  const grids = extractTables(html);
  const skipped: string[] = [];
  const rows: GenericResult["rows"] = [];
  let tablesRead = 0;
  for (const g of grids.slice(0, 1)) {
    if (g.rows.length < 2) continue;
    const header = g.rows[0];
    if (!/tenure/i.test(header[0] ?? "")) continue;
    if (/senior|non-callable|monthly payout/i.test(header.join(" "))) continue; // extra safety net, see doc comment
    for (const r of g.rows.slice(1)) {
      const t = parseTenure(r[0] ?? "");
      if (!t) {
        skipped.push(`row "${r[0]}": tenure not read`);
        continue;
      }
      const rate = parseRate(r[1] ?? ""); // column 1 = plain rate; column 2 (if present) = "(Annualized)" derivative, ignored
      if (rate === null) continue;
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: 0,
        amountMax: null,
        customer: "general",
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
    tablesRead++;
  }
  if (rows.length < 3) skipped.push("fewer than 3 general rows recovered from tables 0-1");
  return { rows: rows.length >= 3 ? rows : [], effectiveFrom: findEffectiveDate(pageText(html)), tablesRead, skipped };
};

/**
 * Jana SFB's janabank.com/fixed-deposit/ page (2019-2020 layout) prints one table with THREE
 * customer/scheme groups side by side -- "FD Plus" (a different, no-premature-withdrawal
 * scheme, also covered by its own dedicated target), "Regular FD" and "Senior FD" -- each as a
 * "Rate" + "Yield"/"Interest Rate(Annualised)" column pair (6 data columns total). Every header
 * cell in every column contains the word "rate" (or is paired under one that does via the
 * two-row header), so generic-parse.ts's classifyColumn tags FOUR columns "general" (FD Plus
 * Rate, FD Plus Yield, Regular Rate, Regular Yield) and TWO "senior" (Senior Rate, Senior
 * Yield), and validateCard rejects every card outright. This parser reads the combined two-row
 * header text per column and keeps only the "Regular FD" rate column (-> general) and "Senior
 * FD" rate column (-> senior), explicitly skipping every "FD Plus" column (a different scheme)
 * and every "Yield"/"Annualised" column (a derivative of the rate already read).
 */
const janaRegularAnnualizedFd: HistoricalParser = (html: string): GenericResult => {
  const grids = extractTables(html);
  const skipped: string[] = [];
  const rows: GenericResult["rows"] = [];
  let tablesRead = 0;
  for (const g of grids) {
    if (g.rows.length < 4) continue;
    // Two header rows share one tenure column; combine them per-column like generic-parse.ts does.
    const width = Math.max(...g.rows.map((r) => r.length));
    const combined = Array.from({ length: width }, (_, c) => `${g.rows[0]?.[c] ?? ""} ${g.rows[1]?.[c] ?? ""}`.toLowerCase());
    if (!/tenor|tenure/.test(combined[0])) continue;
    const generalCol = combined.findIndex((h) => /regular/.test(h) && !/yield|annualis/.test(h));
    const seniorCol = combined.findIndex((h) => /senior/.test(h) && !/yield|annualis/.test(h));
    if (generalCol < 0 && seniorCol < 0) continue;
    for (const r of g.rows.slice(2)) {
      const t = parseTenure(r[0] ?? "");
      if (!t) {
        skipped.push(`row "${r[0]}": tenure not read`);
        continue;
      }
      const base = { tenureMinDays: t.minDays, tenureMaxDays: t.maxDays, tenureLabel: r[0], special: t.point && t.minDays % 365 !== 0 ? (true as const) : undefined, amountMin: 0, amountMax: null, residency: "resident" as const, callable: null, payout: null };
      const g1 = generalCol >= 0 ? parseRate(r[generalCol] ?? "") : null;
      const s1 = seniorCol >= 0 ? parseRate(r[seniorCol] ?? "") : null;
      if (g1 !== null) rows.push({ ...base, customer: "general", rate: g1 });
      if (s1 !== null) rows.push({ ...base, customer: "senior", rate: s1 });
    }
    tablesRead++;
    break; // the FD table is always the only/first one on this page across every capture checked
  }
  if (rows.length < 3) skipped.push("fewer than 3 rows recovered (Regular/Senior FD columns not found)");
  return { rows: rows.length >= 3 ? rows : [], effectiveFrom: findEffectiveDate(pageText(html)), tablesRead, skipped };
};

export const parsers: Record<string, HistoricalParser> = {
  "au-sfb/annualized-fd": auAnnualizedFd,
  "jana-sfb/regular-annualized-fd": janaRegularAnnualizedFd,
};

/** Re-exported so tests can call it directly without going through the registry/Target plumbing. */
export const _internal = { auAnnualizedFd, janaRegularAnnualizedFd };
