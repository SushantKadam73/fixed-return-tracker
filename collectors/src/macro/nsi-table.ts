/**
 * Parses the National Savings Institute "Interest Rate on National Savings Schemes"
 * master table (nsiindia.gov.in, Id_Pk=132) — one page listing every small-savings
 * scheme's rate for every quarter, grouped in blocks of one-or-more fiscal years.
 *
 * nsiindia.gov.in returns HTTP 502 on every attempt — verified independently of this
 * codebase with a direct curl, so it's a genuine outage, not a sandbox-specific block (see
 * collectors/README.md's "Macro collectors" section); this parser was built and is tested against a
 * fixture whose cell VALUES are genuine — read live from Exa's cache of the official
 * page on 2026-09-27 — reconstructed into the most plausible real markup (a label
 * column + an FY header row + a quarter-name header row + one row per scheme, with the
 * FY header cell colspan="4" across its four quarters). If the live page's actual HTML
 * differs from that shape, `parseNsiMasterTable` returns an empty array (a safe no-op,
 * never a guess) rather than mis-parsing it — see the README's "known gaps" section.
 */
import { extractTables } from "../parse/html-table";
import { parseRate } from "../parse/common";
import { parseFyLabel, quarterNameToRange, type QuarterName } from "./dates";

export type SmallSavingsScheme = "po_sb" | "po_td_1y" | "po_td_2y" | "po_td_3y" | "po_td_5y" | "po_rd" | "scss" | "pomis" | "nsc" | "ppf" | "ssy" | "kvp";

const SCHEME_PATTERNS: Array<[RegExp, SmallSavingsScheme]> = [
  [/senior\s*citizens?/i, "scss"], // NSI: "Senior Citizens Savings Scheme"; India Post: "Senior Citizen Savings Scheme" (singular)
  [/recurring\s*deposit/i, "po_rd"],
  [/monthly\s*income/i, "pomis"],
  [/national\s*savings\s*certificate/i, "nsc"],
  [/public\s*provident\s*fund/i, "ppf"],
  [/sukanya\s*samriddhi/i, "ssy"],
  [/kisan\s*vikas\s*patra/i, "kvp"],
  [/^1\s*year\s*time\s*deposit/i, "po_td_1y"],
  [/^2\s*year\s*time\s*deposit/i, "po_td_2y"],
  [/^3\s*year\s*time\s*deposit/i, "po_td_3y"],
  [/^5\s*year\s*time\s*deposit/i, "po_td_5y"],
  [/savings\s*account|savings\s*deposit/i, "po_sb"],
];

export function matchSchemeKey(label: string): SmallSavingsScheme | null {
  for (const [re, key] of SCHEME_PATTERNS) if (re.test(label)) return key;
  return null;
}

export interface NsiQuarterRate {
  scheme: SmallSavingsScheme;
  start: string;
  end: string;
  quarter: QuarterName;
  rate: number | null;
  maturityMonths: number | null;
  raw: string;
}

function parseRateCell(text: string): { rate: number | null; maturityMonths: number | null } {
  const t = text.trim();
  if (!t) return { rate: null, maturityMonths: null };
  const rate = parseRate(t.split("(")[0]);
  const m = /mature\s*in\s*(\d+)\s*months?/i.exec(t);
  return { rate, maturityMonths: m ? Number(m[1]) : null };
}

function looksLikeFyHeader(row: string[]): boolean {
  const cells = row.slice(1).filter((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /\d{4}/.test(c));
}

function looksLikeQuarterHeader(row: string[]): boolean {
  const cells = row.slice(1).filter((c) => c.trim());
  return cells.length >= 2 && cells.filter((c) => /april|july|oct|jan/i.test(c)).length >= 2;
}

export function parseNsiMasterTable(html: string): NsiQuarterRate[] {
  const out: NsiQuarterRate[] = [];
  for (const grid of extractTables(html)) {
    const { rows } = grid;
    if (rows.length < 3 || !looksLikeFyHeader(rows[0]) || !looksLikeQuarterHeader(rows[1])) continue;
    const colRange = new Map<number, { start: string; end: string; name: QuarterName }>();
    for (let c = 1; c < rows[1].length; c++) {
      const fy = parseFyLabel(rows[0][c] ?? "");
      if (!fy) continue;
      const range = quarterNameToRange(rows[1][c] ?? "", fy.startYear);
      if (range) colRange.set(c, range);
    }
    for (let r = 2; r < rows.length; r++) {
      const scheme = matchSchemeKey(rows[r][0] ?? "");
      if (!scheme) continue;
      for (const [c, range] of colRange) {
        const cell = rows[r][c] ?? "";
        if (!cell.trim()) continue;
        const { rate, maturityMonths } = parseRateCell(cell);
        out.push({ scheme, start: range.start, end: range.end, quarter: range.name, rate, maturityMonths, raw: cell });
      }
    }
  }
  return out;
}
