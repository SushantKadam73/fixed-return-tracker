/**
 * South Indian Bank -- savings account rate history, from an Internet Archive series that the
 * shared backfill/wayback/run.ts pipeline cannot store: that pipeline's Target/GenericResult
 * shape only carries RateRow[] (term-deposit rows), never SavingsSlab[]/slabMethod, so a savings
 * card built through it always fails validateCard's "no_slabs" check. This script therefore reads
 * the Wayback captures itself (via the same shared, rate-limited cdx.ts helpers everyone else
 * uses) and stores savings cards directly, the same pattern as the bank-archive scripts for a
 * PDF/live source (sbi-savings-archive.ts, hdfc-savings-archive.ts) but sourced from the archive.
 *
 * Source page: southindianbank.com/interestRate/interestRateDetails.aspx?irtID=10
 *   ("DOMESTIC SAVINGS ACCOUNT (Also Applicable for NRO Accounts)", later "ALL SAVINGS ACCOUNTS
 *   (Also Applicable for NRO/NRE Accounts)").
 * Coverage requested: only from 2011-10-25 (the day RBI deregulated the savings rate) onward --
 * before that date the rate was RBI-prescribed for every bank and is already loaded as a
 * system-wide series (data/history/rbi/*.json); duplicating it per bank is against project rules.
 *
 * Two layouts appear in the archive:
 *  - A flat "Period | Rate" table with one data row ("Savings Bank A/c (w.e.f DATE) | X% per
 *    annum") -- SIB kept a single flat rate for years after deregulation. Read as one slab
 *    covering the whole balance range.
 *  - From 2020 (in the captures actually read), an "End of the day Balance | Rate of Interest"
 *    table with several balance tiers, read with the shared parseAmountBand helper -- the same
 *    balance-tier phrasing PNB and HDFC's own archives use, so no bank-specific text massaging is
 *    needed here (unlike the "(incl)" spelling on the FD page -- see parsers/pvt-b.ts).
 *
 * Whole vs incremental slab application is never stated on this page (the site's own live pages
 * are similarly silent per the Phase 1 survey) -- slabMethod is recorded as "unknown", never
 * guessed.
 *
 * Run: npx tsx backfill/south-indian-bank-savings-archive.ts [--verbose]
 */
import type { RateCard, SavingsSlab } from "../lib/domain";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { findEffectiveDate } from "../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../collectors/src/parse/html-table";
import { storeHistoricalCard } from "../collectors/src/store";
import { monthlyCaptures, snapshot, tsToDate } from "./wayback/cdx";

// Staging only -- never the repo itself (see backfill/notes/pvt-b.md and the project rules).
const STAGING_ROOT = "/agent/workspace/private/history-staging/Vellum";

const URL = "southindianbank.com/interestRate/interestRateDetails.aspx?irtID=10";
const FROM = "2011"; // CDX "from" is a year/month prefix; the 2011-10-25 cutoff is applied below per-card
const DEREGULATION_DATE = "2011-10-25";
const verbose = process.argv.includes("--verbose");

function firstRate(cell: string): number | null {
  const m = /(\d{1,2}(?:\.\d{1,3})?)\s*%/.exec(cell);
  if (!m) return null;
  const v = Number(m[1]);
  return v > 0 && v < 20 ? v : null;
}

// True only when the cell is *just* a plain percentage (with an optional "per annum"/p.a. suffix)
// -- anything else (repo-linkage wording, footnote markers) is preserved verbatim in a card note
// rather than silently dropped, so the printed formula/caveat is never lost.
function isPlainRateCell(cell: string): boolean {
  return /^\s*\d{1,2}(?:\.\d{1,3})?\s*%\s*(per\s*annum|p\.?\s?a\.?)?\.?\s*$/i.test(cell);
}

interface ParsedSavings {
  slabs: SavingsSlab[];
  skipped: string[];
}

