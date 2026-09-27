/**
 * Axis Bank — axis.bank.in
 * Pages covered:
 *  - Domestic Fixed Deposits (retail <3cr, 3cr-<5cr, and bulk >=5cr with senior sub-bands) — a PDF
 *    linked from the stable "FD Interest Rates" HTML page. The PDF's own filename embeds the
 *    effective date (e.g. "...-26-september-26.pdf") and 404s once superseded, so this adapter
 *    re-discovers the current link from the HTML page's "VIEW RATES" href every run rather than
 *    hardcoding a dated URL (per the survey note for this bank).
 *  - Recurring Deposit interest rates (own HTML table; Axis's RD rates are NOT the same as its FD
 *    rates for the same tenure, so this is read from its own page rather than derived from FD).
 *  - Savings Account balance-slab table (own HTML page; the flagship page at
 *    interest-rates-and-charges only prints a headline range, not slabs).
 *
 * Quirks handled here (not in the shared parsers, so they live in this file):
 *  - The FD PDF writes ranges as "18 Months < 2 years" (a bare "<" with no "to"/"less than").
 *    The shared parseTenure only recognises "<" when preceded by a split keyword, so it silently
 *    misreads these into "1 to X-1 days" ranges. normaliseTenureLabel() rewrites "A < B" into
 *    "A to less than B" first; verified against every retail/bulk row to produce a contiguous
 *    7-3650 day ladder with no gaps or overlaps.
 *  - The FD PDF's bulk tables print 7 amount sub-bands (₹5cr-<25cr, ₹25cr-<50cr, ... ₹1000cr+) but
 *    every row we have seen shows one identical rate across all 6 sub-bands from ₹25cr upward — only
 *    the ₹5cr-<25cr column ever differs. We collapse those 6 into a single "₹25cr and above" row
 *    when they truly match, and throw (never guess) if a future revision makes them diverge.
 *  - RD table header cells use a curly right-quote before the year ("22nd December’2025"); the
 *    shared parseDate needs a space/comma/dash there, so we insert one before parsing.
 */
import type { CustomerType, RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { parseAmountBand } from "../parse/amount";
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter, AdapterContext } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

/** Axis writes "18 Months < 2 years"; parseTenure only understands "<" after a keyword like "less
 * than", so give it one. Checked against every row of the current PDF (see the fixture) and the
 * result is a contiguous 7-3650 day ladder with no gaps or overlaps. */
function normaliseTenureLabel(label: string): string {
  return label.replace(/\s*<\s*/g, " to less than ");
}

function readTenure(label: string): { minDays: number; maxDays: number } {
  const t = parseTenure(normaliseTenureLabel(label));
  if (!t) throw new AdapterError(`cannot read Axis tenure "${label}"`);
  return t;
}

function toRow(label: string, amountMin: number, amountMax: number | null, customer: CustomerType, rate: number): RateRow {
  const t = readTenure(label);
  return {
    tenureMinDays: t.minDays,
    tenureMaxDays: t.maxDays,
    tenureLabel: cleanText(label),
    amountMin,
    amountMax,
    customer,
    residency: "resident",
    callable: true,
    payout: null,
    rate,
  };
}

