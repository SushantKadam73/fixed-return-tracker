/**
 * Punjab National Bank savings-account rate history — PNB has no separate historical file;
 * its live deposit-rates page embeds ~14 years of past savings-rate revisions as hidden tab
 * panels (one small table per "w.e.f. DATE" tab). This script fetches that page and turns
 * every such panel into a historical savings RateCard.
 *
 * Source: https://pnb.bank.in/Interest-Rates-Deposit.html ("Saving Deposit Interest Rate"
 * section). Coverage (as printed): 03.05.2011 to 01.10.2025 (17 dated panels, including the
 * current one). This is a live-page-inline archive, not a maintained file — a PNB redesign
 * could remove or restructure it (see backfill/README.md).
 *
 * How the date for each panel is found: `extractTables` records the heading/tab-label text
 * immediately preceding each table as `context`. PNB's tab labels ("w.e.f. DD.MM.YY") sit as
 * siblings next to (not inside) each panel, so `context` accumulates EVERY tab label seen so
 * far by the time it reaches a given panel — the panel's own date is always the LAST one in
 * that accumulated list (verified by checking the dates run in strictly descending
 * chronological order across the 17 panels, exactly as a "current, then progressively older"
 * tab strip would).
 *
 * Balance-band labels are printed inconsistently ("Balance below Rs. 10 Lakh", "Saving Fund
 * Account Balance of Rs.10 Lakh to less than Rs.100 Crore", "Balance for Rs.10 Lakh & above" —
 * all on the same page). `parseAmountBand` only recognises an exclusive lower bound
 * ("more than X") when it is the first word, so a leading "Balance"/"Saving Fund Account
 * Balance (of|for|from)" is stripped before calling it — a mechanical prefix removal, not a
 * guess; the number and comparison words that follow are untouched.
 *
 * Run: npx tsx backfill/pnb-savings-archive.ts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, SavingsSlab } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { parseDate, parseRate } from "../collectors/src/parse/common";
import { extractTables, type Grid } from "../collectors/src/parse/html-table";
import { storeHistoricalCard } from "../collectors/src/store";
import { fetchDoc } from "../collectors/src/fetch";

const ROOT = path.join(__dirname, "..");
const SOURCE_URL = "https://pnb.bank.in/Interest-Rates-Deposit.html";
const ARCHIVE_PATH = "/agent/workspace/private/archives/pnb/interest-rates-deposit.html";

const BALANCE_PREFIX_RE = /^(savings?\s+fund\s+account\s+)?balance\s+(of|for|from)?\s*/i;
const FLAT_LABEL_RE = /^savings?\s+fund\s+account$/i;

// `parseAmountBand`'s single-bound above/below check is word-boundary-anchored, so a bare
// leading "<"/">" symbol (as PNB prints for its 2,000-crore-and-above tier) is never recognised
// — the same limitation worked around in backfill/sbi-fd-archive.ts. Spelling it out as
// "below "/"above " is a mechanical substitution, not a guess. PNB's current-rate tier also
// uses "> X <= Y" for a middle band; `parseAmountBand` only recognises the upper bound as
// inclusive when the word "upto"/"inclusive" follows, so "<=" is spelled out as "to upto" —
// again a like-for-like substitution of a symbol for the words `parseAmountBand` already
// understands, not a change to which numbers or comparisons are being made.
function normalizeComparison(label: string): string {
  return label
    .replace(/<=/g, " to upto ")
    .replace(/^\s*</, "below ")
    .replace(/^\s*>/, "above ")
    .trim();
}

function isSavingsHistoryGrid(g: Grid): boolean {
  return g.rows.some((r) => r.length === 2 && r[0] === "" && /rate of interest|w\.e\.f\./i.test(r[1] ?? ""));
}

function ownDateOf(g: Grid): string | null {
  const headerRow = g.rows.find((r) => r.length === 2 && r[0] === "") ?? [];
  const combined = `${g.context} ${headerRow.join(" ")}`;
  const matches = [...combined.matchAll(/w\.e\.f\.?\s*([\d./-]+)/gi)];
  const raw = matches.at(-1)?.[1];
  return raw ? parseDate(raw) : null;
}

async function main() {
  console.log(`fetching ${SOURCE_URL}`);
  const doc = await fetchDoc(SOURCE_URL, "html");
  mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  if (!existsSync(ARCHIVE_PATH)) {
    writeFileSync(ARCHIVE_PATH, doc.text);
    console.log(`saved ${doc.text.length} chars -> ${ARCHIVE_PATH}`);
  } else {
    console.log(`using cached download: ${ARCHIVE_PATH}`);
  }

  const grids = extractTables(doc.text).filter(isSavingsHistoryGrid);
  console.log(`found ${grids.length} savings-history panels`);

  const today = todayIST();
  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  let cardsSkipped = 0;
  let rowsSkipped = 0;
  const rejectedDetails: string[] = [];
  const dates: string[] = [];

  for (const g of grids) {
    const effectiveFrom = ownDateOf(g);
    if (!effectiveFrom) {
      cardsSkipped++;
      console.log(`SKIP panel: could not read its own "w.e.f." date from context "${g.context.slice(-120)}"`);
      continue;
    }

    const dataRows = g.rows.filter((r) => parseRate(r[1] ?? "") !== null);
    const slabs: SavingsSlab[] = [];
    for (const r of dataRows) {
      const label = (r[0] ?? "").trim();
      const rate = parseRate(r[1] ?? "");
      if (rate === null) continue;
      if (FLAT_LABEL_RE.test(label)) {
        slabs.push({ balanceMin: 0, balanceMax: null, rate, residency: "resident" });
        continue;
      }
      const stripped = normalizeComparison(label.replace(BALANCE_PREFIX_RE, "").trim());
      const band = parseAmountBand(stripped);
      if (!band) {
        rowsSkipped++;
        console.log(`  SKIP row (${effectiveFrom}): unreadable balance label "${label}"`);
        continue;
      }
      slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" });
    }

    if (slabs.length === 0) {
      cardsSkipped++;
      console.log(`SKIP panel (${effectiveFrom}): no readable slabs`);
      continue;
    }

    const card: RateCard = {
      bankSlug: "punjab-national-bank",
      product: "savings",
      effectiveFrom,
      observedAt: today,
      sourceType: "bank_archive",
      sourceUrl: SOURCE_URL,
      confidence: "high",
      rows: [],
      savingsSlabs: slabs,
      slabMethod: "unknown",
    };
    const result = storeHistoricalCard(ROOT, card);
    if (result.outcome === "inserted") {
      inserted++;
      dates.push(effectiveFrom);
    } else if (result.outcome === "unchanged") {
      unchanged++;
      dates.push(effectiveFrom);
    } else {
      rejected++;
      rejectedDetails.push(`${effectiveFrom}: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  dates.sort();
  console.log("\n=== Punjab National Bank savings backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected} cards_skipped=${cardsSkipped} rows_skipped=${rowsSkipped}`);
  if (dates.length > 0) console.log(`date span: ${dates[0]} .. ${dates[dates.length - 1]}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected by validation:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
