/**
 * Ujjivan Small Finance Bank — www.ujjivansfb.bank.in (the legacy ujjivansfb.in times out from
 * this sandbox on every attempt — always use the .bank.in domain).
 * Source: the single "interest-rates" hub page, which renders every product as its own
 * `<div id="...">` tab panel (Platina FD, Domestic FD, NRO, RD, NRE, Tax Saver, Bulk Deposit
 * Rates, Savings) each with its own "Below mentioned are the Interest Rates with effective from
 * <date>" caption and its own `<table>` — genuine `<table>` markup, not JS-rendered content, and
 * more current than the bank's own downloadable "Support Interest Rates" PDF at the time this
 * was built (the PDF was still dated 05 Jun 2026; the hub had already moved most tables to
 * 01 Sep 2026), so the hub page is the adapter's source of truth, not the PDF.
 *
 * Quirks:
 *  - Each panel's `id` (e.g. "domestic-fixed-deposits-and-sampoorna-nidhi") is a stable anchor —
 *    `panel()` below scopes both the date text and the table lookup to just that one panel, so a
 *    date meant for one product can never leak onto another (Platina/Domestic/NRO/RD/NRE/Tax
 *    Saver were all "01 Sep 2026" and Savings alone was "05 Jun 2026" when this was built —
 *    genuinely different dates on the same page, not a scraping mistake).
 *  - Domestic FD's "Additional Interest Rate for Senior Citizens 0.50%" is printed as a *row*
 *    inside the rate table itself (not its own column) — `skipRow` keeps it out of
 *    `parseTermTable` (which would otherwise throw trying to read it as a tenure), and it's
 *    recorded as a note rather than computed into new rows, the same treatment the reference SBI
 *    adapter gives text-only premiums. RD's senior addition is prose below its table; same
 *    treatment.
 *  - Platina FD is Ujjivan's non-callable ₹1cr–<₹3cr band (own panel text: "Deposit amount
 *    should be above ₹1 crore to below ₹3 crores") — folded into the "fd" product as
 *    `callable: false` rows, the same way the reference SBI adapter folds in its own
 *    non-callable band.
 *  - Savings slab labels ("> ₹3 lakh to ₹5 lakhs", "> ₹25 Crore") trip up the shared
 *    `parseAmountBand`: its "above X" detection requires `>` to sit at a word boundary, which a
 *    bare `> ` (space after) never satisfies, and its two-number branch doesn't treat a plain
 *    "to Y" as inclusive of Y — either gap would leave a rupee uncovered between slabs.
 *    `savingsBand()` below is a small local reader for this bank's exact phrasing; not a change
 *    to the shared parser.
 *  - The bulk (≥₹3 crore) rates live in a separately-dated PDF whose filename embeds the
 *    publish date (e.g. "bulk_deposit_rates_25_09_26_...pdf") and changes often — `ujjivanSfbBulk`
 *    discovers the current link from the "Bulk Deposit Rates" panel's own "Click here" anchor on
 *    every run via `ctx.fetch`, rather than hard-coding a dated URL.
 */
import * as cheerio from "cheerio";
import type { RateRow } from "../../../lib/domain";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { amountsIn } from "../parse/amount";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard } from "./helpers";

const PANEL_IDS = {
  platina: "platina-fixed-deposit---domestic-&-nr-deposits",
  domesticFd: "domestic-fixed-deposits-and-sampoorna-nidhi",
  rd: "recurring-deposits-and-sampoorna-lakshya",
  bulk: "bulk-deposit-rates",
  savings: "savings-account",
};

function panel($: cheerio.CheerioAPI, id: string): string {
  const el = $(`[id="${id}"]`);
  if (el.length === 0) throw new AdapterError(`interest-rates hub: tab panel not found (id="${id}") — page layout may have changed`);
  return $.html(el) ?? "";
}