/** Curly-quote year ("December’2025") confuses parseDate's separator check; give it a plain space. */
function pdfEffectiveDate(captionLine: string): string | null {
  const cleaned = captionLine.replace(/['’]\s*(\d{4})/g, " $1").replace(/.*?(w\.?\s?e\.?\s?f\.?)/i, "");
  return parseDate(cleaned);
}

/** Every data row in the PDF is "<label> <n numbers>" on one line; find the caption line and the
 * text up to the next "Disclaimer" footer, which brackets exactly one table. */
function sectionAfter(text: string, captionRe: RegExp): { caption: string; body: string } {
  const m = captionRe.exec(text);
  if (!m) throw new AdapterError(`Axis FD PDF: section not found (${captionRe})`);
  const from = m.index + m[0].length;
  const rest = text.slice(from);
  const end = /disclaimer/i.exec(rest);
  return { caption: m[0], body: end ? rest.slice(0, end.index) : rest };
}

function rowsWithTrailingNumbers(block: string, n: number): Array<{ label: string; nums: number[] }> {
  const tail = Array.from({ length: n }, () => String.raw`(\d+(?:\.\d+)?)`).join(String.raw`\s+`);
  const re = new RegExp(`^(.+?)\\s+${tail}\\s*$`);
  const out: Array<{ label: string; nums: number[] }> = [];
  for (const raw of block.split(/\n/)) {
    const line = cleanText(raw);
    if (!line) continue;
    const m = re.exec(line);
    if (m) out.push({ label: m[1].trim(), nums: m.slice(2, 2 + n).map(Number) });
  }
  return out;
}

const RETAIL_CAPTION = /Deposits\s*-\s*Less than[^\n]*/i;
const BULK_GENERAL_CAPTION = /Deposits General[^\n]*/i;
const BULK_SENIOR_CAPTION = /Deposits for Senior Citizens[^\n]*/i;

interface AxisPdfData {
  retailEffectiveFrom: string | null;
  retailRows: RateRow[];
  bulkEffectiveFrom: string | null;
  bulkRows: RateRow[];
}

function parseDomesticFdPdf(text: string): AxisPdfData {
  const retail = sectionAfter(text, RETAIL_CAPTION);
  const retailRows: RateRow[] = [];
  const retailData = rowsWithTrailingNumbers(retail.body, 4);
  if (retailData.length === 0) throw new AdapterError("Axis retail FD table: no rows matched in the PDF text");
  for (const r of retailData) {
    const [genLt3, gen3to5, srLt3, sr3to5] = r.nums;
    retailRows.push(toRow(r.label, 0, 3 * CRORE, "general", genLt3));
    retailRows.push(toRow(r.label, 3 * CRORE, 5 * CRORE, "general", gen3to5));
    retailRows.push(toRow(r.label, 0, 3 * CRORE, "senior", srLt3));
    retailRows.push(toRow(r.label, 3 * CRORE, 5 * CRORE, "senior", sr3to5));
  }

  const bulkRows: RateRow[] = [];
  const bulkSections: Array<[CustomerType, RegExp]> = [
    ["general", BULK_GENERAL_CAPTION],
    ["senior", BULK_SENIOR_CAPTION],
  ];
  let bulkEffectiveFrom: string | null = null;
  for (const [customer, captionRe] of bulkSections) {
    const section = sectionAfter(text, captionRe);
    if (customer === "general") bulkEffectiveFrom = pdfEffectiveDate(section.caption);
    const data = rowsWithTrailingNumbers(section.body, 7);
    if (data.length === 0) throw new AdapterError(`Axis bulk ${customer} table: no rows matched in the PDF text`);
    for (const r of data) {
      const [band1, ...rest] = r.nums;
      const restEqual = rest.every((x) => x === rest[0]);
      if (!restEqual) {
        throw new AdapterError(
          `Axis bulk table: the ₹25cr-and-above sub-bands used to print one identical rate per tenure; "${r.label}" now shows different rates across them (${rest.join(", ")}) — adapter needs updating to keep those sub-bands separate`,
        );
      }
      bulkRows.push(toRow(r.label, 5 * CRORE, 25 * CRORE, customer, band1));
      bulkRows.push(toRow(r.label, 25 * CRORE, null, customer, rest[0]));
    }
  }

  return { retailEffectiveFrom: pdfEffectiveDate(retail.caption), retailRows, bulkEffectiveFrom, bulkRows };
}

/** "VIEW RATES" for "Domestic Fixed Deposits" (not "...Plus", the non-callable product). */
const PDF_LINK_RE = /href="([^"]*\/domestic-fixed-deposits-\d[^"]*\.pdf)[^"]*"/i;

function discoverDomesticFdPdfUrl(html: string, baseUrl: string): string {
  const m = PDF_LINK_RE.exec(html);
  if (!m) throw new AdapterError('Axis: "Domestic Fixed Deposits" PDF link not found on the fd-interest-rates page — layout may have changed');
  return new URL(m[1], baseUrl).toString();
}

async function fetchDomesticFdPdf(ctx: AdapterContext): Promise<{ url: string; text: string }> {
  const pdfUrl = discoverDomesticFdPdfUrl(ctx.doc.text, ctx.doc.finalUrl || ctx.source.url);
  const doc = await ctx.fetch(pdfUrl, "pdf");
  return { url: doc.finalUrl || pdfUrl, text: doc.text };
}

const SENIOR_NOTE =
  "Senior-citizen premium varies by tenure (commonly +0.50 percentage points over general, occasionally more at longer tenures) — see the rate table for the exact senior columns. No distinct super-senior (80+) column is published.";

export const axisFd: Adapter = async (ctx) => {
  const { url: pdfUrl, text } = await fetchDomesticFdPdf(ctx);
  const data = parseDomesticFdPdf(text);
  if (!data.retailEffectiveFrom) throw new AdapterError("Axis retail FD: effective date not found in the PDF's table caption");
  const card = makeCard(ctx, "fd", data.retailRows, {
    effectiveFrom: data.retailEffectiveFrom,
    sourceUrl: pdfUrl,
    notes: [SENIOR_NOTE, "Axis's own 'bulk' tables (see fd_bulk) start at ₹5 crore; ₹3 crore-<5 crore is still priced on this retail card."],
  });
  return {
    cards: [card],
    terms: [
      {
        product: "fd",
        bulkThreshold: 5 * CRORE,
        seniorPremium: "Varies by tenure, commonly +0.50 percentage points (see notes)",
        prematurePenalty:
          "Bank may, at its discretion, disallow premature withdrawal of deposits of ₹5 crore and above held by entities other than individuals/HUF (PDF footnote); standard premature-withdrawal penalty rate is not printed on this page.",
      },
    ],
  };
};

export const axisBulk: Adapter = async (ctx) => {
  const { url: pdfUrl, text } = await fetchDomesticFdPdf(ctx);
  const data = parseDomesticFdPdf(text);
  if (!data.bulkEffectiveFrom) throw new AdapterError("Axis bulk FD: effective date not found in the PDF's table caption");
  const card = makeCard(ctx, "fd_bulk", data.bulkRows, {
    effectiveFrom: data.bulkEffectiveFrom,
    sourceUrl: pdfUrl,
    notes: [
      "The ₹25 crore-and-above sub-bands (₹25-50cr, 50-100cr, 100-200cr, 200-500cr, 500-1000cr, 1000cr+) print one identical rate per tenure in the current PDF, so they are combined into a single '₹25cr and above' row; only the ₹5cr-<25cr band is ever distinct.",
    ],
  });
  return { cards: [card] };
};

export const axisRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /recurring deposit interest rates/i.test(headerText(g, 1)), "RD rate table");
  const captionCell = grid.rows.slice(0, 2).flat().find((c) => /recurring deposit interest rates/i.test(c)) ?? "";
  const effectiveFrom = pdfEffectiveDate(captionCell);
  if (!effectiveFrom) throw new AdapterError("Axis RD: effective date not found in the table header");
  const rows = parseTermTable(grid, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  return {
    cards: [
      makeCard(ctx, "rd", rows, {
        effectiveFrom,
        notes: ["Axis prices RD on its own table, not derived from FD — the bank's RD and FD rates differ for the same tenure."],
      }),
    ],
  };
};

export const axisSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /balance slabs/i.test(headerText(g, 1)), "savings balance-slab table");
  const effectiveFrom = findEffectiveDate(grid.context);
  const slabs: SavingsSlab[] = [];
  const notes: string[] = [];
  for (const r of grid.rows.slice(1)) {
    const label = cleanText(r[0] ?? "");
    if (!label) continue;
    const rate = parseRate(r[1] ?? "");
    if (rate === null) {
      notes.push(`"${label}" earns "${cleanText(r[1] ?? "")}" — a floating/formula rate, not a fixed number, so it is not published here as a slab.`);
      continue;
    }
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`Axis savings: cannot read balance slab "${label}"`);
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" });
  }
  if (slabs.length === 0) throw new AdapterError("Axis savings: no numeric balance slab found");
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        // Axis's own text isn't explicit about whole-vs-incremental for the slab structure in
        // general (only that the MIBOR-linked top slab applies to the "entire balance" above it).
        slabMethod: "unknown",
        notes,
      }),
    ],
  };
};
