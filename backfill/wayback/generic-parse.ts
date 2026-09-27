/**
 * Generic reader for historical bank rate pages: finds tables whose first column holds
 * tenures and whose other columns hold rates, and maps "senior"/"general" columns when the
 * header says so. Anything it cannot read confidently is skipped (and reported) — never guessed.
 */
import type { CustomerType, RateRow } from "../../lib/domain";
import { findEffectiveDate, parseRate } from "../../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../../collectors/src/parse/html-table";
import { parseTenure } from "../../collectors/src/parse/tenure";

export interface GenericResult {
  rows: RateRow[];
  effectiveFrom: string | null;
  tablesRead: number;
  skipped: string[];
}

function classifyColumn(header: string): CustomerType | "skip" | "general_default" {
  const h = header.toLowerCase();
  if (/existing|old|previous|earlier/.test(h)) return "skip";
  if (/super\s*senior|80\s*years/.test(h)) return "super_senior";
  if (/senior|sr\.?\s*cit/.test(h)) return "senior";
  if (/staff|nri|nre|nro|fcnr|bulk|crore|non[- ]?callable/.test(h)) return "skip";
  if (/general|public|others|resident|rate|%|p\.a/.test(h)) return "general";
  return "general_default";
}

export function readTermTables(html: string, opts: { amountMax: number | null } = { amountMax: null }): GenericResult {
  const grids = extractTables(html);
  const skipped: string[] = [];
  const rows: RateRow[] = [];
  let tablesRead = 0;
  for (const g of grids) {
    const r = readGrid(g, opts.amountMax);
    if (r.ok) {
      rows.push(...r.rows);
      tablesRead++;
    } else if (r.reason) skipped.push(r.reason);
    if (tablesRead >= 1) break; // first matching table = the domestic retail card on nearly all old pages
  }
  return { rows, effectiveFrom: findEffectiveDate(pageText(html)), tablesRead, skipped };
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
  if (rateCols.length === 0) return { ok: false, rows: [], reason: `table ${g.index}: no rate columns` };
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
