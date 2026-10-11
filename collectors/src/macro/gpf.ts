/**
 * Task `gpf`: General Provident Fund (Central Government), quarterly, from DEA
 * resolutions. Historical parity with PPF is insufficient evidence for a new quarter.
 */
import type { MacroTaskContext, SchemePeriodChange, TaskResult } from "./types";
import { lastSchemePeriod } from "./store";
import { daysBetween, nextQuarter, noticeCoversQuarter, quarterOf } from "./dates";
import { isUnchangedNotice, DEA_LISTING_URL, PRE_ANNOUNCEMENT_WINDOW_DAYS } from "./small-savings";

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "gpf", ok: false, sourcesTried: [], changes: [], warnings: [] };

  const gpfLast = lastSchemePeriod(ctx.root, "gpf");
  if (!gpfLast) {
    result.error = "data/schemes/gpf.json has no periods";
    return result;
  }

  // The next quarter GPF needs, one at a time — not necessarily PPF's own latest quarter,
  // in case GPF ever falls more than one quarter behind PPF.
  const target = nextQuarter(quarterOf(gpfLast.effectiveTo ?? gpfLast.effectiveFrom));
  if (daysBetween(ctx.today, target.start) > PRE_ANNOUNCEMENT_WINDOW_DAYS) {
    result.ok = true;
    result.warnings.push(`Next GPF quarter ${target.start} is not due for checking.`);
    return result;
  }

  // 1. DEA's own GPF resolution (same listing page as small-savings; a distinct PDF).
  try {
    const listing = await ctx.fetch(DEA_LISTING_URL);
    result.sourcesTried.push({ url: DEA_LISTING_URL, ok: true, status: listing.status });
    const link = extractGpfLink(listing.text);
    const omUrl = link ? new URL(link, DEA_LISTING_URL).toString() : null;
    if (omUrl) {
      const om = await ctx.fetch(omUrl, "pdf");
      result.sourcesTried.push({ url: omUrl, ok: true, status: om.status });
      if (/general provident fund|\bgpf\b/i.test(om.text) && noticeCoversQuarter(om.text, target.start, target.end) && isUnchangedNotice(om.text)) {
        result.changes.push(gpfPeriod(target, gpfLast.rate, omUrl, "DEA GPF resolution confirms the previous GPF rate unchanged.", "primary", null));
        result.usedSourceUrl = omUrl;
        result.ok = true;
      }
    } else {
      result.warnings.push("Could not find a GPF resolution link on the DEA listing page.");
    }
  } catch (e) {
    result.sourcesTried.push({ url: DEA_LISTING_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
  }

  // Observed historical parity does not establish this quarter's separately notified rate.
  if (result.changes.length === 0) {
    result.ok = false;
    result.error = "The separately notified GPF resolution is unverified; last good history retained.";
  }
  return result;
}

function extractGpfLink(html: string): string | null {
  const re = /<a[^>]+href="([^"]+\.pdf)"[^>]*>([^<]*(?:General Provident Fund|GPF)[^<]*)<\/a>/i;
  return re.exec(html)?.[1] ?? null;
}

function gpfPeriod(target: { start: string; end: string }, rate: number | null, sourceUrl: string, note: string, evidence: "primary" | "secondary", crossCheckUrl: string | null): SchemePeriodChange {
  return {
    kind: "scheme_period",
    scheme: "gpf",
    period: { effectiveFrom: target.start, effectiveTo: target.end, rate, note, sourceUrl, evidence, crossCheckUrl },
  };
}
