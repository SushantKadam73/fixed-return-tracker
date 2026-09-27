/**
 * slice Small Finance Bank (formerly North East Small Finance Bank) — slice.bank.in
 * Pages covered (both are text-based PDFs, parsed on extracted text — no HTML table on the
 * site itself carries the full tenure grid):
 *  - Current interest-rates PDF: /documents/imp/interest-rates.pdf
 *      Three FD sub-tables (Callable Quarterly-payout, Callable Monthly-payout,
 *      Non-Callable Quarterly-payout, all "Upto INR 3Cr"), an RD table, and the flat
 *      savings rate. This is always a single "current" snapshot — the filename is stable,
 *      the bank overwrites it in place, so whatever we read here already IS "the latest".
 *  - Previous Interest Rates PDF: /documents/imp/previous_interest_rates.pdf
 *      The bank's own dated change-log: every FD-rate period back to Oct 2024 (Callable and
 *      Non-Callable, split by amount band) plus every dated Savings-rate change. `sliceHistory`
 *      turns each period into its own dated bank_archive card — the live adapters below never
 *      read this file, so they can only ever publish the single latest period.
 *
 * Quirks:
 *  - Bulk (>3cr): the current PDF says "For deposits greater than 3cr, please reach out to
 *    bank branches" — no live bulk card. The archive PDF DID carry a >3cr column in every
 *    historical period, so sliceHistory still records it for the periods where it exists.
 *  - The archive PDF's page-break text extraction occasionally splits one row's label across
 *    two lines (e.g. "18 months 1 Day to 18 months 2\nday 7.75% ..."), which our per-line row
 *    regex cannot read. sliceHistory is a best-effort backfill tool (not a live source), so it
 *    skips a row it cannot parse and records which one in the card's notes instead of failing
 *    the whole period — the live adapters below still throw on anything they cannot read, per
 *    the usual contract, and the current PDF does not have this artifact.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { parseTenure } from "../parse/tenure";
import type { Adapter, AdapterOutput } from "../types";
import { AdapterError, CRORE, makeCard } from "./helpers";

/** "<tenure label> <rate>% <rate>% [<rate>% <rate>%]" — 2 or 4 rate columns. */
const ROW2_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;
const ROW4_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;

function findEffectiveFrom(text: string): string | null {
  const m = /effective\s+from\s+([^*\n]+)/i.exec(text);
  return m ? parseDate(m[1]) : null;
}

function buildRow(label: string, rate: number, customer: "general" | "senior", amountMin: number, amountMax: number | null, callable: boolean, payout: RateRow["payout"]): RateRow {
  const tenure = parseTenure(label);
  if (!tenure) throw new AdapterError(`cannot read tenure "${label}"`);
  return {
    tenureMinDays: tenure.minDays,
    tenureMaxDays: tenure.maxDays,
    tenureLabel: label,
    special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
    amountMin,
    amountMax,
    customer,
    residency: "resident",
    callable,
    payout,
    rate,
  };
}

/** Parse a "Callable/Non-Callable ... Upto INR 3Cr" style sub-table (2 rate columns: Regular, Senior). */
function parseTwoColumnTable(text: string, startMarker: string, endMarker: RegExp, amountMin: number, amountMax: number | null, callable: boolean, payout: RateRow["payout"]): RateRow[] {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new AdapterError(`table not found: ${startMarker}`);
  const rest = text.slice(start + startMarker.length);
  const end = endMarker.exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  const rows: RateRow[] = [];
  for (const rawLine of section.split(/\n/)) {
    const line = cleanText(rawLine);
    if (/^tenure/i.test(line)) continue;
    const m = ROW2_RE.exec(line);
    if (!m) continue;
    rows.push(buildRow(m[1], Number(m[2]), "general", amountMin, amountMax, callable, payout));
    rows.push(buildRow(m[1], Number(m[3]), "senior", amountMin, amountMax, callable, payout));
  }
  if (rows.length === 0) throw new AdapterError(`no rows parsed for "${startMarker}"`);
  return rows;
}

export const sliceFd: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const effectiveFrom = findEffectiveFrom(text);
  if (!effectiveFrom) throw new AdapterError("effective date not found (no 'Effective from ...' line)");
  const quarterly = parseTwoColumnTable(text, "Callable Quarterly Interest Payout Fixed Deposit Upto INR 3Cr", /callable monthly/i, 0, 3 * CRORE, true, "quarterly");
  const monthly = parseTwoColumnTable(text, "Callable Monthly Interest Payout Fixed Deposit Upto INR 3Cr", /non-callable quarterly/i, 0, 3 * CRORE, true, "monthly");
  const nonCallable = parseTwoColumnTable(text, "Non-Callable Quarterly Interest Payout (INR 1cr to 3 Cr)", /recurring deposit rate/i, 1_00_00_000 + 1, 3 * CRORE, false, "quarterly");
  const rows = [...quarterly, ...monthly, ...nonCallable];
  const card = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "Quarterly-payout is the bank's default (cumulative-equivalent) rate; the monthly-payout table is a slightly discounted version of the same tenures, both printed on the same page.",
      "For deposits above ₹3 crore the PDF says 'please reach out to bank branches' — no public bulk card. slice-sfb's own historical PDF did carry a >3cr column; see sliceHistory for those archived rates.",
    ],
  });
  return {
    cards: [card],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, prematurePenalty: "1% over the interest rate applicable for the actual deposit period" }],
  };
};

