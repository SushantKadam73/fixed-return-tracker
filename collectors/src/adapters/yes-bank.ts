/**
 * YES Bank — yes.bank.in
 *
 * Sources are PDFs, not HTML, so this file does its own line-based text parsing instead of
 * the shared html-table/term-table helpers (those work on cheerio Grid objects, which only
 * exist for HTML pages). It still reuses the shared parseTenure/parseRate/parseDate/cleanText
 * (string-level helpers, format-agnostic).
 *
 * Pages covered:
 *  - "All Rates and Charges" PDF — one document with THREE tables we use: domestic savings
 *    slabs, retail FD (<₹3 crore, General/Senior), and Resident Recurring Deposit rates
 *    (General/Senior — an explicit table, not derived from the FD card, even though the survey
 *    for this bank noted the two happen to line up tenure-for-tenure).
 *  - "Bulk Fixed Deposit Interest Rates" PDF — ₹3 crore to <₹5 crore only, split into 3 amount
 *    sub-tiers x {Callable, Non-Callable} x {Non-Senior, Senior} = 12 rate columns per tenure
 *    row. Above ₹5 crore the bank negotiates bilaterally and publishes no card rate, so no
 *    "and above" row is invented for that band.
 *  - The NRI-rates PDF (FCNR/NRE/NRO) and the NRE-FD/NRE-RD sections of the two PDFs above are
 *    out of scope for this adapter (not retail/bulk/savings/RD in the tracker's sense).
 *
 * Quirks handled locally (no shared file touched):
 *  - Both PDFs write some ranges as "<duration> < <duration>" with NO "to" in between (e.g.
 *    "24 months < 35 months", "35 M < 3 YR"). The shared parseTenure only recognises "<"/">"
 *    as an EXCLUSIVE-BOUND marker once a label has already been split into a lower and an
 *    upper half by the word "to" (or "-", "upto", ...); without a splittable "to", it feeds the
 *    whole string to parseDuration, which then silently ADDS the two ends together (e.g. "24
 *    months < 35 months" → 24 months + 35 months, a nonsense day count) instead of throwing.
 *    We insert "to" before a bare "<"/">" that isn't already preceded by one, which the label
 *    "336 days to <12 m" (where "to" is already present) shows is exactly how the bank writes
 *    the same construction elsewhere — this is a rewrite in the spirit of the one the
 *    collectors/README.md itself gives as an example ("1 Yr - <2 Yrs" → "1 year to less than
 *    2 years"), not a new convention.
 *  - The savings effective date is written "7th April'26" — an apostrophe plus 2-digit year,
 *    which none of parseDate's patterns match (they all expect a 4-digit year). We expand it
 *    to "7th April 2026" ourselves before calling parseDate.
 *  - The bulk PDF's 3 amount-tier headers ("3 Cr to <3.10 Cr" / "3.10 Cr to <3.15 Cr" / "3.15
 *    Cr to <5 Cr") are word-wrapped across several short lines with no column delimiters, and
 *    are repeated identically 4 times (once per Non-Senior/Senior x Callable/Non-Callable
 *    group) — there is no way to tell the columns apart by their own text, only by position and
 *    the fixed group order the bank prints just above them ("NON-SENIOR CITIZEN SENIOR
 *    CITIZEN", each split Callable-then-Non-Callable). We verify that exact heading text is
 *    present (and that "PREMATURE" appears exactly 4 times, once per group) before trusting the
 *    positional column order, so a future layout change makes this throw instead of silently
 *    mislabelling a column.
 */
import type { CustomerType, RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate } from "../parse/common";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard } from "./helpers";

