/**
 * Karur Vysya Bank (KVB) — kvb.bank.in
 *
 * The bank's rate pages ("Resident / NRO Deposits", "Bulk Term Deposit Rates", "Interest Rate
 * for Savings Accounts") are rendered client-side from three plain, unauthenticated JSON
 * endpoints on the bank's own domain — confirmed live and read directly here, no headless
 * browser needed:
 *   - /manager/api/v1/nro-deposit-rates        (general-public + senior-citizen domestic/NRO
 *     term deposits, retail below ₹3cr, plus a small "Flexi Term Deposit" table)
 *   - /manager/api/v1/bulk-deposit-rates        (₹3cr and above, six amount tiers, each with a
 *     premature-withdrawal-allowed and a not-allowed rate)
 *   - /manager/api/v1/savings-interest-rates    (nine EOD-balance slabs)
 * Each page's own JS (assets/javascript/{nro-deposit-rates,bulk-term-deposit-rates,
 * interest-rate-savings-account}.js) calls the matching endpoint with a plain jQuery GET and
 * fills the visible tables from the response — verified live that the endpoints return the
 * exact same figures with or without the page's own `request_for[]` query parameter, so no
 * query string is sent here. robots.txt is "User-agent: *" with no Disallow lines at all.
 *
 * RD: KVB's own "Policy on Deposits" PDF (docs/policy-on-deposits.pdf) states: "Recurring
 * deposits shall carry the interest rate offered for different maturities as applicable to
 * other term deposits and there shall be no differential pricing according to the amount of
 * the instalment." That is an explicit rate-parity statement, so the RD card is derived from
 * the FD card via `deriveRdFromFd` rather than read from a rate-by-tenure table of its own
 * (KVB does not publish one).
 *
 * Quirks worked around locally (kept out of the shared parsers on purpose):
 *  - The API's own JSON string values carry a trailing non-breaking space on several
 *    `time_bucket` labels (e.g. "7 Days to 14 days ") — cleaned with `cleanText` before
 *    they become a stored `tenureLabel` (parseTenure/parseRate already tolerate it internally,
 *    but the label we keep for display should not).
 *  - The retail table's "271 Days to 332 days" row is unaffected by the historical "271 to <
 *    1 Year" quirk (that shape only occurs on the *bulk* table's "271 to < 1 Year" period,
 *    where the lower bound "271" omits its "Days" unit — every neighbouring bulk period spells
 *    it out); `normaliseTenureLabel` inserts the missing unit before `parseTenure` there.
 *  - "Green Deposits (2345 days)" is a named special-tenure row, like SBI's Amrit Vrishti: its
 *    tenure is the day count printed in its own label, read with a small regex, not guessed.
 *    "For KVB - Tax Shield Deposits" (a 5-year tax saver) and "Rainbow Deposits (RBFD)" (a
 *    separate flexi/RD-linked scheme) are entries in the same JSON block but without a tenure
 *    band of their own, so they are skipped rather than assigned one.
 *  - "Flexi Term Deposit": a fourth, separate rate block, `flexi_term_interest_rates` — the
 *    resident-nro-deposits page's own JS requests this alongside the domestic/senior blocks,
 *    and the API clearly labels it (its own request_for key and column headers), so — unlike
 *    the previous headless-browser build of this adapter, where this table was requested by the
 *    page's JS but never actually rendered into the DOM — it is now included: a single "300
 *    days" / 3.25% row, general public only (no senior-citizen figure is published for it
 *    anywhere). Marked `special` (a single named tenure, like Green Deposits) rather than folded
 *    into the ordinary ladder.
 *  - This page's own API `title` field — "Resident / NRO Deposits" — is the bank's own
 *    statement that the one published general-public rate (and, by the same reasoning, the one
 *    published Flexi Term Deposit rate) applies to Resident and NRO alike, so those rows are
 *    produced twice, once per residency, from that one published number — not two
 *    independently-sourced figures. The adapter throws if that title text ever changes rather
 *    than silently keep guessing residency scope. The senior-citizen table is excluded from
 *    this: its own page text says "Senior Citizen rates are not applicable to NRI", so senior
 *    rows stay Resident-only.
 *  - The bulk JSON's field names (e.g. `rupees_2_to_5_crore_premature_withdrawal_allowed`) are a
 *    legacy naming mismatch on the bank's own side: its page renders that exact field under the
 *    header "Rs. 3 Cr. to < Rs. 5 Cr." (confirmed from the page's own bulk-term-deposit-rates.js,
 *    which hardcodes that header text and reads this field into it) — the rendered boundary is
 *    used here, not the field's internal name. A further field pair,
 *    `rupees_25_crore_and_above_premature_withdrawal_[not_]allowed`, is always "-" in the API
 *    response and is not even referenced by the page's own rendering JS; not read here.
 *  - The bulk period "271 to < 1 Year" needs the same missing-unit fix as above.
 *  - The bulk page's own "effective from" date is filled in by the API to the day it is
 *    requested (bulk/Treasury rates are set daily per KVB's policy), so the date read here will
 *    normally equal the day the collector runs.
 *  - `parseAmountBand` (parse/amount.ts) only treats a band as starting *above* its lower
 *    number when the label begins with "above"/"more than"/etc; KVB's savings labels prefix
 *    that word with "EOD balance " / "EOD Balance ", so the check never fires. That fixed
 *    prefix is stripped before calling it, rather than changing the shared helper.
 *  - All three endpoints' "effective date" is read from their own human-readable
 *    `content_above_table` / `content_above_the_table` sentence (via the shared
 *    `findEffectiveDate`, which already copes with the bulk endpoint's date being wrapped in a
 *    `<b id="effective-date">` tag), not from the endpoints' own `wef_date` field: the
 *    domestic/bulk endpoints give `wef_date` as a plain "DD.MM.YYYY" string, but the savings
 *    endpoint gives it as a full ISO datetime ("2026-01-14T18:30:00.000000Z") whose "YYYY-MM-DD"
 *    shape can be misread by the shared day-first `parseDate` if fed to it directly (it would
 *    find "26-01-14" inside "2026-01-14..." and read that as 2014-01-26) — reading the prose
 *    sentence instead sidesteps that entirely and keeps one code path for all three endpoints.
 */
