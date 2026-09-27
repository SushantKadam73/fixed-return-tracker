/**
 * Karur Vysya Bank (KVB) — kvb.bank.in
 * Pages: "Resident / NRO Deposits" (general-public + senior-citizen domestic/NRO term
 * deposit cards, retail below ₹3cr), "Bulk Term Deposit Rates" (₹3cr and above, six amount
 * tiers, each with a premature-withdrawal-allowed and a not-allowed rate), "Interest Rate
 * for Savings Accounts". All three are rendered client-side: a plain HTTP fetch returns 200
 * with zero rate figures and there is no embedded JSON/data endpoint in the raw HTML, so
 * these sources must run with format "browser" — confirmed by loading the live pages with a
 * real headless browser, where the tables only appear after the page's JS runs.
 *
 * RD: KVB's own "Policy on Deposits" PDF (docs/policy-on-deposits.pdf) states: "Recurring
 * deposits shall carry the interest rate offered for different maturities as applicable to
 * other term deposits and there shall be no differential pricing according to the amount of
 * the instalment." That is an explicit rate-parity statement, so the RD card is derived from
 * the FD card via `deriveRdFromFd` rather than read from a rate-by-tenure table of its own
 * (KVB does not publish one).
 *
 * Quirks worked around locally (kept out of the shared parsers on purpose):
 *  - The retail table's tenure column header is "Time Bucket", which the shared
 *    `tenureHeader` default (tenor/tenure/period/maturity/duration/days/term) does not match,
 *    so both retail calls pass an explicit `tenureHeader` including "time bucket".
 *  - The retail table's "271 to < 1 Year" row omits the "Days" unit on its lower bound
 *    (every neighbouring row spells out "Days" explicitly); `normaliseTenureLabel` inserts
 *    the missing unit before `parseTermTable` calls `parseTenure`.
 *  - "Green Deposits (2345 days)" is a named special-tenure row, like SBI's Amrit Vrishti:
 *    its tenure is the day count printed in its own label, read with a small regex, not
 *    guessed. "For KVB - Tax Shield Deposits" (a 5-year tax saver) and "Rainbow Deposits
 *    (RBFD)" (a separate flexi/RD-linked scheme) are printed in the same table but without a
 *    tenure band of their own on this page, so they are skipped rather than assigned one.
 *    A fourth section this page's own JS also requests, "Flexi Term Deposit" (a single "300
 *    days" / 3.25% row per the page's JSON API), was not present in the rendered DOM when the
 *    fixture was captured, so it is a known gap here, not something dropped deliberately.
 *  - This page's own, server-rendered `<h1>` — present before the JS-filled tables even
 *    load, confirmed with a plain curl of the page shell — titles the whole page "Resident /
 *    NRO Deposits", and its general-public table has no separate NRO column or rate (one
 *    "Revised Rate" column serves both). So the general-public rows are produced twice, once
 *    per residency ("resident" and "nro"), from the one published number; the adapter throws
 *    if that heading text ever disappears rather than silently keep guessing residency scope.
 *    The senior-citizen table is excluded from this: its own page text says "Senior Citizen
 *    rates are not applicable to NRI", so senior rows stay Resident-only.
 *  - The bulk table repeats an identical "Premature Withdrawal Allowed / Not Allowed" column
 *    pair once per amount tier, so a single header regex can't tell tiers apart (`findIndex`
 *    would always land on the first). It is walked by fixed column position instead of
 *    through `parseTermTable`.
 *  - The bulk page's own "effective from" date is filled in by the page's script to the
 *    day it is loaded (bulk/Treasury rates are set daily per KVB's policy), so the date we
 *    read from that page will normally equal the day the collector runs.
 *  - `parseAmountBand` (parse/amount.ts) only treats a band as starting *above* its lower
 *    number when the label begins with "above"/"more than"/etc; KVB's savings labels prefix
 *    that word with "EOD balance ", so the check never fires. We strip that fixed prefix
 *    before calling it rather than changing the shared helper.
 */
