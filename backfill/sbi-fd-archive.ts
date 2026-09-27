/**
 * SBI retail term-deposit history — loads backfill/intermediate/sbi-fd-rows.json (produced by
 * `python3 backfill/sbi-fd-archive.py`) and turns each revision column into a historical FD
 * RateCard, stored via storeHistoricalCard.
 *
 * Source: "Domestic Term Deposit Interest Rate: Historical Data" on sbi.bank.in
 *   https://sbi.bank.in/web/interest-rates/interest-rates/deposit-rates
 * Coverage: General Public retail domestic term deposits, 04.01.2008–15.07.2025 (91 revisions
 * after de-duplicating the workbook's "Duration" bucket-definition columns).
 *
 * Caveats printed by the source itself (see backfill/README.md for the full list):
 *  - General Public only — SBI's archive has no senior-citizen column.
 *  - The retail/bulk amount threshold (₹15 lakh → ₹1 crore → ₹2 crore → ₹3 crore) is only
 *    annotated on some columns; where the workbook does not print it we record amountMin 0 /
 *    amountMax null and say so in the card's notes, per the project's no-guessing rule.
 *  - Two revisions share the effective date 2017-04-29 in the source (SBI restated the same
 *    date under a revised bucket structure); both are kept as separate cards since their rows
 *    genuinely differ.
 *
 * Run: npx tsx backfill/sbi-fd-archive.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, RateRow } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { findEffectiveDate, parseDate, parseRate } from "../collectors/src/parse/common";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const ROOT = path.join(__dirname, "..");
const INTERMEDIATE_PATH = path.join(__dirname, "intermediate", "sbi-fd-rows.json");
const SOURCE_URL =
  "https://sbi.bank.in/documents/26242/65574/15122025_Historical+Retail+Term+Deposit+Rates.xlsx/f21a3209-472b-b629-80e8-e558982d4000?t=1765802246329";

interface RawRow {
  tenureLabelRaw: string;
  rate: number;
}
interface RawRevision {
  column: number;
  effectiveDateIso: string | null;
  effectiveDateRaw: string | null;
  amountAnnotationRaw: string | null;
  rows: RawRow[];
}
interface Intermediate {
  sourceUrl: string;
  revisions: RawRevision[];
  skippedColumns: Array<{ column: number; header: string | null; reason: string }>;
}

// The workbook writes a handful of tenure buckets as shorthand that `parseTenure` cannot read
// on its own (no unit words, or an inherited-unit trap — see backfill/README.md). Verified by
// cross-referencing the SAME bucket's full label elsewhere in the SAME workbook (never guessed):
// "46-90"/"91 -180" sit between "15 days to 45 days" and "181 days to less than 1 year" in the
// 2008-era block, and "181 to < 1 year" is spelled out in full as "181 days to less than 1 year"
// in the very next column's own Duration block.
const LABEL_FIXUPS: Record<string, string> = {
  "46-90": "46 days to 90 days",
  "91 -180": "91 days to 180 days",
  "181 to < 1 year": "181 days to less than 1 year",
};

// `parseAmountBand` anchors its "exclusive lower bound" check at the start of the string, so a
// bare leading "<" (as in SBI's own "<Rs2cr" annotation) is never recognised. Spelling it out as
// "below" is a mechanical substitution — not a guess — since "<" and "below" mean the same thing
// here and "below Rs2cr" is exactly the phrasing `parseAmountBand` already understands elsewhere.
function normalizeAmountAnnotation(raw: string): string {
  return raw.replace(/^\s*</, "below ").trim();
}

function resolveEffectiveDate(rev: RawRevision): string | null {
  if (rev.effectiveDateIso) return rev.effectiveDateIso;
  if (!rev.effectiveDateRaw) return null;
  return findEffectiveDate(rev.effectiveDateRaw) ?? parseDate(rev.effectiveDateRaw);
}

function main() {
  const data = JSON.parse(readFileSync(INTERMEDIATE_PATH, "utf8")) as Intermediate;
  const today = todayIST();

  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  let cardsSkipped = 0;
  let rowsSkipped = 0;
  const rejectedDetails: string[] = [];
  const dates: string[] = [];

  for (const rev of data.revisions) {
    const effectiveFrom = resolveEffectiveDate(rev);
    if (!effectiveFrom) {
      cardsSkipped++;
      console.log(`SKIP column ${rev.column}: could not read an effective date from ${JSON.stringify(rev.effectiveDateRaw)}`);
      continue;
    }

    const notes: string[] = [];
    let amountMin = 0;
    let amountMax: number | null = null;
    if (rev.amountAnnotationRaw) {
      const band = parseAmountBand(normalizeAmountAnnotation(rev.amountAnnotationRaw));
      if (band) {
        amountMin = band.min;
        amountMax = band.max;
      } else {
        notes.push(`The workbook's amount annotation "${rev.amountAnnotationRaw}" for this revision could not be parsed; amount band left unset (0 to no cap).`);
      }
    } else {
      notes.push(
        "SBI's archive does not print the retail/bulk amount threshold for this revision. The threshold changed several times over 2008–2025 (₹15 lakh → ₹1 crore → ₹2 crore → ₹3 crore); no amount band is assumed here.",
      );
    }

    const rows: RateRow[] = [];
    for (const r of rev.rows) {
      const label = LABEL_FIXUPS[r.tenureLabelRaw] ?? r.tenureLabelRaw;
      const tenure = parseTenure(label);
      if (!tenure) {
        rowsSkipped++;
        console.log(`  SKIP row (column ${rev.column}, ${effectiveFrom}): unreadable tenure "${r.tenureLabelRaw}"`);
        continue;
      }
      const rate = parseRate(String(r.rate));
      if (rate === null) {
        rowsSkipped++;
        console.log(`  SKIP row (column ${rev.column}, ${effectiveFrom}): unreadable rate "${r.rate}" for "${r.tenureLabelRaw}"`);
        continue;
      }
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: r.tenureLabelRaw,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin,
        amountMax,
        customer: "general",
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    }

    if (rows.length === 0) {
      cardsSkipped++;
      console.log(`SKIP column ${rev.column} (${effectiveFrom}): no readable rows`);
      continue;
    }

    const card: RateCard = {
      bankSlug: "sbi",
      product: "fd",
      effectiveFrom,
      observedAt: today,
      sourceType: "bank_archive",
      sourceUrl: SOURCE_URL,
      confidence: "high",
      rows,
      notes: notes.length > 0 ? notes : undefined,
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
      rejectedDetails.push(`${effectiveFrom} (column ${rev.column}): ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  dates.sort();
  console.log("\n=== SBI FD (retail, general public) backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected} cards_skipped=${cardsSkipped} rows_skipped=${rowsSkipped}`);
  console.log(`workbook-reported skipped columns: ${data.skippedColumns.length}`);
  if (dates.length > 0) console.log(`date span: ${dates[0]} .. ${dates[dates.length - 1]}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
