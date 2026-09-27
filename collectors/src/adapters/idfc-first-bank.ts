/**
 * IDFC FIRST Bank — idfcfirst.bank.in
 *
 * Every rate table lives in a PDF whose file name embeds its effective date (e.g.
 * "Interest-Rates-on-Retail-Deposits-1st-September-2026.pdf") and which simply stops being
 * linked — not redirected or deleted — the moment a newer one is published (an older, already
 * superseded retail PDF was still fetchable at its old dated URL during this survey). A scraper
 * that hardcodes a PDF URL will silently go stale, so every adapter here starts from the
 * "Interest Rates" index page (https://www.idfcfirst.bank.in/interest-rate) and re-discovers
 * the current PDF link each run.
 *
 * The index page renders each product's "Read" button as `<a class="... sa-interest-rate-pdf"
 * data-gtm-clicktext="<human label incl. effective date>" href="<dated pdf>">`. That class name
 * is a stable hook; the dated href/label text is not. One label in the wild
 * (`data-gtm-clicktext="Bulk Deposit Interest Rate (Domestic, NRE, NRO) >=Rs. 3 Crores..."`)
 * contains a raw, un-escaped `>` inside the quoted attribute value — perfectly valid HTML (a
 * `>` inside a quoted attribute doesn't end the tag), but it breaks a naive `<a[^>]*>` regex,
 * which stops at that `>` as if it were the tag's own close. We use cheerio's real HTML parser
 * (already a project dependency) instead of hand-rolled regex to avoid that trap.
 *
 * Retail Term Deposits PDF bundles THREE cards in one document: FD < ₹3 crore (general +
 * senior), a "Tax Saver Deposit" 5-year row, a "Green Deposits" 375-day row, and — after all
 * of that — an explicit Recurring Deposit table (general + senior). RD is read straight from
 * that table, not derived from FD.
 *
 * Bulk Deposits PDF covers ₹3 crore–₹27.50 crore in two halves (non-callable, then callable),
 * each split into four amount sub-bands (3–5cr, 5–10cr, 10–15cr, 15–27.5cr). Amounts above
 * ₹27.50 crore are a further two sections in the same PDF with ten narrower sub-bands each and
 * a less regular layout (abbreviated "crs." and inline "<=" amount ranges); not parsed here —
 * flagged as a gap rather than guessed, since so few depositors reach that size.
 *
 * Savings Deposits PDF explicitly says interest is "calculated on a progressive basis" and
 * gives a worked example ("balance ... Rs. 10 lakhs ... 2.50% p.a. on Rs. 3 lakhs and 7.00%
 * p.a. on remaining Rs. 7 lakhs") — that is the domain model's "incremental" method, not
 * "whole", even though the bank's own word for it is "progressive".
 */
import * as cheerio from "cheerio";
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { parseDate } from "../parse/common";
import { parseTenure } from "../parse/tenure";
import type { Adapter, AdapterContext, FetchedDoc } from "../types";
import { AdapterError, CRORE, LAKH, makeCard } from "./helpers";

interface RateLink {
  label: string;
  href: string;
}

/** The index page's "Read" buttons for every product's current dated PDF (see file header). */
function findRateLinks(html: string): RateLink[] {
  const $ = cheerio.load(html);
  return $("a.sa-interest-rate-pdf")
    .toArray()
    .map((el) => ({ label: $(el).attr("data-gtm-clicktext") ?? "", href: $(el).attr("href") ?? "" }))
    .filter((l) => l.label && l.href);
}