/** Each panel states its own date ("Below mentioned are the Interest Rates with effective from
 * <date>"; Savings alone uses "...with effect from <date>") right inside that panel's markup. */
function panelDate(html: string): string | null {
  const m = /(?:effective from|effect from)\s*([^<]{3,40})/i.exec(html);
  return m ? parseDate(m[1]) : null;
}

function panelGrid(html: string, what: string): Grid {
  const g = extractTables(html)[0];
  if (!g) throw new AdapterError(`no table found in the ${what} panel`);
  return g;
}

export const ujjivanSfbFd: Adapter = async (ctx) => {
  const $ = cheerio.load(ctx.doc.text);

  const platinaHtml = panel($, PANEL_IDS.platina);
  const platinaDate = panelDate(platinaHtml);
  if (!platinaDate) throw new AdapterError("no effective date found in the Platina FD panel");
  const platinaRows = parseTermTable(panelGrid(platinaHtml, "Platina FD"), {
    columns: [{ header: /interest rate/i, customer: "general" }],
    amountMin: CRORE + 1, // panel text: "Deposit amount should be above ₹1 crore to below ₹3 crores"
    amountMax: 3 * CRORE,
    callable: false,
  });
  platinaRows.forEach((r) => (r.note = "Platina FD: non-callable, ₹1 crore–<₹3 crore; no senior-citizen addition on this product (bank's own text)"));

  const domesticHtml = panel($, PANEL_IDS.domesticFd);
  const domesticDate = panelDate(domesticHtml);
  if (!domesticDate) throw new AdapterError("no effective date found in the Domestic FD panel");
  const domesticRows = parseTermTable(panelGrid(domesticHtml, "Domestic FD"), {
    columns: [{ header: /interest rate/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    skipRow: /additional interest rate/i, // the 0.50% senior line is printed as a table row, not a column
  });

  const rows: RateRow[] = [...domesticRows, ...platinaRows];
  const notes = ["Domestic FD: resident senior citizens get +0.50% p.a. on every tenure, printed as a line inside the rate table rather than its own column — not published as separate per-tenure numbers, so no senior rows are added here."];
  if (platinaDate !== domesticDate) notes.push(`Platina FD table is dated ${platinaDate}, Domestic FD is dated ${domesticDate} (read independently, not assumed equal)`);

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom: domesticDate, notes });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. on Domestic FD, all tenures; NOT applicable to Platina FD or NRE deposits",
        prematurePenalty: "Platina FD: none permitted (true non-callable, incl. no part-closure)",
      },
    ],
  };
};

export const ujjivanSfbRd: Adapter = async (ctx) => {
  const $ = cheerio.load(ctx.doc.text);
  const html = panel($, PANEL_IDS.rd);
  const effectiveFrom = panelDate(html);
  if (!effectiveFrom) throw new AdapterError("no effective date found in the RD panel");
  const rows = parseTermTable(panelGrid(html, "Recurring Deposit"), { columns: [{ header: /interest rate/i, customer: "general" }], amountMin: 0, amountMax: null, callable: true });
  return {
    cards: [
      makeCard(ctx, "rd", rows, {
        effectiveFrom,
        notes: ["This is Ujjivan's own dedicated RD table (not derived from the FD card). Resident senior citizens (as primary holder) get +0.50% p.a. over this rate per the bank's text below the table; not printed as a column, so not published as separate rows."],
      }),
    ],
  };
};

/** "> ₹3 lakh to ₹5 lakhs" / "> ₹25 Crore" savings-slab labels. The shared `parseAmountBand`
 * requires a word-boundary around a bare `>` (never true when it's followed by a space, as here)
 * and doesn't treat a plain "to Y" as inclusive of Y — either gap would strand a rupee between
 * slabs, so this bank gets its own small band reader. Local-only workaround. */
