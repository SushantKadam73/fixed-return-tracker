/**
 * HDFC Bank retail FD rate history (below the bank's bulk threshold) — downloads HDFC's own
 * "Historic Rates" PDF and turns each dated column into a historical FD RateCard.
 *
 * Source: "Historic Savings/FD Rates" hub on hdfc.bank.in
 *   found via: https://www.hdfc.bank.in/interest-rates
 *   file: https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/Historical-FD-Rates-Less-than-Rs-3-Crs.pdf
 * Coverage (as printed): General Public only, 30-Jul-2010 to 06-Mar-2026. The bank's own
 * "retail" amount threshold changes within the file itself — printed as a heading before each
 * run of dated columns ("Less than 1 Cr" until 2018, "Less Than 2 Cr" from 2019 onward) — and is
 * read with parseAmountBand rather than assumed.
 *
 * Extraction notes (see backfill/README.md for the full write-up):
 *  - The PDF's own text layout wraps long tenure labels ("91 Days to less than 6 months 1
 *    day") onto a second line whose first word is the stray "day"/"days"/"month(s)"/"year(s)".
 *    We rejoin those before parsing; every other wrap in this file follows the same pattern.
 *  - Header dates sometimes wrap as "26-Aug-" + "16" across two text lines; we rejoin those too.
 *    A few dates are printed as bare 2-digit years ("26-Aug-16"); parseDate needs a 4-digit
 *    year for month-name dates, so we expand YY -> 20YY before calling it (HDFC's own file only
 *    spans 2010-2026, so this expansion is unambiguous).
 *  - A handful of rows (see the printed "SKIPPED" lines) do not resolve to exactly one rate per
 *    dated column even after the above fixes — the source's own text extraction genuinely
 *    scatters a few cells for those rows across stray lines in a way that cannot be
 *    reassembled without guessing which fragment belongs to which column. Those rows are
 *    skipped and logged rather than guessed, per the project's no-guessing rule; every other
 *    row/column in the file parses cleanly.
 *
 * Run: npx tsx backfill/hdfc-fd-archive.ts
 */
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, RateRow } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { parseDate, parseRate } from "../collectors/src/parse/common";
import { parseTenure } from "../collectors/src/parse/tenure";
import { storeHistoricalCard } from "../collectors/src/store";

const ROOT = path.join(__dirname, "..");
const SOURCE_URL =
  "https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/Historical-FD-Rates-Less-than-Rs-3-Crs.pdf";
const ARCHIVE_PATH = "/agent/workspace/private/archives/hdfc/historical-fd-rates-less-than-3cr.pdf";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker)";

const DATE_TOKEN = /\d{1,2}-(?:[A-Za-z]{3}|\d{1,2})-\d{2,4}/;
const DATE_TOKEN_G = new RegExp(DATE_TOKEN.source, "g");
const CONT_WORD = /^(day|days|month|months|year|years)\b/i;
const VALUE_TOKEN = /^(-|\d+(?:\.\d+)?%)$/;

interface Block {
  title: string;
  dates: string[];
  rows: Array<{ label: string; values: string[] }>;
  skipped: string[];
}