function readSavingsGrid(g: Grid): ParsedSavings | null {
  if (g.rows.length < 2) return null;
  const header = g.rows[0].map((c) => c.toLowerCase());
  const body = g.rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (body.length === 0) return null;

  const isBalanceTiered = header.some((h) => /balance/.test(h));
  const skipped: string[] = [];

  if (isBalanceTiered) {
    const slabs: SavingsSlab[] = [];
    for (const r of body) {
      const band = parseAmountBand(r[0] ?? "");
      const rate = firstRate(r[1] ?? "");
      if (!band || rate === null) {
        skipped.push(`row "${r[0]}" / "${r[1]}": ${!band ? "unreadable balance band" : "unreadable rate"}`);
        continue;
      }
      const slab: SavingsSlab = { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
      if (!isPlainRateCell(r[1] ?? "")) slab.note = `Bank's own page prints this slab's rate as "${(r[1] ?? "").trim()}".`;
      slabs.push(slab);
    }
    return slabs.length >= 2 ? { slabs, skipped } : null;
  }

  // Flat single-rate era: one data row naming the savings account product, no balance tiers.
  if (body.length === 1 && /saving/i.test(body[0][0] ?? "")) {
    const rate = firstRate(body[0][1] ?? "");
    if (rate === null) return null;
    const slab: SavingsSlab = { balanceMin: 0, balanceMax: null, rate, residency: "resident" };
    if (!isPlainRateCell(body[0][1] ?? "")) slab.note = `Bank's own page prints this rate as "${(body[0][1] ?? "").trim()}".`;
    return { slabs: [slab], skipped: [] };
  }
  return null;
}

function parseCapture(html: string): ParsedSavings & { effectiveFrom: string | null } {
  for (const g of extractTables(html)) {
    const res = readSavingsGrid(g);
    if (res) return { ...res, effectiveFrom: findEffectiveDate(pageText(html)) };
  }
  return { slabs: [], skipped: ["no savings table (balance-tiered or flat) found"], effectiveFrom: null };
}

function slabsKey(slabs: SavingsSlab[]): string {
  return JSON.stringify(slabs.map((s) => [s.balanceMin, s.balanceMax, s.rate]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

async function main() {
  const caps = await monthlyCaptures(URL, FROM, "2026");
  const inScope = caps.filter((c) => tsToDate(c.timestamp) >= DEREGULATION_DATE);
  console.log(`${caps.length} monthly captures from ${FROM}; ${inScope.length} on/after ${DEREGULATION_DATE} (deregulation).`);

  type Group = { key: string; slabs: SavingsSlab[]; effectiveFrom: string | null; first: string; last: string; archiveUrl: string };
  const groups: Group[] = [];
  const skippedLog: string[] = [];
  let parsed = 0;

  for (const c of inScope) {
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
    const key = slabsKey(res.slabs);
    if (verbose) console.error(`  ${c.timestamp}  ${res.slabs.length} slabs  key=${key.slice(0, 60)}`);
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
      bankSlug: "south-indian-bank",
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
      notes: [
        `Reconstructed from Internet Archive copies of the bank's official page captured ${g.first} to ${g.last}.`,
        "The source page states these rates are also applicable to NRO (and, from later captures, NRE) savings accounts; recorded here with residency \"resident\" since the page does not print separate NRO/NRE figures.",
        "Only captured from 2011-10-25 (RBI's savings-rate deregulation) onward; the earlier RBI-prescribed rate is in the system-wide series, not duplicated per bank.",
      ],
    };
    const result = storeHistoricalCard(STAGING_ROOT, card);
    if (result.outcome === "inserted") inserted++;
    else if (result.outcome === "unchanged") unchanged++;
    else {
      rejected++;
      rejectedDetails.push(`${g.first}: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  console.log(`\n=== South Indian Bank savings backfill summary ===`);
  console.log(`captures evaluated=${inScope.length} parsed=${parsed} groups=${groups.length}`);
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

if (process.argv[1] && /south-indian-bank-savings-archive\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
