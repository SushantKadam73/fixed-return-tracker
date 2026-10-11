/**
 * Task `rbi-rates`: RBI policy rates (Repo, SDF, MSF, Bank Rate, CRR, SLR) plus the
 * INR/USD reference rate, parsed straight from the "Current Rates" box on
 * https://www.rbi.org.in/ — a plain server-rendered accordion (no JS needed), bounded
 * by `<!-- CURRENT RATES START/END -->` HTML comments so the parser is unaffected by
 * unrelated homepage redesigns elsewhere on the page. See README.md.
 */
import { extractTables } from "../parse/html-table";
import { parseDate, cleanText } from "../parse/common";
import type { MacroTaskContext, MacroObservationChange, TaskResult } from "./types";
import { readSeriesFile } from "./store";

export const RBI_HOME_URL = "https://www.rbi.org.in/";

export type RbiRateKey = "repo" | "reverse_repo" | "sdf" | "msf" | "bank_rate" | "crr" | "slr" | "usdinr";

export const SERIES_FOR: Record<Exclude<RbiRateKey, "usdinr">, string> = {
  repo: "rbi_repo_rate",
  reverse_repo: "rbi_reverse_repo_rate",
  sdf: "rbi_sdf_rate",
  msf: "rbi_msf_rate",
  bank_rate: "rbi_bank_rate",
  crr: "rbi_crr",
  slr: "rbi_slr",
};

const LABELS: Array<[RegExp, RbiRateKey]> = [
  [/policy\s*repo\s*rate/i, "repo"],
  [/reverse\s*repo\s*rate/i, "reverse_repo"],
  [/standing\s*deposit\s*facility/i, "sdf"],
  [/marginal\s*standing\s*facility/i, "msf"],
  [/^bank\s*rate$/i, "bank_rate"],
  [/^crr$/i, "crr"],
  [/^slr$/i, "slr"],
  [/inr\s*\/\s*1\s*usd/i, "usdinr"],
];

function extractNumber(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(text.replace(/,/g, ""));
  return m ? Number(m[1]) : null;
}

export interface RbiCurrentRates {
  asAt: string | null;
  values: Partial<Record<RbiRateKey, number>>;
}

/** Parses the RBI homepage's "Current Rates" box (works on the full page or just that box). */
export function parseRbiCurrentRates(html: string): RbiCurrentRates {
  const start = html.indexOf("CURRENT RATES START");
  const end = html.indexOf("CURRENT RATES END");
  const box = start >= 0 && end > start ? html.slice(start, end) : html;

  const values: Partial<Record<RbiRateKey, number>> = {};
  for (const grid of extractTables(box)) {
    for (const row of grid.rows) {
      const label = cleanText(row[0] ?? "");
      const rest = row.slice(1).join(" ");
      for (const [re, key] of LABELS) {
        if (re.test(label) && values[key] === undefined) {
          const n = extractNumber(rest);
          if (n !== null) values[key] = n;
        }
      }
    }
  }

  let asAt: string | null = null;
  const m = /as\s*at\s*[\d.:]+\s*[ap]m\s*of\s*([a-z]+\s+\d{1,2},?\s*\d{4})/i.exec(box);
  if (m) asAt = parseDate(m[1]);
  return { asAt, values };
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "rbi-rates", ok: false, sourcesTried: [], changes: [], warnings: [] };
  try {
    const doc = await ctx.fetch(RBI_HOME_URL);
    result.sourcesTried.push({ url: RBI_HOME_URL, ok: true, status: doc.status });
    const { asAt, values } = parseRbiCurrentRates(doc.text);
    const required = ["repo", "sdf", "msf", "bank_rate", "crr", "slr"] as const;
    const missing = required.filter((key) => values[key] === undefined);
    if (missing.length) throw new Error(`Incomplete RBI rate box: missing ${missing.join(", ")}`);
    if (required.some((key) => !Number.isFinite(values[key]) || values[key]! < 0 || values[key]! > 40)) throw new Error("Implausible RBI policy value");
    result.ok = true;
    result.usedSourceUrl = RBI_HOME_URL;
    if (values.usdinr !== undefined) result.warnings.push(`INR/USD reference on the homepage: ${values.usdinr} (as at ${asAt ?? "unknown date"}); no daily USD/INR series file exists in data/series to append to (usdinr_annual.json is a fiscal-year average) — reported for visibility only.`);

    for (const key of Object.keys(SERIES_FOR) as Array<keyof typeof SERIES_FOR>) {
      const value = values[key];
      if (value === undefined) {
        result.warnings.push(`Could not find "${key}" in the Current Rates box.`);
        continue;
      }
      const seriesKey = SERIES_FOR[key];
      const series = readSeriesFile(ctx.root, seriesKey);
      if (!series) {
        result.warnings.push(`data/series/${seriesKey}.json not found.`);
        continue;
      }
      // Homepage timestamps are observation dates, not evidence of a policy's effective date.
      const change: MacroObservationChange = { kind: "macro_observation", seriesKey, value, observedAt: ctx.today, sourceAsAt: asAt, sourceUrl: RBI_HOME_URL, effectiveFrom: null };
      result.changes.push(change);
    }
  } catch (e) {
    result.sourcesTried.push({ url: RBI_HOME_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    result.ok = false;
    result.changes = [];
    result.error = `RBI collection failed: ${(e as Error).message}`;
  }
  return result;
}