import type { CustomerType, RateRow, Residency } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { parseAmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, makeCard } from "./helpers";

/** Named schemes printed in the same JSON block but with no tenure band of their own here. */
const NAMED_SCHEME_NO_TENURE = /tax shield|rainbow deposits/i;
const GREEN_DEPOSITS_RE = /green deposits\s*\((\d+)\s*days?\)/i;
/** The API's own "title" field (see file header). */
const RESIDENT_NRO_TITLE = /resident\s*\/\s*nro deposits/i;
const RETAIL_MAX = 3 * CRORE;

/** See file header: the bulk table's "271 to < 1 Year" is missing its "Days" unit. */
function normaliseTenureLabel(label: string): string {
  return label.replace(/^(\d+)(\s+to\s*<)/i, "$1 Days$2");
}

function parseJsonData<T>(text: string, what: string): T {
  let parsed: { data?: T };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AdapterError(`${what}: response was not valid JSON`);
  }
  if (!parsed.data) throw new AdapterError(`${what}: response had no "data" field`);
  return parsed.data;
}

interface KvbRateValue {
  time_bucket: string;
  revised_rate: string;
}
interface KvbRateBlock {
  values?: KvbRateValue[];
}
interface KvbNroData {
  title?: string;
  content_above_table?: string;
  domestic_term_interest_rates?: KvbRateBlock;
  senior_citizen_interest_rates?: KvbRateBlock;
  flexi_term_interest_rates?: KvbRateBlock;
}