async function fetchLinkedPdf(ctx: AdapterContext, links: RateLink[], match: RegExp, what: string): Promise<FetchedDoc> {
  // Some "sa-interest-rate-pdf" buttons on this page link to an HTML page, not a PDF, for the
  // same product (e.g. a plain "Savings Account Interest Rate" link sits right next to the
  // "NRI Savings Account..." one that actually points at the PDF) — restrict to PDF hrefs here
  // so label matching alone can't accidentally pick the HTML link.
  const link = links.find((l) => match.test(l.label) && /\.pdf(?:$|[?#])/i.test(l.href));
  if (!link) throw new AdapterError(`no "${what}" link (matching ${match}) found on the interest-rate index page`);
  const url = new URL(link.href, ctx.doc.finalUrl).toString();
  return ctx.fetch(url, "pdf");
}

/** One row of tenure label + N trailing "X.XX%" values, as the PDF text extracts them
 * (each row lands on its own line; multi-line wrapped headers do not match this and are
 * parsed separately for their amount bands). */
function parseRateRows(text: string, columns: number): Array<{ label: string; rates: number[] }> {
  const re = new RegExp(`^(.+?)\\s+((?:\\d+(?:\\.\\d+)?%\\s*){${columns}})$`);
  const out: Array<{ label: string; rates: number[] }> = [];
  for (const raw of text.split("\n")) {
    const m = re.exec(raw.trim());
    if (!m) continue;
    out.push({ label: m[1].trim(), rates: m[2].trim().split(/\s+/).map((s) => Number(s.replace("%", ""))) });
  }
  return out;
}

/** Handles both date orders the bank uses: "w.e.f. 1st September 2026" (retail/RD/savings
 * PDFs) and "(effective September 09, 2026)" (bulk PDF, US month-first order). */
function effectiveDateFrom(text: string): string | null {
  const m = /(?:w\.e\.f\.?|effective(?:\s+from)?)\s*[:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[a-z]+[,\s]+[0-9]{4}|[a-z]+\s+[0-9]{1,2},?\s*[0-9]{4})/i.exec(text);
  return m ? parseDate(m[1]) : null;
}

export const idfcFirstFd: Adapter = async (ctx) => {
  const links = findRateLinks(ctx.doc.text);
  const pdf = await fetchLinkedPdf(ctx, links, /^fixed deposit interest rate/i, "retail FD PDF");
  const text = pdf.text;
  const effectiveFrom = effectiveDateFrom(text);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the retail deposits PDF");

  const taxSaverAt = text.indexOf("Tax Saver Deposit");
  const greenAt = text.indexOf("Green Deposits");
  const notesAt = text.indexOf("*Important Notes");
  if (taxSaverAt < 0 || greenAt < 0 || notesAt < 0) throw new AdapterError("retail PDF layout changed: Tax Saver / Green Deposits / Important Notes markers not found");

  const rows: RateRow[] = [];
  for (const r of parseRateRows(text.slice(0, taxSaverAt), 2)) {
    const tenure = parseTenure(r.label);
    if (!tenure) throw new AdapterError(`cannot read FD tenure "${r.label}"`);
    const base = { tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: r.label, amountMin: 0, amountMax: 3 * CRORE, residency: "resident" as const, callable: true, payout: null };
    rows.push({ ...base, customer: "general", rate: r.rates[0] }, { ...base, customer: "senior", rate: r.rates[1] });
  }
  for (const [slice, schemeName, minDays] of [
    [text.slice(taxSaverAt, greenAt), "Tax Saver Deposit (5-year, Section 80C, resident only)", 1825],
    [text.slice(greenAt, notesAt), "Green Deposit (resident only)", 375],
  ] as const) {
    const found = parseRateRows(slice, 2);
    if (found.length !== 1) throw new AdapterError(`expected exactly one rate row for "${schemeName}", found ${found.length}`);
    const [r] = found;
    const base = { tenureMinDays: minDays, tenureMaxDays: minDays, tenureLabel: r.label, schemeName, amountMin: 0, amountMax: 3 * CRORE, residency: "resident" as const, callable: true, payout: null };
    rows.push({ ...base, customer: "general", rate: r.rates[0] }, { ...base, customer: "senior", rate: r.rates[1] });
  }

  const rdStart = text.indexOf("Recurring Deposits w.e.f");
  const rdEnd = text.indexOf("** Important Notes");
  if (rdStart < 0 || rdEnd < 0) throw new AdapterError("retail PDF layout changed: Recurring Deposit section markers not found");
  const rdRows: RateRow[] = [];
  for (const r of parseRateRows(text.slice(rdStart, rdEnd), 2)) {
    const tenure = parseTenure(r.label);
    if (!tenure) throw new AdapterError(`cannot read RD tenure "${r.label}"`);
    const base = { tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: r.label, amountMin: 0, amountMax: null, residency: "resident" as const, callable: true, payout: null };
    rdRows.push({ ...base, customer: "general", rate: r.rates[0] }, { ...base, customer: "senior", rate: r.rates[1] });
  }
  const rdDate = effectiveDateFrom(text.slice(rdStart));

  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, sourceUrl: pdf.finalUrl }), makeCard(ctx, "rd", rdRows, { effectiveFrom: rdDate ?? effectiveFrom, sourceUrl: pdf.finalUrl, notes: ["Read from the bank's own explicit RD table (not derived from the FD card); since 3 May 2025 IDFC FIRST only books RD in 6/9/12/24/36-month tenors."] })],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.25pp on almost every tenure (bank's own note)", prematurePenalty: "1% flat, for FDs and RDs opened/renewed on or after 2 May 2019" }],
  };
};