async function download(): Promise<Uint8Array> {
  if (existsSync(ARCHIVE_PATH) && statSync(ARCHIVE_PATH).size > 0) {
    console.log(`using cached download: ${ARCHIVE_PATH}`);
    return new Uint8Array(readFileSync(ARCHIVE_PATH));
  }
  mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  console.log(`fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL, { headers: { "user-agent": UA, accept: "application/pdf,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching HDFC FD PDF`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(ARCHIVE_PATH, bytes);
  console.log(`saved ${bytes.length} bytes -> ${ARCHIVE_PATH}`);
  return bytes;
}

async function extractRawText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/** "26-Aug-\n16" -> "26-Aug-16": the PDF wraps a date's year onto the next text line. */
function fixWrappedDates(raw: string): string {
  return raw.replace(/(\d{1,2}-[A-Za-z]{3}-)\s*\n\s*(\d{2,4})/g, "$1$2");
}

/** Rejoin a wrapped tenure label's stray trailing word ("day"/"days"/"month(s)"/"year(s)"). */
function mergeContinuationLines(raw: string): string[] {
  const rawLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "Classification - Internal");
  const merged: string[] = [];
  for (const line of rawLines) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && CONT_WORD.test(line) && !/^\d/.test(line)) {
      merged[merged.length - 1] = `${prev} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  let carryTitle = "";
  while (i < lines.length) {
    if (!DATE_TOKEN.test(lines[i]) || /%/.test(lines[i])) {
      i++;
      continue;
    }
    const dates: string[] = [];
    let title = "";
    let first = true;
    while (i < lines.length && DATE_TOKEN.test(lines[i]) && !/%/.test(lines[i])) {
      const matches = [...lines[i].matchAll(DATE_TOKEN_G)];
      if (first) {
        title = lines[i].slice(0, matches[0].index).trim();
        first = false;
      }
      for (const m of matches) dates.push(m[0]);
      i++;
    }
    if (title) carryTitle = title;
    while (i < lines.length && !(/^\d/.test(lines[i]) && /%/.test(lines[i]))) i++;

    const rows: Block["rows"] = [];
    const skipped: string[] = [];
    while (i < lines.length && /^\d/.test(lines[i]) && /%/.test(lines[i])) {
      const tokens = lines[i]
        .replace(/,$/, "")
        .split(/\s+/)
        .map((t) => t.replace(/,$/, ""));
      const n = dates.length;
      const values = tokens.slice(tokens.length - n);
      const label = tokens
        .slice(0, tokens.length - n)
        .join(" ")
        .trim();
      const clean = tokens.length > n && label.length > 0 && values.every((v) => VALUE_TOKEN.test(v));
      if (clean) rows.push({ label, values });
      else skipped.push(lines[i]);
      i++;
    }
    blocks.push({ title: carryTitle, dates, rows, skipped });
  }
  return blocks;
}

/** HDFC prints some header dates with a 2-digit year ("26-Aug-16"); parseDate needs 4 digits
 * for a month-name date. Expanding YY -> 20YY is unambiguous for a 2010-2026 file. */
function toIsoDate(token: string): string | null {
  const expanded = /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test(token) ? token.replace(/-(\d{2})$/, "-20$1") : token;
  return parseDate(expanded);
}

async function main() {
  const bytes = await download();
  const raw = await extractRawText(bytes);
  const lines = mergeContinuationLines(fixWrappedDates(raw));
  const blocks = parseBlocks(lines);

  const today = todayIST();
  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  let rowsSkipped = 0;
  const rejectedDetails: string[] = [];
  const allDates: string[] = [];

  for (const block of blocks) {
    const band = parseAmountBand(block.title);
    if (!band) console.log(`WARN: could not read an amount band from title "${block.title}"; defaulting to 0..no cap`);
    rowsSkipped += block.skipped.length;
    for (const s of block.skipped) console.log(`  SKIP row in block "${block.title}" (${block.dates[0]}..${block.dates.at(-1)}): "${s}"`);

    // One card per dated column: gather every row's value for that column.
    for (let col = 0; col < block.dates.length; col++) {
      const effectiveFrom = toIsoDate(block.dates[col]);
      if (!effectiveFrom) {
        console.log(`  SKIP column "${block.dates[col]}": could not read a date`);
        continue;
      }
      const rows: RateRow[] = [];
      for (const row of block.rows) {
        const raw = row.values[col];
        if (raw === "-") continue; // explicitly "not applicable" for this column, not a missing read
        const tenure = parseTenure(row.label);
        if (!tenure) {
          console.log(`  SKIP row "${row.label}" (${effectiveFrom}): unreadable tenure`);
          continue;
        }
        const rate = parseRate(raw.replace(/%$/, ""));
        if (rate === null) {
          console.log(`  SKIP row "${row.label}" (${effectiveFrom}): unreadable rate "${raw}"`);
          continue;
        }
        rows.push({
          tenureMinDays: tenure.minDays,
          tenureMaxDays: tenure.maxDays,
          tenureLabel: row.label,
          special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
          amountMin: band?.min ?? 0,
          amountMax: band?.max ?? null,
          customer: "general",
          residency: "resident",
          callable: true,
          payout: null,
          rate,
        });
      }
      if (rows.length === 0) continue;

      const card: RateCard = {
        bankSlug: "hdfc-bank",
        product: "fd",
        effectiveFrom,
        observedAt: today,
        sourceType: "bank_archive",
        sourceUrl: SOURCE_URL,
        confidence: "high",
        rows,
        notes: band ? undefined : [`Could not read the amount band from the printed heading "${block.title}"; amount band left unset (0 to no cap).`],
      };
      const result = storeHistoricalCard(ROOT, card);
      if (result.outcome === "inserted") {
        inserted++;
        allDates.push(effectiveFrom);
      } else if (result.outcome === "unchanged") {
        unchanged++;
        allDates.push(effectiveFrom);
      } else {
        rejected++;
        rejectedDetails.push(`${effectiveFrom}: ${result.issues.map((x) => x.message).join("; ")}`);
      }
    }
  }

  allDates.sort();
  console.log("\n=== HDFC Bank FD (< current bulk threshold, general public) backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected} rows_skipped=${rowsSkipped}`);
  if (allDates.length > 0) console.log(`date span: ${allDates[0]} .. ${allDates[allDates.length - 1]}`);
  if (rejectedDetails.length > 0) {
    console.log("Rejected by validation:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
