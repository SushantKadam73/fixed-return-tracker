/**
 * Task `epf`: Employees' Provident Fund, declared once per financial year.
 * A CBT (Central Board of Trustees) *recommendation* (PIB, usually Feb-Mar) is NOT a
 * declaration — only the subsequent Finance Ministry ratification / EPFO circular
 * ("approval of the Central Government... to credit interest @ X% for the year YYYY-YY")
 * is. See README.md for the source order and known gaps.
 */
import type { MacroTaskContext, SchemePeriodChange, TaskResult } from "./types";
import { lastSchemePeriod } from "./store";
import { fyOf } from "./dates";

export const EPFO_CIRCULARS_URL = "https://www.epfindia.gov.in/site_docs/PDFs/Circulars";
export const PIB_LABOUR_MINISTRY_URL = "https://www.pib.gov.in/allRel.aspx?menuid=1&min=27";

export interface EpfSignal {
  fyStart: number; // e.g. 2025 for FY2025-26
  rate: number;
  kind: "declaration" | "recommendation";
}

const DECLARATION_WORDS = /credit\s*interest|approval of the central government|has been notified|declared? and (?:credited|notified)|rate of interest .* has been (?:fixed|declared)/i;
const RECOMMENDATION_WORDS = /\brecommend/i;

/** Extracts a (financial year, rate) signal from EPFO-circular or PIB-press-release text, and classifies it. */
export function parseEpfText(text: string): EpfSignal | null {
  const rateMatch = /(\d{1,2}\.\d{1,2})\s*%/.exec(text);
  const fyMatch = /(?:financial year|for the year|year)\s*(\d{4})[\s-]*(\d{2,4})/i.exec(text);
  if (!rateMatch || !fyMatch) return null;
  const fyStart = Number(fyMatch[1]);
  const rate = Number(rateMatch[1]);
  const kind: EpfSignal["kind"] = DECLARATION_WORDS.test(text) && !/would be officially notified/i.test(text) ? "declaration" : RECOMMENDATION_WORDS.test(text) ? "recommendation" : "declaration";
  return { fyStart, rate, kind };
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "epf", ok: false, sourcesTried: [], changes: [], warnings: [] };
  const last = lastSchemePeriod(ctx.root, "epf");
  if (!last) {
    result.error = "data/schemes/epf.json has no periods";
    return result;
  }
  const lastFyStart = fyOf(last.effectiveFrom).startYear;

  const candidates = [EPFO_CIRCULARS_URL, PIB_LABOUR_MINISTRY_URL];
  let signal: EpfSignal | null = null;
  let usedUrl: string | undefined;
  for (const url of candidates) {
    try {
      const doc = await ctx.fetch(url);
      result.sourcesTried.push({ url, ok: true, status: doc.status });
      result.ok = true;
      const s = parseEpfText(doc.text);
      if (s && s.fyStart > lastFyStart) {
        signal = s;
        usedUrl = url;
        break;
      }
    } catch (e) {
      result.sourcesTried.push({ url, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    }
  }

  if (!signal) {
    if (!result.ok) result.error = "EPFO circulars and PIB were both unreachable this run.";
    else result.warnings.push("No newer financial year's EPF rate found this run.");
    return result;
  }
  if (signal.kind === "recommendation") {
    result.ok = true;
    result.warnings.push(`CBT recommended ${signal.rate}% for FY${signal.fyStart}-${String((signal.fyStart + 1) % 100).padStart(2, "0")} (${usedUrl}) — recorded as a note only; not a declaration, so no period was appended.`);
    return result;
  }

  const fy = { start: `${signal.fyStart}-04-01`, end: `${signal.fyStart + 1}-03-31` };
  const change: SchemePeriodChange = {
    kind: "scheme_period",
    scheme: "epf",
    period: {
      effectiveFrom: fy.start,
      effectiveTo: fy.end,
      rate: signal.rate,
      note: `Declared/credited for FY${signal.fyStart}-${String((signal.fyStart + 1) % 100).padStart(2, "0")} (${usedUrl}).`,
      sourceUrl: usedUrl!,
      evidence: "primary",
      crossCheckUrl: null,
    },
  };
  result.changes.push(change);
  result.usedSourceUrl = usedUrl;
  return result;
}
