/**
 * Task `nps-nav`: refreshes the four SBI Pension Fund Tier-I sample NAV histories in
 * data/series/nps/ from the official NPS Trust "scheme-wise NAV report" endpoint, which
 * returns a scheme's full daily NAV history from inception as tab-separated text (mislabelled
 * as .xls). Querying by EITHER the pre- or post-1-April-2026 scheme code for the same
 * fund/category returns the same merged series (verified live on 2026-09-27: querying
 * SM001003 still returns today's rows under the new code SM001025) — so this task always
 * queries using the file's own first-recorded scheme code and simply appends whatever
 * dates are new, taking each row's own scheme_code as given (which is what makes the
 * 1 Apr 2026 switch fall out automatically, matching the existing files' convention).
 * See README.md.
 */
import type { MacroTaskContext, NpsRowsChange, TaskResult } from "./types";
import { readNpsCsv } from "./store";

export const NPS_TRUST_BASE = "https://npstrust.org.in/scheme-wise-nav-report-excel";

export const NPS_FILES: Array<{ file: string; pfm: string }> = [
  { file: "sbi_scheme_e_tieri.csv", pfm: "PFM001" },
  { file: "sbi_scheme_c_tieri.csv", pfm: "PFM001" },
  { file: "sbi_scheme_g_tieri.csv", pfm: "PFM001" },
  { file: "sbi_scheme_a_tieri.csv", pfm: "PFM001" },
];

export interface NpsTsvRow {
  date: string;
  nav: string;
  scheme_code: string;
}

/** Parses the tab-separated "ID / DATE OF NAV / PFM ID / PFM NAME / SCHEME ID / SCHEME NAME / NAV VALUE" report. */
export function parseNpsTsv(text: string): NpsTsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date of nav");
  const schemeIdx = header.indexOf("scheme id");
  const navIdx = header.indexOf("nav value");
  if (dateIdx < 0 || schemeIdx < 0 || navIdx < 0) return [];
  const out: NpsTsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const date = cols[dateIdx]?.trim();
    const scheme_code = cols[schemeIdx]?.trim();
    const nav = cols[navIdx]?.trim();
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && scheme_code && nav && Number.isFinite(Number(nav))) out.push({ date, nav, scheme_code });
  }
  return out;
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "nps-nav", ok: false, sourcesTried: [], changes: [], warnings: [] };

  for (const { file, pfm } of NPS_FILES) {
    let existing;
    try {
      existing = readNpsCsv(ctx.root, file);
    } catch (e) {
      result.warnings.push(`${file}: could not read existing CSV (${(e as Error).message})`);
      continue;
    }
    const seedCode = existing.rows[0]?.scheme_code;
    if (!seedCode) {
      result.warnings.push(`${file}: no existing rows to seed a scheme code from.`);
      continue;
    }
    const url = `${NPS_TRUST_BASE}?navcatdataxls=${pfm}&navyearselxls=all&navsubdataxls=${seedCode}`;
    try {
      const doc = await ctx.fetch(url);
      result.sourcesTried.push({ url, ok: true, status: doc.status });
      result.ok = true;
      const rows = parseNpsTsv(doc.text);
      if (rows.length === 0) {
        result.warnings.push(`${file}: fetched ${url} but found zero parseable rows — the report format may have changed.`);
        continue;
      }
      const known = new Set(existing.rows.map((r) => r.date));
      const newRows = rows.filter((r) => !known.has(r.date));
      if (newRows.length === 0) continue;
      const schemeCodes = Array.from(new Set([...existing.rows.map((r) => r.scheme_code), ...rows.map((r) => r.scheme_code)]));
      const change: NpsRowsChange = {
        kind: "nps_rows",
        file,
        rows: newRows.map((r) => ({ date: r.date, nav: Number(r.nav), scheme_code: r.scheme_code })),
        schemeCodes,
        sourceUrl: url,
      };
      result.changes.push(change);
      result.usedSourceUrl = url;
    } catch (e) {
      result.sourcesTried.push({ url, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    }
  }
  if (!result.ok) result.error = "Every NPS Trust request failed this run.";
  return result;
}
