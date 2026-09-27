/**
 * Task `gpf`: General Provident Fund (Central Government), quarterly, from DEA
 * resolutions. GPF has mirrored PPF's rate exactly, quarter for quarter, since
 * 1986-04-01 (documented in data/schemes/gpf.json's own notes) — DEA issues GPF its
 * own resolution each quarter, legally distinct from the small-savings OM but always
 * numerically identical. See README.md for the source order and why the mirror fallback
 * exists.
 */
import type { MacroTaskContext, SchemePeriodChange, TaskResult } from "./types";
import { lastSchemePeriod } from "./store";
import { nextQuarter, quarterOf } from "./dates";
import { findLatestOmLink, isUnchangedNotice, DEA_LISTING_URL } from "./small-savings";

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "gpf", ok: false, sourcesTried: [], changes: [], warnings: [] };

  const gpfLast = lastSchemePeriod(ctx.root, "gpf");
  const ppfLast = lastSchemePeriod(ctx.root, "ppf");
  if (!gpfLast || !ppfLast) {
    result.error = "data/schemes/gpf.json or ppf.json has no periods";
    return result;
  }

  // The next quarter GPF needs, one at a time — not necessarily PPF's own latest quarter,
  // in case GPF ever falls more than one quarter behind PPF.
  const target = nextQuarter(quarterOf(gpfLast.effectiveTo ?? gpfLast.effectiveFrom));
  const ppfCoversTarget = (ppfLast.effectiveTo ?? ppfLast.effectiveFrom) >= target.end;
  if (!ppfCoversTarget) {
    result.ok = true;
    result.warnings.push(`PPF has not yet confirmed ${target.start} to ${target.end}; nothing for GPF to mirror this run.`);
    return result;
  }

  // 1. DEA's own GPF resolution (same listing page as small-savings; a distinct PDF).
  try {
    const listing = await ctx.fetch(DEA_LISTING_URL);
    result.sourcesTried.push({ url: DEA_LISTING_URL, ok: true, status: listing.status });
    result.ok = true;
    const omUrl = findLatestOmLink(listing.text) ?? extractGpfLink(listing.text);
    if (omUrl) {
      const om = await ctx.fetch(omUrl, "pdf");
      result.sourcesTried.push({ url: omUrl, ok: true, status: om.status });
      if (isUnchangedNotice(om.text)) {
        result.changes.push(gpfPeriod(target, ppfLast.rate, omUrl, "DEA GPF resolution confirms rates unchanged; mirrors PPF.", "primary", ppfLast.sourceUrl));
        result.usedSourceUrl = omUrl;
      }
    } else {
      result.warnings.push("Could not find a GPF resolution link on the DEA listing page.");
    }
  } catch (e) {
    result.sourcesTried.push({ url: DEA_LISTING_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
  }

  // 2. Fallback: PPF's newly-confirmed quarter mirrored mechanically (documented, not invented — see gpf.json's own notes).
  if (result.changes.length === 0) {
    result.ok = true;
    result.changes.push(
      gpfPeriod(
        target,
        ppfLast.rate,
        ppfLast.sourceUrl,
        "Mirrors PPF's rate for the same quarter (documented Finance Ministry practice since 1986); DEA's own GPF resolution was not independently reachable this run.",
        "secondary",
        null,
      ),
    );
    result.usedSourceUrl = ppfLast.sourceUrl;
    result.warnings.push("GPF period derived from PPF (secondary evidence) — DEA GPF resolution not confirmed this run.");
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
