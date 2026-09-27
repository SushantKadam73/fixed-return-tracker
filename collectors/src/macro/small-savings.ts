/**
 * Task `small-savings`: PPF, SSY, SCSS, NSC, KVP, POMIS, PO TD 1/2/3/5y, PO RD, PO SB.
 * All eleven schemes are reset together, once a quarter, by a single DEA Office
 * Memorandum; see README.md for the source priority order and known gaps.
 */
import { extractTables } from "../parse/html-table";
import { parseDate, parseRate } from "../parse/common";
import type { MacroTaskContext, SchemePeriodChange, TaskResult } from "./types";
import { lastSchemePeriod } from "./store";
import { daysBetween, nextQuarter, quarterOf } from "./dates";
import { matchSchemeKey, parseNsiMasterTable, type SmallSavingsScheme } from "./nsi-table";

export const NSI_URL = "https://www.nsiindia.gov.in/InternalPage.aspx?Id_Pk=132";
export const DEA_LISTING_URL = "https://dea.gov.in/budget-division/475";
export const INDIA_POST_URL = "https://indiapost.gov.in/Financial/pages/content/post-office-saving-schemes.aspx";

export const SCHEMES: SmallSavingsScheme[] = ["ppf", "ssy", "scss", "nsc", "kvp", "pomis", "po_td_1y", "po_td_2y", "po_td_3y", "po_td_5y", "po_rd", "po_sb"];

/**
 * DEA notifies a new quarter's rates a few days before it takes effect (documented pattern:
 * the Oct-Dec quarter is notified around 30 September) — start checking this many days ahead
 * of the quarter's start so a pre-announcement is picked up the day it is published rather
 * than only once the quarter has actually begun. Kept short (not e.g. a month) so a quiet run
 * this many-plus days out still costs zero requests, matching the observed announcement lag.
 */
export const PRE_ANNOUNCEMENT_WINDOW_DAYS = 3;

/** DEA/India-Post office memoranda say this verbatim (with OCR noise) when a quarter's rates carry over unchanged. */
export function isUnchangedNotice(text: string): boolean {
  return /remain(?:s|ed)?\s*unchanged/i.test(text);
}

function noteFor(quarter: ReturnType<typeof quarterOf>, sourceLabel: string, unchanged: boolean): string {
  const fyLabel = quarter.fyStartYear + 1 <= 99 ? `${quarter.fyStartYear}-${String((quarter.fyStartYear + 1) % 100).padStart(2, "0")}` : String(quarter.fyStartYear);
  return `${quarter.name} FY${fyLabel}${unchanged ? " — confirmed unchanged from the previous quarter" : ""} (${sourceLabel}).`;
}

/** India Post's "Interest rates (New)" table: one row per scheme, ONE rate column whose header states the w.e.f date range. */
export function parseIndiaPostRateTable(html: string): { start: string; end: string; rates: Array<{ scheme: SmallSavingsScheme; rate: number | null; maturityMonths: number | null }> } | null {
  for (const grid of extractTables(html)) {
    const header = grid.rows[0]?.join(" ") ?? "";
    if (!/rate of interest/i.test(header)) continue;
    const m = /w\.?\s?e\.?\s?f\.?\s*([\d./-]{6,10})\s*to\s*([\d./-]{6,10})/i.exec(header);
    if (!m) continue;
    const start = parseDate(m[1]);
    const end = parseDate(m[2]);
    if (!start || !end) continue;
    const rates: Array<{ scheme: SmallSavingsScheme; rate: number | null; maturityMonths: number | null }> = [];
    for (const row of grid.rows.slice(1)) {
      const scheme = matchSchemeKey(row[1] ?? row[0] ?? "");
      if (!scheme) continue;
      const cell = row[2] ?? "";
      const rate = parseRate(cell.split("(")[0]);
      const mm = /mature\s*in\s*(\d+)\s*months?/i.exec(cell);
      rates.push({ scheme, rate, maturityMonths: mm ? Number(mm[1]) : null });
    }
    if (rates.length > 0) return { start, end, rates };
  }
  return null;
}

