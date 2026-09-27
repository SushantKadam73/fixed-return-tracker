/**
 * SBI savings-account rate history — downloads SBI's own one-page PDF and turns each row into
 * a historical savings RateCard, stored via storeHistoricalCard.
 *
 * Source: "Savings bank Interest Rate: Historical Data" on sbi.bank.in
 *   https://sbi.bank.in/web/interest-rates/interest-rates/deposit-rates
 * Coverage (as printed): 01.04.2000–15.10.2022 (9 dated revisions): flat rate through
 * 31.07.2017, then balance-tiered from 01.05.2019 onward. The PDF itself has not been updated
 * since 15.10.2022 even though SBI's savings rate has changed since (the live page shows later
 * revisions only inline, not appended to this PDF).
 *
 * Why pdftotext, not unpdf: this PDF is a single small table but two rows ("03.05.2011" and
 * "31.07.2017") were rendered with the interest cell spanning both the "Interest" and "Balance"
 * columns ("3.50 % to 4.00 %") and an EMPTY Balance cell — i.e. the source itself does not print
 * a balance threshold for whichever tiering (if any) applied on those two dates. unpdf's
 * (pdf.js) content-stream text order scrambles this table's row-spanned "Date" cells in a way
 * that cannot be reassembled without guessing which value pairs with which date; `pdftotext
 * -layout` (already installed on this box) reconstructs the same table by X/Y position and
 * reproduces it exactly as printed, so we shell out to it instead. Verified by rendering the
 * PDF to an image and comparing pixel-for-pixel with `pdftotext -layout`'s output.
 *
 * Because those two rows give no printed balance boundary, we do NOT invent one — both are
 * skipped and logged, per the project's no-guessing rule.
 *
 * Run: npx tsx backfill/sbi-savings-archive.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, SavingsSlab } from "../lib/domain";
import { todayIST } from "../lib/format";
import { parseAmountBand } from "../collectors/src/parse/amount";
import { parseDate, parseRate } from "../collectors/src/parse/common";
import { storeHistoricalCard } from "../collectors/src/store";

const ROOT = path.join(__dirname, "..");
const SOURCE_URL =
  "https://sbi.bank.in/documents/26242/65574/211022-SAV+INT+HIST.pdf/d898ad9a-28b3-b74a-77e9-b0b5d6907bfa?t=1666333463298";
const ARCHIVE_PATH = "/agent/workspace/private/archives/sbi/savings-bank-interest-rate-historical.pdf";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker)";

const DATE_RE = /^(\d{2}\.\d{2}\.\d{4})$/;
const FLAT_RE = /^(\d{2}\.\d{2}\.\d{4})\s+([\d.]+)\s*%\s*$/;
const AMBIGUOUS_RE = /^(\d{2}\.\d{2}\.\d{4})\s+([\d.]+)\s*%\s*to\s*([\d.]+)\s*%\s*$/i;
const VALUE_LABEL_RE = /^([\d.]+)\s*%\s*(.+)$/;

interface Revision {
  effectiveFrom: string;
  slabs: SavingsSlab[];
}

async function download(): Promise<void> {
  if (existsSync(ARCHIVE_PATH) && statSync(ARCHIVE_PATH).size > 0) {
    console.log(`using cached download: ${ARCHIVE_PATH}`);
    return;
  }
  mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  console.log(`fetching ${SOURCE_URL}`);
  const res = await fetch(SOURCE_URL, { headers: { "user-agent": UA, accept: "application/pdf,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching SBI savings PDF`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(ARCHIVE_PATH, bytes);
  console.log(`saved ${bytes.length} bytes -> ${ARCHIVE_PATH}`);
}

function extractLayoutText(): string {
  return execFileSync("pdftotext", ["-layout", ARCHIVE_PATH, "-"], { encoding: "utf8" });
}

function parseRevisions(text: string): { revisions: Revision[]; skipped: string[] } {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const revisions: Revision[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const flat = FLAT_RE.exec(line);
    if (flat) {
      const effectiveFrom = parseDate(flat[1]);
      const rate = parseRate(flat[2]);
      if (!effectiveFrom || rate === null) {
        skipped.push(`unreadable flat row: "${line}"`);
        continue;
      }
      revisions.push({ effectiveFrom, slabs: [{ balanceMin: 0, balanceMax: null, rate, residency: "resident" }] });
      continue;
    }

    const ambiguous = AMBIGUOUS_RE.exec(line);
    if (ambiguous) {
      skipped.push(
        `row "${line}" gives two values but the source's Balance column is blank for this date — no tier boundary is printed, so this revision is skipped rather than guessed`,
      );
      continue;
    }

    const bareDate = DATE_RE.exec(line);
    if (bareDate) {
      const effectiveFrom = parseDate(bareDate[1]);
      const before = VALUE_LABEL_RE.exec((lines[i - 1] ?? "").trim());
      const after = VALUE_LABEL_RE.exec((lines[i + 1] ?? "").trim());
      if (!effectiveFrom || !before || !after) {
        skipped.push(`row for date "${line}" is missing one of its two tier lines`);
        continue;
      }
      const slabs: SavingsSlab[] = [];
      let ok = true;
      for (const m of [before, after]) {
        const rate = parseRate(m[1]);
        const band = parseAmountBand(m[2]);
        if (rate === null || !band) {
          skipped.push(`row for date "${line}": could not read tier "${m[0]}"`);
          ok = false;
          continue;
        }
        slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" });
      }
      if (ok && slabs.length === 2) revisions.push({ effectiveFrom, slabs });
      continue;
    }
    // Everything else (headings, bare "value + balance label" lines already consumed via their
    // neighbouring date line, blank lines, the trailing form-feed) is not a revision on its own.
  }
  return { revisions, skipped };
}

async function main() {
  await download();
  const text = extractLayoutText();
  const { revisions, skipped } = parseRevisions(text);
  const today = todayIST();

  let inserted = 0;
  let unchanged = 0;
  let rejected = 0;
  const rejectedDetails: string[] = [];
  const dates: string[] = [];

  for (const rev of revisions) {
    const card: RateCard = {
      bankSlug: "sbi",
      product: "savings",
      effectiveFrom: rev.effectiveFrom,
      observedAt: today,
      sourceType: "bank_archive",
      sourceUrl: SOURCE_URL,
      confidence: "high",
      rows: [],
      savingsSlabs: rev.slabs,
      slabMethod: "unknown",
    };
    const result = storeHistoricalCard(ROOT, card);
    if (result.outcome === "inserted") {
      inserted++;
      dates.push(rev.effectiveFrom);
    } else if (result.outcome === "unchanged") {
      unchanged++;
      dates.push(rev.effectiveFrom);
    } else {
      rejected++;
      rejectedDetails.push(`${rev.effectiveFrom}: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }

  dates.sort();
  console.log("\n=== SBI savings backfill summary ===");
  console.log(`inserted=${inserted} unchanged=${unchanged} rejected=${rejected}`);
  if (dates.length > 0) console.log(`date span: ${dates[0]} .. ${dates[dates.length - 1]}`);
  if (skipped.length > 0) {
    console.log(`skipped (unreadable/ambiguous, logged not guessed): ${skipped.length}`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (rejectedDetails.length > 0) {
    console.log("Rejected by validation:");
    for (const d of rejectedDetails) console.log(`  ${d}`);
  }
}

main();