function blockValues(block: KvbRateBlock | undefined, what: string): KvbRateValue[] {
  const v = block?.values;
  if (!Array.isArray(v) || v.length === 0) throw new AdapterError(`KVB nro-deposit-rates API: "${what}" missing or empty`);
  return v;
}

/** "Green Deposits (2345 days)" — a special tenure whose day count is printed in its own label. */
function greenDepositsRow(values: KvbRateValue[], customer: CustomerType, residency: Residency): RateRow | null {
  const row = values.find((v) => GREEN_DEPOSITS_RE.test(cleanText(v.time_bucket)));
  if (!row) return null;
  const label = cleanText(row.time_bucket);
  const m = GREEN_DEPOSITS_RE.exec(label);
  const rate = parseRate(row.revised_rate);
  if (!m || rate === null) return null;
  const days = Number(m[1]);
  return { tenureMinDays: days, tenureMaxDays: days, tenureLabel: label, special: true, schemeName: "Green Deposits", amountMin: 0, amountMax: RETAIL_MAX, customer, residency, callable: true, payout: null, rate };
}

/** Ordinary tenure-banded rows from one rate block: skips named schemes with no tenure band of
 * their own and Green Deposits (added back separately by `greenDepositsRow`). */
function termRows(values: KvbRateValue[], customer: CustomerType, residency: Residency): RateRow[] {
  const rows: RateRow[] = [];
  for (const v of values) {
    const label = cleanText(v.time_bucket);
    if (NAMED_SCHEME_NO_TENURE.test(label) || GREEN_DEPOSITS_RE.test(label)) continue;
    const rate = parseRate(v.revised_rate);
    if (rate === null) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read KVB tenure "${label}"`);
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
      amountMin: 0,
      amountMax: RETAIL_MAX,
      customer,
      residency,
      callable: true,
      payout: null,
      rate,
    });
  }
  return rows;
}

export const karurVysyaBankFd: Adapter = async (ctx) => {
  const data = parseJsonData<KvbNroData>(ctx.doc.text, "KVB nro-deposit-rates API");

  // Confirms the residency scope asserted below (see file header) — fail loudly rather than
  // keep publishing an "nro" copy of the general rate if the API is ever restructured.
  if (!RESIDENT_NRO_TITLE.test(data.title ?? "")) {
    throw new AdapterError('API "title" no longer reads "Resident / NRO Deposits" — cannot confirm the general-public rate applies to NRO too');
  }

  const effectiveFrom = findEffectiveDate(data.content_above_table ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the API's content_above_table");

  const generalValues = blockValues(data.domestic_term_interest_rates, "domestic_term_interest_rates");
  const seniorValues = blockValues(data.senior_citizen_interest_rates, "senior_citizen_interest_rates");

  const rows: RateRow[] = [
    // One published rate serves Resident and NRO alike on this page (its own API "title" is
    // "Resident / NRO Deposits") — produced as two residency-tagged row sets from the same
    // source figure, not guessed. Senior-citizen rows stay Resident-only (see below).
    ...termRows(generalValues, "general", "resident"),
    ...termRows(generalValues, "general", "nro"),
    ...termRows(seniorValues, "senior", "resident"),
  ];
  rows.push(
    ...[
      greenDepositsRow(generalValues, "general", "resident"),
      greenDepositsRow(generalValues, "general", "nro"),
      greenDepositsRow(seniorValues, "senior", "resident"),
    ].filter((r): r is RateRow => r !== null),
  );

  // Flexi Term Deposit (see file header): a separate, clearly-labelled block this page's own JS
  // also requests. General public only — no senior-citizen figure is published for it anywhere.
  const flexiValues = data.flexi_term_interest_rates?.values;
  if (Array.isArray(flexiValues) && flexiValues.length > 0) {
    for (const v of flexiValues) {
      const label = cleanText(v.time_bucket);
      const rate = parseRate(v.revised_rate);
      const tenure = rate === null ? null : parseTenure(label);
      if (rate === null || !tenure) throw new AdapterError(`cannot read KVB Flexi Term Deposit row "${label}"`);
      const base = {
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: `Flexi Term Deposit (${label})`,
        special: true,
        schemeName: "Flexi Term Deposit",
        amountMin: 0,
        amountMax: RETAIL_MAX,
        customer: "general" as const,
        callable: true,
        payout: null,
        rate,
      };
      rows.push({ ...base, residency: "resident" }, { ...base, residency: "nro" });
    }
  }

  const notes = [
    "Senior-citizen rates are not published for tenures shorter than 333 days on this table — those tenures pay the general rate to everyone.",
    "Senior-citizen rates do not apply to NRI depositors (bank's own note), so senior rows are Resident only.",
    "General-public rows (and Flexi Term Deposit, and Green Deposits) are duplicated as Resident and NRO: the API's own \"title\" is \"Resident / NRO Deposits\" and publishes one shared rate for both, not a separate NRO number.",
    "\"For KVB - Tax Shield Deposits\" (5-year tax saver) and \"Rainbow Deposits (RBFD)\" are listed in the same API response without a tenure band of their own, so they are not included as rows.",
    "Flexi Term Deposit is a single-tenure (300 days) scheme in this same API response, requested by the page's own script but (unlike the rest of this card) not stated to have any premature-withdrawal terms of its own.",
  ];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });
  const rd = deriveRdFromFd(fd, "Recurring deposits shall carry the interest rate offered for different maturities as applicable to other term deposits and there shall be no differential pricing according to the amount of the instalment (KVB Policy on Deposits)");
  return {
    cards: [fd, rd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        prematurePenalty: "Penalty of 1% from the applicable rate of interest (up to ₹3 crore)",
        rdRules: "RD rates equal the FD card rate for the same tenure (bank's own policy statement); no differential pricing by instalment amount.",
      },
    ],
  };
};

interface KvbBulkRow {
  period: string;
  rupees_2_to_5_crore_premature_withdrawal_allowed?: string;
  rupees_2_to_5_crore_premature_withdrawal_not_allowed?: string;
  rupees_5_to_10_crore_premature_withdrawal_allowed?: string;
  rupees_5_to_10_crore_premature_withdrawal_not_allowed?: string;
  rupees_10_to_25_crore_premature_withdrawal_allowed?: string;
  rupees_10_to_25_crore_premature_withdrawal_not_allowed?: string;
  rupees_25_to_50_crore_premature_withdrawal_allowed?: string;
  rupees_25_to_50_crore_premature_withdrawal_not_allowed?: string;
  rupees_50_to_100_crore_premature_withdrawal_allowed?: string;
  rupees_50_to_100_crore_premature_withdrawal_not_allowed?: string;
  rupees_100_crore_and_above_premature_withdrawal_allowed?: string;
  rupees_100_crore_and_above_premature_withdrawal_not_allowed?: string;
}
interface KvbBulkData {
  content_above_the_table?: string;
  interest_rates?: KvbBulkRow[];
}

/** Six amount tiers, each with an allowed/not-allowed field pair. Tier boundaries are what the
 * bank's own page renders as column headers, not the JSON's own (legacy-mismatched) field-name
 * prefixes — see file header. */
const BULK_TIERS: Array<{ min: number; max: number | null; allowedKey: keyof KvbBulkRow; notAllowedKey: keyof KvbBulkRow }> = [
  { min: 3 * CRORE, max: 5 * CRORE, allowedKey: "rupees_2_to_5_crore_premature_withdrawal_allowed", notAllowedKey: "rupees_2_to_5_crore_premature_withdrawal_not_allowed" },
  { min: 5 * CRORE, max: 10 * CRORE, allowedKey: "rupees_5_to_10_crore_premature_withdrawal_allowed", notAllowedKey: "rupees_5_to_10_crore_premature_withdrawal_not_allowed" },
  { min: 10 * CRORE, max: 25 * CRORE, allowedKey: "rupees_10_to_25_crore_premature_withdrawal_allowed", notAllowedKey: "rupees_10_to_25_crore_premature_withdrawal_not_allowed" },
  { min: 25 * CRORE, max: 50 * CRORE, allowedKey: "rupees_25_to_50_crore_premature_withdrawal_allowed", notAllowedKey: "rupees_25_to_50_crore_premature_withdrawal_not_allowed" },
  { min: 50 * CRORE, max: 100 * CRORE, allowedKey: "rupees_50_to_100_crore_premature_withdrawal_allowed", notAllowedKey: "rupees_50_to_100_crore_premature_withdrawal_not_allowed" },
  { min: 100 * CRORE, max: null, allowedKey: "rupees_100_crore_and_above_premature_withdrawal_allowed", notAllowedKey: "rupees_100_crore_and_above_premature_withdrawal_not_allowed" },
];

/** Bulk (₹3cr+) card: six amount tiers, each with a premature-withdrawal-allowed and a not-allowed rate. */
export const karurVysyaBankBulk: Adapter = async (ctx) => {
  const data = parseJsonData<KvbBulkData>(ctx.doc.text, "KVB bulk-deposit-rates API");
  const effectiveFrom = findEffectiveDate(data.content_above_the_table ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the API's content_above_the_table");
  const periods = data.interest_rates;
  if (!Array.isArray(periods) || periods.length === 0) throw new AdapterError("KVB bulk-deposit-rates API returned no interest_rates rows");

  const rows: RateRow[] = [];
  for (const row of periods) {
    const label = cleanText(row.period ?? "");
    if (!label) continue;
    const tenure = parseTenure(normaliseTenureLabel(label));
    if (!tenure) throw new AdapterError(`cannot read bulk tenure "${label}"`);
    const special = tenure.point && tenure.minDays % 365 !== 0 ? true : undefined;
    for (const tier of BULK_TIERS) {
      const allowed = parseRate(row[tier.allowedKey] ?? "");
      const notAllowed = parseRate(row[tier.notAllowedKey] ?? "");
      if (allowed !== null) {
        rows.push({ tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: label, special, amountMin: tier.min, amountMax: tier.max, customer: "general", residency: "resident", callable: true, payout: null, rate: allowed });
      }
      if (notAllowed !== null) {
        rows.push({ tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: label, special, amountMin: tier.min, amountMax: tier.max, customer: "general", residency: "resident", callable: false, payout: null, rate: notAllowed, note: "Non-callable (no premature withdrawal)" });
      }
    }
  }
  if (rows.length === 0) throw new AdapterError("bulk table produced no rows");
  const notes = ["KVB does not publish a separate senior-citizen rate for bulk deposits on this page."];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes })] };
};

interface KvbSavingsData {
  content_above_table?: string;
  interest_rates?: { values?: Array<{ slab: string; interest_rate: string }> };
}

/** Savings account slabs: nine EOD-balance bands, no stated whole/incremental method. */
export const karurVysyaBankSavings: Adapter = async (ctx) => {
  const data = parseJsonData<KvbSavingsData>(ctx.doc.text, "KVB savings-interest-rates API");
  const effectiveFrom = findEffectiveDate(data.content_above_table ?? "");
  if (!effectiveFrom) throw new AdapterError("effective date not found in the API's content_above_table");
  const values = data.interest_rates?.values;
  if (!Array.isArray(values) || values.length === 0) throw new AdapterError("KVB savings-interest-rates API returned no slab values");

  const slabs = values.flatMap((v) => {
    const rate = parseRate(v.interest_rate ?? "");
    if (rate === null) return [];
    const label = cleanText(v.slab ?? "");
    // parseAmountBand only recognises "above X" at the very start of the label; KVB prefixes
    // it with "EOD balance " / "EOD Balance ", so that fixed prefix is stripped first.
    const band = parseAmountBand(label.replace(/^eod\s+balance\s+/i, ""));
    if (!band) throw new AdapterError(`unexpected savings slab label "${label}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