function savingsBand(label: string): { min: number; max: number | null } {
  const nums = amountsIn(label);
  const t = label.toLowerCase();
  if (/^\s*up to/.test(t)) return { min: 0, max: nums[0] + 1 };
  if (/^\s*>/.test(t)) return nums.length >= 2 ? { min: nums[0] + 1, max: nums[1] + 1 } : { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised savings slab label "${label}"`);
}

export const ujjivanSfbSavings: Adapter = async (ctx) => {
  const $ = cheerio.load(ctx.doc.text);
  const html = panel($, PANEL_IDS.savings);
  const effectiveFrom = panelDate(html);
  if (!effectiveFrom) throw new AdapterError("no effective date found in the savings panel");
  const grid = panelGrid(html, "Savings Account");

  const slabs = grid.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    const band = savingsBand(r[0] ?? "");
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs read");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: "incremental", // bank's own worked example (support-rates PDF): ₹3,20,000 earns 2.50% on ₹3,00,000 and 3.00% on the remaining ₹20,000
        notes: ["The bank's downloadable rate-card PDF states these rates apply to domestic and non-resident (NRO/NRE) savings accounts alike; this page doesn't repeat that distinction, so only resident slabs are published here."],
      }),
    ],
  };
};

const BULK_BANDS = [
  { min: 3 * CRORE, max: 5 * CRORE },
  { min: 5 * CRORE, max: 20 * CRORE },
  { min: 20 * CRORE, max: 50 * CRORE },
  { min: 50 * CRORE, max: null as number | null },
];
const BULK_ROW = /^(.+\S)\s+(\d{1,2}\.\d{1,2})\s+(\d{1,2}\.\d{1,2})\s+(\d{1,2}\.\d{1,2})\s+(\d{1,2}\.\d{1,2})$/;

function readBulkTable(text: string, callable: boolean): RateRow[] {
  const rows: RateRow[] = [];
  for (const rawLine of text.split("\n")) {
    const m = BULK_ROW.exec(cleanText(rawLine));
    if (!m) continue; // the leftover column-header text, or blank/footer lines
    const tenure = parseTenure(m[1]);
    if (!tenure) continue;
    BULK_BANDS.forEach((band, i) => {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: m[1],
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate: Number(m[2 + i]),
      });
    });
  }
  return rows;
}

/** Bulk (≥₹3 crore) deposit rates. The PDF's filename and internal date change on every
 * revision — the current link is discovered from the stable hub page's own "Bulk Deposit Rates"
 * panel on every run, per the task brief, rather than hard-coded. */
export const ujjivanSfbBulk: Adapter = async (ctx) => {
  const $ = cheerio.load(ctx.doc.text);
  const html = panel($, PANEL_IDS.bulk);
  const href = cheerio.load(html)("a[href]").first().attr("href");
  if (!href) throw new AdapterError("Bulk Deposit Rates panel has no PDF link");
  const pdfUrl = new URL(href, ctx.doc.finalUrl || ctx.source.url).toString();

  const pdf = await ctx.fetch(pdfUrl, "pdf");
  const dateMatch = /FD\s*(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(pdf.text) ?? /\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b/.exec(pdf.text);
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  if (!effectiveFrom) throw new AdapterError("could not read the bulk-deposit PDF's date");

  const parts = pdf.text.split(/tenor buckets/i).slice(1); // first chunk is the leading disclaimer text
  if (parts.length < 2) throw new AdapterError(`expected a Callable and a Non-Callable table in the bulk PDF, found ${parts.length} section(s)`);

  const rows = [...readBulkTable(parts[0], true), ...readBulkTable(parts[1], false)];
  if (rows.length === 0) throw new AdapterError("no bulk-deposit rows parsed from the PDF text");

  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        sourceUrl: pdfUrl,
        notes: [`Link discovered from the stable interest-rates hub page (${ctx.source.url}); the PDF's own filename/date changes on every revision.`],
      }),
    ],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, other: ["Callable and Non-Callable rates differ; both are published as separate rows here (callable: true/false)."] }],
  };
};