import type { CustomerType, RateRow, Residency } from "../../../lib/domain";
import { findEffectiveDate, parseRate } from "../parse/common";
import { parseAmountBand } from "../parse/amount";
import { extractTables, pageText } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerText, makeCard, requireGrid } from "./helpers";

const TENURE_RE = /time bucket|tenor|tenure|period|maturity|duration|days|term/i;
/** Named schemes printed in the same table but with no tenure band of their own here. */
const NAMED_SCHEME_NO_TENURE = /tax shield|rainbow deposits/i;
const GREEN_DEPOSITS = /green deposits/i;
/** The page's own server-rendered <h1>/<title> — confirms the general-public rows below apply
 * to both residencies (see file header). */
const RESIDENT_NRO_HEADING = /resident\s*\/\s*nro deposits/i;

/** See file header: "271 to < 1 Year" is missing its "Days" unit. */
function normaliseTenureLabel(label: string): string {
  return label.replace(/^(\d+)(\s+to\s*<)/i, "$1 Days$2");
}

function normaliseGrid(grid: ReturnType<typeof extractTables>[number]) {
  return { ...grid, rows: grid.rows.map((r) => [normaliseTenureLabel(r[0] ?? ""), ...r.slice(1)]) };
}

/** "Green Deposits (2345 days)" — a special tenure whose day count is printed in its own label. */
function greenDepositsRow(rows: string[][], customer: CustomerType, residency: Residency, amountMax: number): RateRow | null {
  const row = rows.find((r) => GREEN_DEPOSITS.test(r[0] ?? ""));
  if (!row) return null;
  const m = /\((\d+)\s*days?\)/i.exec(row[0]);
  const rate = parseRate(row[1] ?? "");
  if (!m || rate === null) return null;
  const days = Number(m[1]);
  return { tenureMinDays: days, tenureMaxDays: days, tenureLabel: row[0], special: true, schemeName: "Green Deposits", amountMin: 0, amountMax, customer, residency, callable: true, payout: null, rate };
}

const RETAIL_MAX = 3 * CRORE;