/** Finds the newest-dated anchor to a PDF whose link text mentions small savings / national savings on the DEA listing page. */
export function findLatestOmLink(html: string): string | null {
  const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]*)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    if (/small\s*savings|national\s*savings/i.test(m[2])) return m[1];
  }
  return null;
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "small-savings", ok: false, sourcesTried: [], changes: [], warnings: [] };

  const last = lastSchemePeriod(ctx.root, "ppf");
  if (!last) {
    result.error = "data/schemes/ppf.json has no periods to anchor the quarter clock on";
    return result;
  }
  const target = nextQuarter(quarterOf(last.effectiveTo ?? last.effectiveFrom));
  if (daysBetween(ctx.today, target.start) > PRE_ANNOUNCEMENT_WINDOW_DAYS) {
    result.ok = true;
    result.warnings.push(`Next quarter (${target.start} to ${target.end}) has not started yet as of ${ctx.today}; nothing to check.`);
    return result;
  }

  const perScheme = new Map<SmallSavingsScheme, { rate: number | null; maturityMonths: number | null }>();
  let usedUrl: string | undefined;
  const evidence = "primary" as const;

  // 1. NSI master table — every scheme, every quarter, one page.
  try {
    const doc = await ctx.fetch(NSI_URL);
    result.sourcesTried.push({ url: NSI_URL, ok: true, status: doc.status });
    result.ok = true;
    const rows = parseNsiMasterTable(doc.text).filter((r) => r.start === target.start);
    for (const r of rows) perScheme.set(r.scheme, { rate: r.rate, maturityMonths: r.maturityMonths });
    if (rows.length > 0) usedUrl = NSI_URL;
  } catch (e) {
    result.sourcesTried.push({ url: NSI_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
  }

  // 2. DEA office memorandum listing — authoritative, but usually just confirms "unchanged".
  if (perScheme.size < SCHEMES.length) {
    try {
      const listing = await ctx.fetch(DEA_LISTING_URL);
      result.sourcesTried.push({ url: DEA_LISTING_URL, ok: true, status: listing.status });
      result.ok = true;
      const omUrl = findLatestOmLink(listing.text);
      if (omUrl) {
        const om = await ctx.fetch(omUrl, "pdf");
        result.sourcesTried.push({ url: omUrl, ok: true, status: om.status });
        if (isUnchangedNotice(om.text)) {
          for (const scheme of SCHEMES) {
            if (perScheme.has(scheme)) continue;
            const lastP = lastSchemePeriod(ctx.root, scheme);
            if (!lastP) continue;
            const carriedMonths = /doubling period\s*(\d+)\s*months/i.exec(lastP.note ?? "")?.[1];
            perScheme.set(scheme, { rate: lastP.rate, maturityMonths: carriedMonths ? Number(carriedMonths) : null });
          }
          if (!usedUrl) usedUrl = omUrl;
        } else {
          result.warnings.push(`DEA OM (${omUrl}) does not read as an "unchanged" notice; a rate change may be in effect but this task cannot yet parse a changed table from free PDF text — add rows manually and file a gap.`);
        }
      } else {
        result.warnings.push("Could not find a Small Savings OM link on the DEA listing page.");
      }
    } catch (e) {
      result.sourcesTried.push({ url: DEA_LISTING_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    }
  }

  // 3. India Post's own current-rates page (known to lag; last resort).
  if (perScheme.size < SCHEMES.length) {
    try {
      const doc = await ctx.fetch(INDIA_POST_URL);
      result.sourcesTried.push({ url: INDIA_POST_URL, ok: true, status: doc.status });
      result.ok = true;
      const parsed = parseIndiaPostRateTable(doc.text);
      if (parsed && parsed.start === target.start) {
        for (const r of parsed.rates) if (!perScheme.has(r.scheme)) perScheme.set(r.scheme, { rate: r.rate, maturityMonths: r.maturityMonths });
        if (!usedUrl) usedUrl = INDIA_POST_URL;
      }
    } catch (e) {
      result.sourcesTried.push({ url: INDIA_POST_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    }
  }

  if (perScheme.size === 0) {
    if (!result.ok) result.error = "Every source (NSI, DEA, India Post) failed to fetch.";
    else result.warnings.push(`No source confirmed rates for ${target.start} to ${target.end} yet.`);
    return result;
  }

  for (const [scheme, { rate, maturityMonths }] of perScheme) {
    const lastP = lastSchemePeriod(ctx.root, scheme);
    let note = noteFor(target, usedUrl === NSI_URL ? "NSI master table" : usedUrl === INDIA_POST_URL ? "India Post" : "DEA OM", rate === (lastP?.rate ?? undefined));
    if (scheme === "kvp" && maturityMonths) note = `Doubling period ${maturityMonths} months. ${note}`;
    const change: SchemePeriodChange = {
      kind: "scheme_period",
      scheme,
      period: { effectiveFrom: target.start, effectiveTo: target.end, rate, note, sourceUrl: usedUrl ?? NSI_URL, evidence, crossCheckUrl: null },
    };
    result.changes.push(change);
  }
  result.usedSourceUrl = usedUrl;
  return result;
}
