/**
 * Indian Bank -- savings-account rate history from Internet Archive captures of
 * indianbank.in/rate_sb.php ("Interest Rates on SB / NRO / NRE Accounts").
 *
 * Written as its own script (not a backfill/wayback/run.ts target) because that pipeline's
 * generic-parse.ts can only read tenure-keyed tables (RateRow[]), never savingsSlabs -- see
 * backfill/notes/psb-b.md. Every capture checked (2009-2013) prints the SAME shape: an
 * "Account | Normal | Senior Citizen | Minimum Balance" table with one flat rate for every
 * domestic sub-type (with/without cheque book, no-frills) -- no balance tiers at all, so this
 * script reads that one number directly rather than building a general slab-table reader.
 *
 * This flat rate is bank-specific PRIMARY evidence (Indian Bank's own page, not a synthesis of
 * the RBI-prescribed system-wide series already loaded elsewhere in this repo), so the whole
 * 2009-2013 span is kept even though most of it duplicates the RBI-prescribed value: the point
 * is that it is Indian Bank's own page saying so, not an assumption that Indian Bank followed
 * the prescribed rate. The bank had still not introduced balance-based tiering as of the last
 * capture read (2013-12-12) -- flat 4.00% throughout the post-25-Oct-2011 captures checked, a
 * genuine (if unglamorous) finding about this specific bank, not a parsing shortfall.
 *
 * Uses cdx.ts's own exported `monthlyCaptures`/`snapshot` (the sanctioned way to reuse the
 * shared Internet Archive rate limiter/cache -- see backfill/wayback/explore.ts's header and
 * backfill/capital-sfb-savings-wayback.ts for the established pattern) rather than duplicating
 * that logic or going through run.ts.
 *
 * Run: npx tsx backfill/indian-bank-savings-wayback.ts
 */
import type { RateCard } from "../lib/domain";
import { extractTables, type Grid } from "../collectors/src/parse/html-table";
import { parseRate } from "../collectors/src/parse/common";
import { storeHistoricalCard } from "../collectors/src/store";
import { monthlyCaptures, snapshot, tsToDate } from "./wayback/cdx";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Scribe";
const URL = "www.indianbank.in/rate_sb.php";

function isSbGrid(g: Grid): boolean {
  return /Interest Rates on SB/i.test(g.context) && g.rows.some((r) => /with cheque\s*bookfacility/i.test(r[0] ?? ""));
}

/** The flat domestic "Normal" rate from the "a. With cheque bookfacility" row, or null if the shape has changed. */
function readFlatRate(html: string): number | null {
  const g = extractTables(html).find(isSbGrid);
  if (!g) return null;
  const row = g.rows.find((r) => /with cheque\s*bookfacility/i.test(r[0] ?? ""));
  if (!row) return null;
  // Sanity-check the OTHER domestic sub-rows agree, so a genuinely tiered page (which this
  // script cannot read) is skipped rather than silently reduced to one row's number.
  const others = g.rows.filter((r) => /without cheque\s*bookfacility|no frills account/i.test(r[0] ?? ""));
  const rate = parseRate(row[1] ?? "");
  if (rate === null) return null;
  for (const o of others) {
    const r2 = parseRate(o[1] ?? "");
    if (r2 !== null && r2 !== rate) return null; // sub-types disagree: not a single flat rate, don't guess
  }
  return rate;
}

async function main() {
  const caps = await monthlyCaptures(URL, "2009", "2014");
  type Point = { date: string; rate: number; archiveUrl: string };
  const points: Point[] = [];
  const byDigest = new Map<string, number | null>();
  let skipped = 0;
  for (const c of caps) {
    let rate = c.digest ? byDigest.get(c.digest) : undefined;
    if (rate === undefined) {
      const { html } = await snapshot(c);
      rate = readFlatRate(html);
      if (c.digest) byDigest.set(c.digest, rate);
    }
    if (rate === null) {
      console.log(`${c.timestamp}: no single flat rate found, skipped`);
      skipped++;
      continue;
    }
    points.push({ date: tsToDate(c.timestamp), rate, archiveUrl: `https://web.archive.org/web/${c.timestamp}id_/${c.original}` });
  }
  // Group consecutive identical rates into one card "in force at least between observedFrom/To".
  const today = new Date().toISOString().slice(0, 10);
  let stored = 0;
  let i = 0;
  while (i < points.length) {
    const start = points[i];
    let j = i;
    while (j + 1 < points.length && points[j + 1].rate === start.rate) j++;
    const end = points[j];
    const card: RateCard = {
      bankSlug: "indian-bank",
      product: "savings",
      effectiveFrom: null,
      observedAt: today,
      observedFrom: start.date,
      observedTo: end.date,
      sourceType: "web_archive",
      sourceUrl: `https://${URL}`,
      archiveUrl: start.archiveUrl,
      confidence: "medium",
      rows: [],
      savingsSlabs: [{ balanceMin: 0, balanceMax: null, rate: start.rate, residency: "resident" }],
      slabMethod: "whole",
      notes: [
        `Reconstructed from Internet Archive copies of the bank's official page captured ${start.date} to ${end.date}.`,
        "The page prints one flat rate for every domestic sub-type (with/without cheque book, no-frills) in every capture checked -- not a balance-tiered slab table.",
      ],
    };
    const r = storeHistoricalCard(STAGING_ROOT, card);
    console.log(`${start.date} -> ${end.date}: ${start.rate}% (${r.outcome})`, r.issues.length ? r.issues.map((x) => `${x.level}:${x.message}`) : "");
    if (r.outcome === "inserted") stored++;
    i = j + 1;
  }
  console.log(`${stored} card(s) stored, ${skipped} capture(s) skipped (shape not readable as a single flat rate).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