export const karurVysyaBankFd: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);

  // Confirms the residency scope asserted below (see file header) — fail loudly rather than
  // keep publishing an "nro" copy of the general rate if this page is ever restructured.
  if (!RESIDENT_NRO_HEADING.test(text)) {
    throw new AdapterError('page heading no longer reads "Resident / NRO Deposits" — cannot confirm the general-public rate applies to NRO too');
  }

  const generalGrid = requireGrid(grids, (g) => /domestic term deposits/i.test(g.context) && !/senior/i.test(g.context), "domestic/NRO general-public term deposit table");
  const seniorGrid = requireGrid(grids, (g) => /senior citizen deposits/i.test(g.context), "senior-citizen term deposit table");

  const effectiveFrom = findEffectiveDate(generalGrid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found near the Domestic Term Deposits heading");

  // Skip the two named-scheme rows that have no tenure band of their own here, plus Green
  // Deposits (parseTenure can't read "Green Deposits (2345 days)" as written) — added back
  // below with its day count read directly from the label.
  const skipRow = new RegExp(`${NAMED_SCHEME_NO_TENURE.source}|${GREEN_DEPOSITS.source}`, "i");
  const spec = (customer: CustomerType, residency: Residency) => ({ tenureHeader: TENURE_RE, columns: [{ header: /revised rate/i, customer }], amountMin: 0, amountMax: RETAIL_MAX, callable: true, skipRow, residency });

  const rows: RateRow[] = [
    // One published "Revised Rate" column serves Resident and NRO alike on this page (its own
    // heading is "Resident / NRO Deposits") — produced as two residency-tagged row sets from
    // the same source column, not guessed. Senior-citizen rows stay Resident-only (see below).
    ...parseTermTable(normaliseGrid(generalGrid), spec("general", "resident")),
    ...parseTermTable(normaliseGrid(generalGrid), spec("general", "nro")),
    ...parseTermTable(normaliseGrid(seniorGrid), spec("senior", "resident")),
  ];
  const green = [
    greenDepositsRow(generalGrid.rows, "general", "resident", RETAIL_MAX),
    greenDepositsRow(generalGrid.rows, "general", "nro", RETAIL_MAX),
    greenDepositsRow(seniorGrid.rows, "senior", "resident", RETAIL_MAX),
  ].filter((r): r is RateRow => r !== null);
  rows.push(...green);

  const notes = [
    "Senior-citizen rates are not published for tenures shorter than 333 days on this table — those tenures pay the general rate to everyone.",
    "Senior-citizen rates do not apply to NRI depositors (bank's own note), so senior rows are Resident only.",
    "General-public rows are duplicated as Resident and NRO: the page's own heading is \"Resident / NRO Deposits\" and publishes one shared rate column for both, not a separate NRO number.",
    "\"For KVB - Tax Shield Deposits\" (5-year tax saver) and \"Rainbow Deposits (RBFD)\" are listed on this page without a tenure band of their own, so they are not included as rows.",
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

/** Bulk (₹3cr+) card: six amount tiers, each with a premature-withdrawal-allowed and a not-allowed rate. */
export const karurVysyaBankBulk: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);
  const grid = requireGrid(grids, (g) => /bulk deposit interest rates/i.test(headerText(g, 1)), "bulk deposit rate table");

  // The "Rate of Interest on Bulk Term deposits with effect from <date>" lead line is the
  // first thing on the page, well before the table itself.
  const effectiveFrom = findEffectiveDate(text.slice(0, 200));
  if (!effectiveFrom) throw new AdapterError("effective date not found near the Bulk Term deposits heading");

  const TIERS: Array<{ min: number; max: number | null }> = [
    { min: 3 * CRORE, max: 5 * CRORE },
    { min: 5 * CRORE, max: 10 * CRORE },
    { min: 10 * CRORE, max: 25 * CRORE },
    { min: 25 * CRORE, max: 50 * CRORE },
    { min: 50 * CRORE, max: 100 * CRORE },
    { min: 100 * CRORE, max: null },
  ];
  const HEADER_ROWS = 3; // caption row, amount-tier row (colspan 2 per tier), Tenor/PW-allowed/not-allowed row
  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(HEADER_ROWS)) {
    const label = row[0] ?? "";
    if (!label) continue;
    const tenure = parseTenure(normaliseTenureLabel(label));
    if (!tenure) throw new AdapterError(`cannot read bulk tenure "${label}"`);
    TIERS.forEach((tier, i) => {
      const allowed = parseRate(row[1 + i * 2] ?? "");
      const notAllowed = parseRate(row[2 + i * 2] ?? "");
      if (allowed !== null) {
        rows.push({ tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: label, special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined, amountMin: tier.min, amountMax: tier.max, customer: "general", residency: "resident", callable: true, payout: null, rate: allowed });
      }
      if (notAllowed !== null) {
        rows.push({ tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: label, special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined, amountMin: tier.min, amountMax: tier.max, customer: "general", residency: "resident", callable: false, payout: null, rate: notAllowed, note: "Non-callable (no premature withdrawal)" });
      }
    });
  }
  if (rows.length === 0) throw new AdapterError("bulk table produced no rows");
  const notes = ["KVB does not publish a separate senior-citizen rate for bulk deposits on this page."];
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes })] };
};

/** Savings account slabs: nine EOD-balance bands, no stated whole/incremental method. */
export const karurVysyaBankSavings: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);
  const grid = requireGrid(grids, (g) => /slab/i.test(headerText(g, 1)) && /rate of interest/i.test(headerText(g, 1)), "savings slab table");
  const effectiveFrom = findEffectiveDate(text.slice(0, 200));
  if (!effectiveFrom) throw new AdapterError("effective date not found near the savings heading");

  const slabs = grid.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    // parseAmountBand only recognises "above X" at the very start of the label; KVB prefixes
    // it with "EOD balance " / "EOD Balance ", so that fixed prefix is stripped first.
    const band = parseAmountBand((r[0] ?? "").replace(/^eod\s+balance\s+/i, ""));
    if (!band) throw new AdapterError(`unexpected savings slab label "${r[0]}"`);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};
