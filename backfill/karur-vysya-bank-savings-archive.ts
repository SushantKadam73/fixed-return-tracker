/**
 * Karur Vysya Bank -- savings account rate history from the bank's own small JSON API
 * (kvb.co.in/api/v1/savings-interest-rates), read via the Internet Archive. Like South Indian
 * Bank's savings history, this cannot go through backfill/wayback/run.ts: that pipeline's
 * Target/GenericResult shape only carries RateRow[] (term-deposit rows), never
 * SavingsSlab[]/slabMethod, so a savings card built through it always fails validateCard's
 * "no_slabs" check. This script reads the Wayback captures itself (the same shared,
 * rate-limited cdx.ts helpers everyone else uses) and stores savings cards directly.
 *
 * Source: https://www.kvb.co.in/api/v1/savings-interest-rates -- confirmed by fetching a capture
 * directly that the response body is JSON, not HTML:
 *   {"data":{"wef_date":{"date":"2020-11-16 ..."},"content_above_table":"Rates of Interest on
 *    Savings Account (w.e.f. 16.11.2020) are listed below:",
 *    "interest_rates":{"columns":{...},"values":[{"slab":"EOD balance up to Rs.1 Lakh",
 *    "interest_rate":"2.75%"}, ...]}}}
 * Only one capture was found via discover's collapsed URL list (2020-11-16); `monthlyCaptures`
 * is used anyway (not a one-off fetch) so a rerun automatically picks up any further captures
 * the archive gains later.
 *
 * Run: npx tsx backfill/karur-vysya-bank-savings-archive.ts [--verbose]
 */
import type { RateCard, SavingsSlab } from "../lib/domain";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { findEffectiveDate } from "../collectors/src/parse/common";
import { storeHistoricalCard } from "../collectors/src/store";
import { monthlyCaptures, snapshot, tsToDate } from "./wayback/cdx";

// Staging only -- never the repo itself (see backfill/notes/pvt-b.md and the project rules).
const STAGING_ROOT = "/agent/workspace/private/history-staging/Vellum";
const URL = "kvb.co.in/api/v1/savings-interest-rates";
const verbose = process.argv.includes("--verbose");

function firstRate(cell: string): number | null {
  const m = /(\d{1,2}(?:\.\d{1,3})?)\s*%/.exec(cell);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 20 ? v : null;
}

interface ApiDoc {
  data?: {
    content_above_table?: string;
    wef_date?: { date?: string };
    interest_rates?: { values?: Array<{ slab?: string; interest_rate?: string }> };
  };
}

function parseCapture(json: string): { slabs: SavingsSlab[]; effectiveFrom: string | null; skipped: string[] } {
  let doc: ApiDoc;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    return { slabs: [], effectiveFrom: null, skipped: [`invalid JSON: ${(e as Error).message}`] };
  }
  const values = doc.data?.interest_rates?.values ?? [];
  const skipped: string[] = [];
  const slabs: SavingsSlab[] = [];
  for (const v of values) {
    const band = v.slab ? parseAmountBand(v.slab) : null;
    const rate = v.interest_rate ? firstRate(v.interest_rate) : null;
    if (!band || rate === null) {
      skipped.push(`slab "${v.slab}" / "${v.interest_rate}": ${!band ? "unreadable balance band" : "unreadable rate"}`);
      continue;
    }
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" });
  }
  // The wef_date field is a plain "YYYY-MM-DD HH:MM:SS.ffffff" timestamp, not a phrase findEffectiveDate
  // parses; content_above_table repeats the same date in dd.mm.yyyy prose form that it does handle.
  const effectiveFrom = findEffectiveDate(doc.data?.content_above_table ?? "");
  return { slabs, effectiveFrom, skipped };
}

async function main() {
  const caps = await monthlyCaptures(URL, "2019", "2026");
  console.log(`${caps.length} monthly captures.`);

  type Group = { key: string; slabs: SavingsSlab[]; effectiveFrom: string | null; first: string; last: string; archiveUrl: string };
  const groups: Group[] = [];
  const skippedLog: string[] = [];
  let parsed = 0;

  for (const c of caps) {
    let html: string;
    let archiveUrl: string;
    try {
      ({ html, archiveUrl } = await snapshot(c));
    } catch (e) {
      skippedLog.push(`${c.timestamp}: fetch ${(e as Error).message}`);
      continue;
    }
    const date = tsToDate(c.timestamp);
    const res = parseCapture(html);
    if (res.slabs.length === 0) {
      skippedLog.push(`${c.timestamp}: ${res.skipped.join("; ") || "no rows"}`);
      if (verbose) console.error(`  ${c.timestamp}  SKIP ${res.skipped.join("; ")}`);
      continue;
    }
    parsed++;
    const key = JSON.stringify(res.slabs.map((s) => [s.balanceMin, s.balanceMax, s.rate]));
    if (verbose) console.error(`  ${c.timestamp}  ${res.slabs.length} slabs`);
    const prev = groups.at(-1);
    if (prev && prev.key === key) {
      prev.last = date;
      prev.effectiveFrom = prev.effectiveFrom ?? res.effectiveFrom;
    } else {
      groups.push({ key, slabs: res.slabs, effectiveFrom: res.effectiveFrom, first: date, last: date, archiveUrl });
    }
  }

  const observedAt = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  const rejectedDetails: string[] = [];
  for (const g of groups) {
    const effectiveFrom = g.effectiveFrom && g.effectiveFrom <= g.first ? g.effectiveFrom : null;
    const card: RateCard = {
      bankSlug: "karur-vysya-bank",
      product: "savings",
      effectiveFrom,
      observedAt,
      observedFrom: g.first,
      observedTo: g.last,
      sourceType: "web_archive",
      sourceUrl: URL,
      archiveUrl: g.archiveUrl,
      confidence: effectiveFrom ? "medium" : "low",
      rows: [],
      savingsSlabs: g.slabs,
      slabMethod: "unknown",
      notes: [`Reconstructed from an Internet Archive copy of the bank's own JSON rate API, captured ${g.first} to ${g.last}.`],
    };
    const result = storeHistoricalCard(STAGING_ROOT, card);
    if (result.outcome === "inserted") inserted++;
    else if (result.outcome === "unchanged") unchanged++;
    else {
      rejected++;
      rejectedDetails.push(`${g.first}: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  console.log(`\n=== Karur Vysya Bank savings backfill summary ===`);
  console.log(`captures=${caps.length} parsed=${parsed} groups=${groups.length}`);
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
  if (groups.length > 0) console.log(`span: ${groups[0].first} .. ${groups.at(-1)!.last}`);
  if (skippedLog.length > 0) {
    console.log(`skipped (${skippedLog.length}):`);
    for (const s of skippedLog.slice(0, 20)) console.log(`  ${s}`);
  }
  if (rejectedDetails.length > 0) {
    console.log("Rejected:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

if (process.argv[1] && /karur-vysya-bank-savings-archive\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