export const sliceRd: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const m = /Recurring Deposit Rate of Interest([\s\S]*?)\*\s*Effective from\s+([^\n]+)/i.exec(text);
  if (!m) throw new AdapterError("Recurring Deposit table or its effective date not found");
  const effectiveFrom = parseDate(m[2]);
  if (!effectiveFrom) throw new AdapterError(`cannot read RD effective date from "${m[2]}"`);
  const rowRe = /^(\d+)\s*months?\s*(\d+)\s*days?\s+(\d+)\s*months?\s*(\d+)\s*days?\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/i;
  const monthsToDays = (n: number) => Math.round((n * 365) / 12);
  const rows: RateRow[] = [];
  for (const rawLine of m[1].split(/\n/)) {
    const line = cleanText(rawLine);
    const r = rowRe.exec(line);
    if (!r) continue;
    const minDays = monthsToDays(Number(r[1])) + Number(r[2]);
    const maxDays = monthsToDays(Number(r[3])) + Number(r[4]);
    const label = `${r[1]} months ${r[2]} days to ${r[3]} months ${r[4]} days`;
    for (const [rate, customer] of [[Number(r[5]), "general"], [Number(r[6]), "senior"]] as const) {
      rows.push({ tenureMinDays: minDays, tenureMaxDays: maxDays, tenureLabel: label, amountMin: 0, amountMax: 2 * CRORE, customer, residency: "resident", callable: true, payout: null, rate });
    }
  }
  if (rows.length === 0) throw new AdapterError("no RD rows parsed");
  return {
    cards: [makeCard(ctx, "rd", rows, { effectiveFrom, notes: ["Card rate quoted 'up to ₹2 crore' by the bank; not derived from the FD card."] })],
  };
};

export const sliceSavings: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const rateMatch = /SAVINGS DEPOSIT RATE\s*\n?\s*Flat\s+(\d+(?:\.\d+)?)%/i.exec(text);
  const dateMatch = /Last updated on\s+([^\n]+)/i.exec(text);
  if (!rateMatch) throw new AdapterError("savings rate not found");
  const effectiveFrom = dateMatch ? parseDate(dateMatch[1]) : null;
  const slabs: SavingsSlab[] = [{ balanceMin: 0, balanceMax: null, rate: Number(rateMatch[1]), residency: "resident", note: "Flat rate = 100% of the RBI repo rate at the time, paid daily; not slabbed by balance." }];
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "whole" })] };
};

/** One dated FD period from the "Previous Interest Rates" archive PDF. */
function parseFdPeriod(block: string, url: string, today: string, notes: string[]): RateRow[] {
  const callableIdx = block.search(/callable fds/i);
  const nonCallableIdx = block.search(/non-callable fds/i);
  if (callableIdx < 0 || nonCallableIdx < 0) throw new AdapterError("Callable/Non-Callable FD sections not found in period block");
  const callableText = block.slice(callableIdx, nonCallableIdx);
  const nonCallableText = block.slice(nonCallableIdx);

  function bandRows(sectionText: string, callable: boolean, thresholdAtIndex: number): RateRow[] {
    const lines = sectionText.split(/\n/).map(cleanText);
    const headerLines: string[] = [];
    const rows: RateRow[] = [];
    for (const line of lines) {
      const m = ROW4_RE.exec(line);
      if (!m) {
        if (!/%$/.test(line)) headerLines.push(line);
        continue;
      }
      // amountsIn() already multiplies by the "Cr" unit, so `threshold` is in rupees, e.g.
      // "Upto 5 Cr" -> 5,00,00,000, not the bare number 5.
      const threshold = amountsIn(headerLines.join(" "))[thresholdAtIndex];
      if (!threshold) {
        notes.push(`could not read the amount-band threshold for "${m[1]}" in a ${callable ? "callable" : "non-callable"} table — row skipped`);
        continue;
      }
      // Callable retail band starts at ₹0 ("Upto Ncr"); non-callable retail band starts just
      // above ₹1 crore ("1cr to Ncr", matching the live Non-Callable table's own convention).
      // Both share the SAME period-specific upper threshold (3cr in most periods, 5cr in the
      // earliest one); the bulk/"more than" band picks up immediately above that threshold.
      const retailMin = callable ? 0 : CRORE + 1;
      const retailMax = threshold;
      const bulkMin = threshold + 1;
      const tenure = parseTenure(m[1]);
      if (!tenure) {
        notes.push(`could not read tenure "${m[1]}" (skipped — likely a PDF text-extraction artifact in the source document)`);
        continue;
      }
      const base = { tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: m[1], special: tenure.point && tenure.minDays % 365 !== 0 ? (true as const) : undefined, residency: "resident" as const, callable, payout: null };
      rows.push({ ...base, amountMin: retailMin, amountMax: retailMax, customer: "general", rate: Number(m[2]) });
      rows.push({ ...base, amountMin: retailMin, amountMax: retailMax, customer: "senior", rate: Number(m[3]) });
      rows.push({ ...base, amountMin: bulkMin, amountMax: null, customer: "general", rate: Number(m[4]) });
      rows.push({ ...base, amountMin: bulkMin, amountMax: null, customer: "senior", rate: Number(m[5]) });
    }
    return rows;
  }

  // Callable header lists the "upto <N>cr" band first (index 0); non-callable lists "1cr to <N>cr" (index 1).
  return [...bandRows(callableText, true, 0), ...bandRows(nonCallableText, false, 1)];
}

