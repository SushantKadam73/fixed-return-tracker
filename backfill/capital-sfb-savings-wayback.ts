/**
 * Capital Small Finance Bank -- savings-account rate history from Internet Archive captures of
 * capitalbank.co.in/interest-rates/savings-bank-account.
 *
 * Written as its own script (not a backfill/wayback/run.ts target) because that pipeline's
 * generic-parse.ts can only read tenure-keyed tables (RateRow[]), never savingsSlabs -- see
 * backfill/notes/sfb.md. This bank's page turns out to need very little of that machinery: every
 * capture checked prints one flat rate for every account type (Domestic Savings, Basic Savings,
 * NRO, NRE) -- a single balance-less slab, not a tiered table -- so this script reads that one
 * number directly rather than building a general slab-table reader.
 *
 * Uses cdx.ts's own exported `monthlyCaptures`/`snapshot` (the sanctioned way to reuse the
 * shared Internet Archive rate limiter/cache -- see backfill/wayback/explore.ts's header) rather
 * than duplicating that logic.
 *
 * Run: npx tsx backfill/capital-sfb-savings-wayback.ts
 */
import type { RateCard } from "../lib/domain";
import { extractTables } from "../collectors/src/parse/html-table";
import { parseRate } from "../collectors/src/parse/common";
import { storeHistoricalCard } from "../collectors/src/store";
import { monthlyCaptures, snapshot, tsToDate } from "./wayback/cdx";

const STAGING_ROOT = "/agent/workspace/private/history-staging/Tidemark";
const URL = "https://www.capitalbank.co.in/interest-rates/savings-bank-account";

/** One flat rate read from the "Domestic Savings Bank Account" row, or null if not found/ambiguous. */
function readFlatRate(html: string): number | null {
  for (const g of extractTables(html)) {
    const row = g.rows.find((r) => /savings bank account/i.test(r[1] ?? "") && !/basic/i.test(r[1] ?? ""));
    if (!row) continue;
    const rate = parseRate(row[2] ?? "");
    if (rate !== null) return rate;
  }
  return null;
}

async function main() {
  const caps = await monthlyCaptures(URL, "2019", "2026");
  type Point = { date: string; rate: number; archiveUrl: string };
  const points: Point[] = [];
  const byDigest = new Map<string, number | null>();
  for (const c of caps) {
    let rate = c.digest ? byDigest.get(c.digest) : undefined;
    if (rate === undefined) {
      const { html } = await snapshot(c);
      rate = readFlatRate(html);
      if (c.digest) byDigest.set(c.digest, rate);
    }
    if (rate === null) {
      console.log(`${c.timestamp}: no flat rate found, skipped`);
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
      bankSlug: "capital-sfb",
      product: "savings",
      effectiveFrom: null,
      observedAt: today,
      observedFrom: start.date,
      observedTo: end.date,
      sourceType: "web_archive",
      sourceUrl: URL,
      archiveUrl: start.archiveUrl,
      confidence: "medium",
      rows: [],
      savingsSlabs: [{ balanceMin: 0, balanceMax: null, rate: start.rate, residency: "resident" }],
      slabMethod: "whole",
      notes: [
        `Reconstructed from Internet Archive copies of the bank's official page captured ${start.date} to ${end.date}.`,
        "The page states one flat rate for every account type (Domestic Savings, Basic Savings/Suvidha Bachat, NRO, NRE) in every capture checked -- not a balance-tiered slab table.",
      ],
    };
    const r = storeHistoricalCard(STAGING_ROOT, card);
    console.log(`${start.date} -> ${end.date}: ${start.rate}% (${r.outcome})`, r.issues.length ? r.issues.map((x) => `${x.level}:${x.message}`) : "");
    if (r.outcome === "inserted") stored++;
    i = j + 1;
  }
  console.log(`${stored} card(s) stored.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