export const idfcFirstBulk: Adapter = async (ctx) => {
  const links = findRateLinks(ctx.doc.text);
  const pdf = await fetchLinkedPdf(ctx, links, /^bulk deposit interest rate/i, "bulk deposits PDF");
  const text = pdf.text;
  const effectiveFrom = effectiveDateFrom(text);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the bulk deposits PDF");

  const sec1 = text.indexOf("(I) Domestic");
  const sec2 = text.indexOf("(II) Domestic");
  const sec3 = text.indexOf("(III) Domestic");
  if (sec1 < 0 || sec2 < 0) throw new AdapterError("bulk PDF layout changed: section (I)/(II) markers not found");
  const rows: RateRow[] = [
    ...parseBulkSection(text.slice(sec1, sec2), false),
    ...parseBulkSection(text.slice(sec2, sec3 >= 0 ? sec3 : text.length), true),
  ];

  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        sourceUrl: pdf.finalUrl,
        notes: ["Only ₹3–27.50 crore (sections I/II of the PDF) is parsed. Amounts above ₹27.50 crore (sections III/IV, ten narrower sub-bands with an irregular '<=' layout) are not covered — a follow-up, not a guess."],
      }),
    ],
  };
};

/** One half of the bulk PDF: a "Period" row of amounts (four sub-bands, wrapped across lines
 * inside "FD Rates**\n(...)" ) followed by one data line per tenure with four % values. */
function parseBulkSection(text: string, callable: boolean): RateRow[] {
  const bandTexts = [...text.matchAll(/FD Rates\*\*\s*\(([^)]+)\)/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  if (bandTexts.length !== 4) throw new AdapterError(`expected 4 amount sub-bands in this bulk section, found ${bandTexts.length}`);
  const bands = bandTexts.map(parseCroreRange);
  const rows: RateRow[] = [];
  for (const r of parseRateRows(text, 4)) {
    const tenure = parseTenure(r.label);
    if (!tenure) throw new AdapterError(`cannot read bulk FD tenure "${r.label}"`);
    bands.forEach((band, i) => {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: r.label,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate: r.rates[i],
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("bulk section produced no rows");
  return rows;
}

/** "Rs. 3 crore – 5 crore" -> [3cr,5cr); "> Rs. 5 crore - 10 crore" -> (5cr,10cr]. */
function parseCroreRange(label: string): { min: number; max: number | null } {
  const nums = [...label.matchAll(/([\d.]+)\s*crore/gi)].map((m) => Math.round(Number(m[1]) * CRORE));
  const exclusiveLower = /^\s*>/.test(label);
  if (nums.length === 2) return { min: exclusiveLower ? nums[0] + 1 : nums[0], max: nums[1] };
  if (nums.length === 1) return { min: exclusiveLower ? nums[0] + 1 : nums[0], max: null };
  throw new AdapterError(`cannot read amount band "${label}"`);
}

export const idfcFirstSavings: Adapter = async (ctx) => {
  const links = findRateLinks(ctx.doc.text);
  const pdf = await fetchLinkedPdf(ctx, links, /savings account interest rate/i, "savings deposits PDF");
  const text = pdf.text;
  const effectiveFrom = effectiveDateFrom(text);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings deposits PDF");

  const slabs: SavingsSlab[] = [];
  const re = /^(.+?)\s+(\d+\.\d+)$/;
  for (const raw of text.split("\n")) {
    const m = re.exec(raw.trim());
    if (!m || !/lakh|crore/i.test(m[1])) continue;
    slabs.push({ ...parseSavingsBand(m[1]), rate: Number(m[2]), residency: "resident" });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs found in the savings deposits PDF");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        sourceUrl: pdf.finalUrl,
        savingsSlabs: slabs,
        slabMethod: "incremental",
        notes: [
          "The bank calls this 'progressive', not 'incremental', but its own worked example (Rs 10 lakh balance: 2.50% on the first Rs 3 lakh, 7.00% on the remaining Rs 7 lakh) is exactly the domain model's 'incremental' method.",
        ],
      }),
    ],
  };
};

function parseSavingsBand(label: string): { balanceMin: number; balanceMax: number | null } {
  const nums = [...label.matchAll(/₹\s*([\d.]+)\s*(lakh|crore)/gi)].map((m) => Number(m[1]) * (m[2].toLowerCase().startsWith("l") ? LAKH : CRORE));
  const hasUpto = /up to/i.test(label);
  const hasAbove = /above/i.test(label);
  if (!hasAbove && hasUpto && nums.length === 1) return { balanceMin: 0, balanceMax: nums[0] + 1 };
  if (hasAbove && hasUpto && nums.length === 2) return { balanceMin: nums[0] + 1, balanceMax: nums[1] + 1 };
  if (hasAbove && !hasUpto && nums.length === 1) return { balanceMin: nums[0] + 1, balanceMax: null };
  throw new AdapterError(`cannot read savings slab "${label}"`);
}