export const sliceHistory: Adapter = async (ctx): Promise<AdapterOutput> => {
  const text = ctx.doc.text;
  const cards = [];
  const warnings: string[] = [];

  // Savings: "From <date> <rate>%" lines under "Savings Interest Rates".
  const savingsSection = /Savings Interest Rates([\s\S]*?)Fixed Deposit Interest Rates/i.exec(text)?.[1] ?? "";
  const savingsRows = [...savingsSection.matchAll(/From\s+([a-z]+ \d{1,2},? \d{4})\s+(\d+(?:\.\d+)?)%/gi)];
  for (const m of savingsRows) {
    const effectiveFrom = parseDate(m[1]);
    if (!effectiveFrom) {
      warnings.push(`could not read a savings history date from "${m[1]}"`);
      continue;
    }
    cards.push({
      bankSlug: ctx.source.bankSlug,
      product: "savings" as const,
      effectiveFrom,
      observedAt: ctx.today,
      sourceType: "bank_archive" as const,
      sourceUrl: ctx.doc.finalUrl ?? ctx.source.url,
      confidence: "high" as const,
      rows: [],
      savingsSlabs: [{ balanceMin: 0, balanceMax: null, rate: Number(m[2]), residency: "resident" as const, note: "Flat rate = 100% of the RBI repo rate at the time." }],
      slabMethod: "whole" as const,
      notes: [`From the bank's own "Previous Interest Rates" archive PDF.`],
    });
  }

  // FD: one block per "Effective <start> [–/to/till] <end|Till Date>" heading.
  const fdSection = text.slice(text.search(/Fixed Deposit Interest Rates/i));
  const blocks = fdSection.split(/\nEffective /).slice(1);
  for (const raw of blocks) {
    const block = `Effective ${raw}`;
    const headM = /^Effective\s+(.+?)\s*(?:–|—|-|to|till)\s+(till date|.+?)\s*\n/i.exec(block);
    if (!headM) {
      warnings.push(`could not read the period header from a block starting "${block.slice(0, 60)}..."`);
      continue;
    }
    const effectiveFrom = parseDate(headM[1]);
    const isOngoing = /till date/i.test(headM[2]);
    const effectiveTo = isOngoing ? null : parseDate(headM[2]);
    if (!effectiveFrom) {
      warnings.push(`could not read a start date from "${headM[1]}"`);
      continue;
    }
    const periodNotes: string[] = [`From the bank's own "Previous Interest Rates" archive PDF, in force ${effectiveFrom} to ${effectiveTo ?? "the next revision"}.`];
    let rows: RateRow[];
    try {
      rows = parseFdPeriod(block, ctx.doc.finalUrl ?? ctx.source.url, ctx.today, periodNotes);
    } catch (e) {
      warnings.push(`skipped period starting ${effectiveFrom}: ${(e as Error).message}`);
      continue;
    }
    if (rows.length === 0) {
      warnings.push(`no rows recovered for period starting ${effectiveFrom}`);
      continue;
    }
    cards.push({
      bankSlug: ctx.source.bankSlug,
      product: "fd" as const,
      effectiveFrom,
      observedAt: ctx.today,
      observedFrom: effectiveFrom,
      observedTo: effectiveTo,
      sourceType: "bank_archive" as const,
      sourceUrl: ctx.doc.finalUrl ?? ctx.source.url,
      confidence: "high" as const,
      rows,
      notes: periodNotes,
    });
  }

  if (cards.length === 0) throw new AdapterError("no historical periods recovered from the archive PDF");
  return { cards, warnings };
};
