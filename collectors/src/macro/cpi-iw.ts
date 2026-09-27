/**
 * Task `cpi-iw`: CPI for Industrial Workers, All-India, base 2016=100, monthly.
 *
 * labourbureau.gov.in's own historical-table page ("allindiageneralindex-1") and its
 * press-note LISTING page are both stale by a year or more (verified live on 2026-09-27).
 * The Labour Bureau HOMEPAGE, however, embeds the latest two months' General Index in
 * plain server-rendered HTML (a small "CPI-IW [General Index]" widget) and links that
 * month's press-note PDF right next to it — this is fresh (confirmed showing Jul-2026 on
 * 2026-09-27, the month PIB/press mirrors also show) and needs no JS rendering. See
 * README.md for the fallback (press-note PDF) and known gaps.
 */
import * as cheerio from "cheerio";
import { cleanText } from "../parse/common";
import type { MacroTaskContext, SeriesPointChange, TaskResult } from "./types";
import { readSeriesFile } from "./store";

export const LABOUR_BUREAU_HOME_URL = "https://labourbureau.gov.in/";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Jul-2026" / "July-2026" -> "2026-07". */
export function parseMonthLabel(label: string): string | null {
  const m = /^([a-z]{3})[a-z]*-\s*(\d{4})$/i.exec(cleanText(label));
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

export interface CpiIwHomeReading {
  month: string; // YYYY-MM
  value: number;
  pressNoteUrl: string | null;
}

/**
 * Parses the "CPI-IW [General Index (Base Year 2016 = 100)]" widget on the Labour Bureau
 * homepage. The homepage renders a second, near-identical widget for CPI-AL/RL just below
 * it, reusing the exact same "cpiwDataAreaBox" class but with three columns (Month, AL
 * Index, RL Index) instead of two — so this scopes to the box whose own preceding `<h4>`
 * says "CPI-IW" (not "AL/RL") and additionally requires exactly two columns per row, so a
 * markup change to either widget fails closed (empty) rather than silently mixing series.
 */
export function parseLabourBureauHome(html: string): CpiIwHomeReading[] {
  const $ = cheerio.load(html);
  const out: CpiIwHomeReading[] = [];
  $(".cpiwDataAreaBox").each((_, boxEl) => {
    const box = $(boxEl);
    const heading = cleanText(box.closest(".cpiwDataArea").prevAll("h4").first().text());
    if (!/cpi-iw/i.test(heading) || /al\s*\/\s*rl/i.test(heading)) return; // the AL/RL widget, not this one
    box.find(".row").each((_, el) => {
      const cols = $(el).find(".col");
      if (cols.length !== 2) return;
      const month = parseMonthLabel($(cols[0]).text());
      const value = Number(cleanText($(cols[1]).text()));
      if (month && Number.isFinite(value) && value > 0) out.push({ month, value, pressNoteUrl: null });
    });
  });
  let pressNoteUrl: string | null = null;
  $("a[title]").each((_, el) => {
    const title = $(el).attr("title") ?? "";
    if (/press note cpi-?\s*iw for/i.test(title)) pressNoteUrl = $(el).attr("href") ?? null;
  });
  return out.map((r) => ({ ...r, pressNoteUrl }));
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "cpi-iw", ok: false, sourcesTried: [], changes: [], warnings: [] };
  const series = readSeriesFile(ctx.root, "cpi_iw_chained");
  if (!series) {
    result.error = "data/series/cpi_iw_chained.json not found";
    return result;
  }
  const known = new Set(series.points.map((p) => String(p[0])));

  try {
    const doc = await ctx.fetch(LABOUR_BUREAU_HOME_URL);
    result.sourcesTried.push({ url: LABOUR_BUREAU_HOME_URL, ok: true, status: doc.status });
    result.ok = true;
    const readings = parseLabourBureauHome(doc.text);
    if (readings.length === 0) result.warnings.push("Labour Bureau homepage widget not found or empty (page structure may have changed).");
    for (const r of readings) {
      if (known.has(r.month)) continue; // never overwrite; a same-month value mismatch would need a human-reviewed revision note
      const sourceUrl = r.pressNoteUrl ?? LABOUR_BUREAU_HOME_URL;
      const change: SeriesPointChange = {
        kind: "series_point",
        seriesKey: "cpi_iw_chained",
        target: "points",
        point: [r.month, r.value, r.value],
      };
      result.changes.push(change);
      result.usedSourceUrl = sourceUrl;
    }
  } catch (e) {
    result.sourcesTried.push({ url: LABOUR_BUREAU_HOME_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    result.error = `Labour Bureau homepage unreachable: ${(e as Error).message}`;
  }
  return result;
}