/** "7th April'26" → "7th April 2026" so the shared parseDate (which only knows 4-digit years) can read it. */
function expandApostropheYear(text: string): string {
  return text.replace(/['’](\d{2})\b/g, " 20$1");
}

/**
 * Both PDFs sometimes drop the word "to" before a bare "<"/">" ("24 months < 35 months"),
 * which breaks the shared parseTenure (see the file header comment). Insert "to" only where
 * it is actually missing — a duration immediately followed by "<"/">" with no "to" between —
 * so labels that already say "...to <35 M" are left untouched.
 */
function insertMissingTo(label: string): string {
  return label.replace(/(\d+\s*(?:days?|months?|years?|yrs?|[mdy]))\s+(?=[<>])/gi, "$1 to ");
}

function readTenure(label: string): { minDays: number; maxDays: number; point?: boolean } {
  const t = parseTenure(insertMissingTo(label));
  if (!t) throw new AdapterError(`cannot read tenure "${label}"`);
  return t;
}

/** Extract "<label> <N>% <N>% ... <N>%" rows (exactly `count` percentages) from a block of text. */
function extractPercentRows(section: string, count: number): Array<{ label: string; values: number[] }> {
  const re = new RegExp(`^(.+?)\\s+${Array(count).fill("([\\d.]+)%").join("\\s+")}$`);
  const out: Array<{ label: string; values: number[] }> = [];
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = re.exec(line);
    if (m) out.push({ label: m[1].trim(), values: m.slice(2).map(Number) });
  }
  return out;
}

function section(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new AdapterError(`section not found: "${startMarker}"`);
  const end = text.indexOf(endMarker, start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

export const yesFd: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const fdSection = section(text, "Fixed Deposit Interest Rates w.e.f.", "Premature Penalty on Fixed Deposits");
  const effectiveFrom = findEffectiveDate(cleanText(fdSection).slice(0, 120));
  if (!effectiveFrom) throw new AdapterError("effective date not found in the FD table's own lead-in text");

  const rows: RateRow[] = [];
  for (const { label, values } of extractPercentRows(fdSection, 4)) {
    const tenure = readTenure(label);
    const [generalRate, , seniorRate] = values; // columns are rate, yield, rate, yield
    for (const [rate, customer] of [[generalRate, "general"], [seniorRate, "senior"]] as const) {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: 0,
        amountMax: 3 * CRORE,
        customer,
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("no FD rows parsed from the PDF text");

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "Varies by tenure (see the card); bank states: \"Senior Citizen rates are applicable only for Domestic\" [deposits] — not NRE/NRO",
        prematurePenalty: "0.75% for tenure ≤181 days, 1.00% for ≥182 days on deposits <₹5 crore (w.e.f. 3 Nov 2023); flat 0.25% on deposits ≥₹5 crore; nil for senior citizens booked/renewed on/after 16 May 2022 and for staff on/after 10 May 2021",
        other: ["Interest for a monthly payout option is discounted from the standard rate."],
      },
    ],
  };
};

export const yesRd: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const rdSection = section(text, "Resident Recurring Deposit Rates w.e.f.", "NRE Recurring Deposit Rates");
  const effectiveFrom = findEffectiveDate(cleanText(rdSection).slice(0, 120));
  if (!effectiveFrom) throw new AdapterError("effective date not found in the RD table's own lead-in text");

  const rows: RateRow[] = [];
  for (const { label, values } of extractPercentRows(rdSection, 2)) {
    const tenure = readTenure(label);
    const [generalRate, seniorRate] = values;
    for (const [rate, customer] of [[generalRate, "general"], [seniorRate, "senior"]] as const) {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: 0,
        amountMax: 3 * CRORE,
        customer,
        residency: "resident",
        callable: null, // not discussed for RD specifically on this page
        payout: null,
        rate,
      });
    }
  }
  if (rows.length === 0) throw new AdapterError("no RD rows parsed from the PDF text");

  const card = makeCard(ctx, "rd", rows, {
    effectiveFrom,
    notes: ["Read directly from the bank's own Resident RD table, not derived from the FD card — the survey noted the two happen to match tenure-for-tenure, but this card is sourced independently.", "Only Resident senior citizens get the higher rate; installments above ₹2.99 crore/month are not covered by this card."],
  });
  return { cards: [card] };
};

/**
 * "Up to X" / "Above X to less than Y" / "X and above to less than Y" savings-slab labels.
 * "and above"/"up to" mark an INCLUSIVE end on that side; "less than" is already exclusive,
 * which is exactly the half-open [min, max) the domain model wants, so no +1 nudge is needed
 * there — only the inclusive ends (the bare "above X" start, and "up to X" itself) need one.
 */
function parseYesSlab(label: string): { min: number; max: number | null } {
  const t = label.toLowerCase();
  const nums = amountsIn(t);
  if (nums.length === 0) throw new AdapterError(`unrecognised savings slab label "${label}"`);
  if (/^up to/.test(t.trim())) return { min: 0, max: nums[0] + 1 };
  if (nums.length < 2) throw new AdapterError(`unrecognised savings slab label "${label}"`);
  return { min: /and above/.test(t) ? nums[0] : nums[0] + 1, max: nums[1] };
}

