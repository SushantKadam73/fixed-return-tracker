/**
 * HDFC Bank savings-account rate history — downloads HDFC's own "Historic Savings Account
 * Interest Rate" PDF and turns each printed effective-date range into a historical savings
 * RateCard.
 *
 * Source: "Historic Rates" hub on hdfc.bank.in
 *   found via: https://www.hdfc.bank.in/interest-rates
 *   file: https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/historic-saving-account-interest-rates.pdf
 * Coverage (as printed): 01/03/2003 to date, 11 dated periods, each printed as an explicit
 * "Effective Date: X to Y" range against up to 4 balance tiers ("Below Rs 50 Lakhs" / "Rs 50
 * Lakhs to Less than Rs 500 Cr" / "Rs 500 Cr to less than Rs 1,000 Cr" / "Rs 1,000 Cr and
 * Above").
 *
 * Why the table below is transcribed rather than parsed from extracted text: several rows use
 * a table cell that VISUALLY SPANS two or three of the four tier columns to show one rate
 * covering all of them (e.g. one merged cell under "Below 50L" + "50L-500Cr" showing "3.50%"
 * for 2003-2011, when those two tiers did not yet exist separately). Both `pdftotext -layout`
 * and unpdf's text-stream order preserve the *values* but drop which columns a merged cell
 * actually spans, so the column boundaries cannot be read back out of the text without
 * guessing. We resolved this once by rendering the PDF page to an image and reading the true
 * column spans directly (see backfill/README.md) — every number below is exactly what the PDF
 * prints, just captured by eye instead of by regex where the columns merge. The literal
 * "RBI Repo Rate + 2bps" tiers for 2019-01-07..2020-04-14 are not a fixed percentage the source
 * prints, so — per the project's no-guessing rule — that tier is omitted (not invented) and the
 * card carries a note saying so; the other two tiers for those two periods are numeric and are
 * kept.
 *
 * Run: npx tsx backfill/hdfc-savings-archive.ts
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, SavingsSlab } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseDate, parseRate } from "../collectors/src/parse/common";
import { storeHistoricalCard } from "../collectors/src/store";

const ROOT = path.join(__dirname, "..");
const SOURCE_URL =
  "https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/historic-saving-account-interest-rates.pdf";
const ARCHIVE_PATH = "/agent/workspace/private/archives/hdfc/historic-saving-account-interest-rates.pdf";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker)";

const L50 = 50_00_000; // Rs 50 lakh
const CR500 = 500 * 1_00_00_000; // Rs 500 crore
const CR1000 = 1000 * 1_00_00_000; // Rs 1,000 crore

interface Row {
  fromRaw: string;
  toRaw: string | null; // null = "onwards" (still open, no printed end date)
  slabs: Array<[number, number | null, number]>; // [balanceMin, balanceMax, rate]
  note?: string;
}

// Transcribed directly from the rendered PDF page (see file header comment).
const ROWS: Row[] = [
  { fromRaw: "01/03/2003", toRaw: "02/05/2011", slabs: [[0, L50, 3.5], [L50, null, 3.5]] },
  { fromRaw: "03/05/2011", toRaw: "18/08/2017", slabs: [[0, L50, 4.0], [L50, null, 4.0]] },
  { fromRaw: "19/08/2017", toRaw: "06/01/2019", slabs: [[0, L50, 3.5], [L50, null, 4.0]] },
  {
    fromRaw: "07/01/2019",
    toRaw: "14/04/2020",
    slabs: [[0, L50, 3.5], [L50, CR500, 4.0]],
    note: "The source prints the ≥ Rs 500 crore tier for this period as \"RBI Repo Rate + 2bps\", not a fixed percentage, so that tier is omitted here rather than computed or guessed.",
  },
  {
    fromRaw: "15/04/2020",
    toRaw: "10/06/2020",
    slabs: [[0, L50, 3.25], [L50, CR500, 3.75]],
    note: "The source prints the ≥ Rs 500 crore tier for this period as \"RBI Repo Rate + 2bps\", not a fixed percentage, so that tier is omitted here rather than computed or guessed.",
  },
  { fromRaw: "11/06/2020", toRaw: "01/02/2022", slabs: [[0, L50, 3.0], [L50, null, 3.5]] },
  { fromRaw: "02/02/2022", toRaw: "05/04/2022", slabs: [[0, L50, 3.0], [L50, CR1000, 3.5], [CR1000, null, 4.5]] },
  { fromRaw: "06/04/2022", toRaw: "11/04/2025", slabs: [[0, L50, 3.0], [L50, null, 3.5]] },
  { fromRaw: "12/04/2025", toRaw: "09/06/2025", slabs: [[0, L50, 2.75], [L50, null, 3.25]] },
  { fromRaw: "10/06/2025", toRaw: "23/06/2025", slabs: [[0, null, 2.75]] },
  { fromRaw: "24/06/2025", toRaw: null, slabs: [[0, null, 2.5]] },
];

async function download(): Promise<void> {
  if (existsSync(ARCHIVE_PATH) && statSync(ARCHIVE_PATH).size > 0) {
    console.log(`using cached download: ${ARCHIVE_PATH}`);
    return;
  }
  mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  console.log(`fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL, { headers: { "user-agent": UA, accept: "application/pdf,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching HDFC savings PDF`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(ARCHIVE_PATH, bytes);
  console.log(`saved ${bytes.length} bytes -> ${ARCHIVE_PATH}`);
}

async function main() {
  await download();
  const today = todayIST();

  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  const rejectedDetails: string[] = [];
  const dates: string[] = [];

  for (const row of ROWS) {
    const effectiveFrom = parseDate(row.fromRaw);
    const observedTo = row.toRaw ? parseDate(row.toRaw) : null;
    if (!effectiveFrom || (row.toRaw && !observedTo)) {
      console.log(`SKIP row "${row.fromRaw}"..${row.toRaw}: could not read a date`);
      continue;
    }
    const slabs: SavingsSlab[] = [];
    let ok = true;
    for (const [min, max, rateRaw] of row.slabs) {
      const rate = parseRate(String(rateRaw));
      if (rate === null) {
        ok = false;
        console.log(`SKIP row "${row.fromRaw}": unreadable rate ${rateRaw}`);
        break;
      }
      slabs.push({ balanceMin: min, balanceMax: max, rate, residency: "resident" });
    }
    if (!ok) continue;

    const card: RateCard = {
      bankSlug: "hdfc-bank",
      product: "savings",
      effectiveFrom,
      observedAt: today,
      observedFrom: effectiveFrom,
      observedTo,
      sourceType: "bank_archive",
      sourceUrl: SOURCE_URL,
      confidence: "high",
      rows: [],
      savingsSlabs: slabs,
      slabMethod: "unknown",
      notes: row.note ? [row.note] : undefined,
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
  console.log("\n=== HDFC Bank savings backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
  if (dates.length > 0) console.log(`date span: ${dates[0]} .. ${dates[dates.length - 1]}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected by validation:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