export const yesSavings: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const savingsSection = section(text, "DOMESTIC & NON-RESIDENT SAVINGS ACCOUNTS", "TERM DEPOSIT:");
  const effectiveFrom = findEffectiveDate(expandApostropheYear(cleanText(savingsSection)));
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings table's own lead-in text");

  const rows = extractPercentRows(savingsSection, 1);
  if (rows.length === 0) throw new AdapterError("no savings slabs parsed from the PDF text");

  const slabs: SavingsSlab[] = rows.map(({ label, values }) => {
    const band = parseYesSlab(label);
    return { balanceMin: band.min, balanceMax: band.max, rate: values[0], residency: "resident" as const };
  });

  const card = makeCard(ctx, "savings", [], {
    effectiveFrom,
    savingsSlabs: slabs,
    slabMethod: "incremental",
    notes: [
      'Bank states: "Interest will be calculated on incremental balances in each Interest Rate Slab at applicable rates" — each slice of the balance earns its own slab\'s rate.',
      "For balances of ₹100 crore and above the bank asks customers to contact the branch/Relationship Manager directly; no card rate is published for that band, so the top slab here stops at ₹100 crore rather than being left open-ended.",
      "The bank also offers separate MIBOR-linked and Repo-linked savings variants (floating rates, not a fixed % card) which are not represented in this slab table.",
    ],
  });
  return { cards: [card] };
};

const BULK_TIERS = [
  { min: 3 * CRORE, max: 3.1 * CRORE },
  { min: 3.1 * CRORE, max: 3.15 * CRORE },
  { min: 3.15 * CRORE, max: 5 * CRORE },
];
const BULK_GROUPS: Array<{ customer: CustomerType; callable: boolean }> = [
  { customer: "general", callable: true },
  { customer: "general", callable: false },
  { customer: "senior", callable: true },
  { customer: "senior", callable: false },
];

export const yesBulk: Adapter = async (ctx) => {
  const text = ctx.doc.text;
  const header = section(text, "DEPOSITS", "7 days to");
  // The 12 rate columns are only distinguishable by position; verify the group headings this
  // depends on are still exactly where expected before trusting that position (see file header).
  const headerFlat = cleanText(header);
  if (!/non-senior citizen[\s\S]*senior citizen/i.test(headerFlat)) throw new AdapterError("expected 'NON-SENIOR CITIZEN ... SENIOR CITIZEN' column-group headings not found — bulk FD layout may have changed");
  if ((headerFlat.match(/premature/gi) ?? []).length !== 4) throw new AdapterError("expected exactly 4 'PREMATURE ...' column headings (one per customer×callable group) — bulk FD layout may have changed");

  const effectiveFrom = findEffectiveDate(headerFlat.slice(0, 120));
  if (!effectiveFrom) throw new AdapterError("effective date not found in the bulk FD PDF's own header");

  const rows: RateRow[] = [];
  for (const { label, values } of extractPercentRows(text, 12)) {
    const tenure = readTenure(label);
    BULK_GROUPS.forEach((group, g) => {
      BULK_TIERS.forEach((tier, t) => {
        rows.push({
          tenureMinDays: tenure.minDays,
          tenureMaxDays: tenure.maxDays,
          tenureLabel: label,
          amountMin: tier.min,
          amountMax: tier.max,
          customer: group.customer,
          residency: "resident",
          callable: group.callable,
          payout: null,
          rate: values[g * 3 + t],
        });
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("no bulk FD rows parsed from the PDF text");

  const card = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: [
      "This card only covers ₹3 crore to below ₹5 crore. Above ₹5 crore the bank negotiates bilaterally and publishes no card rate here, so no open-ended top tier is added.",
      "Bank states: \"Resident senior citizen can earn additional interest 0.50% for tenure less than 3 years and 0.75% p.a. for tenure of 3 years and above on Fixed Deposits value less than INR 5 CR.\"",
    ],
  });
  return {
    cards: [card],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "0.75% (≤181 days) / 1.00% (≥182 days) on deposits <₹5cr (w.e.f. 3 Nov 2023); flat 0.25% for ≥₹5cr; not applicable to senior citizens" }],
  };
};
