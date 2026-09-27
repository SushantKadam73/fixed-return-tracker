/**
 * Central Bank of India — centralbank.bank.in
 *
 * One page ("Interest Rate on Deposit") carries savings, retail (<3cr), bulk (3-10cr and
 * >10cr) and every named special scheme (333/444/555-day, CENT Green Deposit, CENT Floating
 * Deposit) in a long run of small, cleanly-formed tables — no nested-table or malformed-markup
 * issues here, unlike some other banks in this group.
 *
 * Card assignment: the callable special-tenure tables (333/444/555 days, CENT Green, CENT
 * Floating) never print an amount qualifier of their own, unlike their non-callable
 * counterparts, which are explicitly labelled "(Deposits above Rs 1 Cr)". Following the same
 * convention SBI's adapter uses for its own unqualified special tenure (Amrit Vrishti), this
 * adapter treats the callable special rows as part of the <3cr "fd" card and the "above ₹1
 * crore" non-callable rows as the <3cr card's non-callable band — both sit on the page among
 * the retail tables, before the ₹3cr+ bulk section starts.
 *
 * No RD adapter: this page only names "Recurring Deposit Scheme" as a nav link; it never states
 * that RD rates equal term-deposit rates, so nothing here can be derived with `deriveRdFromFd`.
 *
 * Effective dates: the ₹3-10cr bulk table's own header literally reads "Rates w.e.f." with the
 * date left blank, and the >₹10cr bulk table's header reads "Revised Rate (w.e.f. )" — an
 * empty pair of parentheses. Both are genuine gaps in the bank's own page (confirmed against
 * the raw fixture, not a parsing artifacts), so the "fd_bulk" card's `effectiveFrom` is null.
 * The CENT Green Deposit table separately prints two different dates for its General Public
 * (10.12.2025) and Senior Citizen (10.09.2025) columns — also as printed, not a parsing
 * artifact — so the card uses the General Public date and notes the Senior Citizen one.
 *
 * tax_saver: this page links a separate "Cent Tax Saving Deposit" scheme page (nav entry
 * "/en/cent-tax-saving-deposit"). That page does not publish its own number; its own "Rate of
 * Interest" heading says: "The rate of interest to be applied to Cent tax Savings Deposit
 * Scheme will be in accordance with the interest rate on domestic term deposits (upto Rs. 15
 * lacs) applicable to the five-year term" — a rate-parity statement, not a table. Because that
 * statement lives on a different page from the rate table it points at, `centralBankOfIndiaTaxSaver`
 * is registered against the *tax-saver page itself* (so it re-checks that statement is still
 * there on every run, throwing if it changes) and fetches this retail rates page via `ctx.fetch`
 * to read the actual number. The scheme's fixed 5-year tenure lands exactly on this retail
 * ladder's own tenure-band boundary: "5 years & above upto 10 years" is the one row whose range
 * starts at exactly 1825 days, so that row (both General Public and Senior Citizen — the
 * tax-saver page does not exclude senior citizens the way Indian Bank's equivalent does) is
 * reduced to a single point tenure at 1825 days rather than kept as the 5-10 year band a saver
 * could otherwise pick freely within. The "(upto Rs. 15 lacs)" qualifier does not correspond to
 * any actual sub-band on this page (the whole <3cr band is priced as one row), so it changes
 * nothing about which number applies; `amountMax` is left null rather than the retail row's own
 * <3cr band, since by law the scheme is capped at ₹1,50,000 per PAN per financial year.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, pageText, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import { parseTermTable, type ColumnSpec } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const GENERAL_SENIOR_COLUMNS: ColumnSpec[] = [
  { header: /general public/i, customer: "general", exclude: /yield/i },
  { header: /senior citizen/i, customer: "senior", exclude: /yield/i },
];

/** The rate (not the "Annualised yield") column's header cell carries "Rates w.e.f. <date>". */
function rateColumnDate(g: Grid): string | null {
  for (const row of g.rows.slice(0, 4)) {
    for (const cell of row) {
      if (/w\.?\s?e\.?\s?f\.?/i.test(cell) && !/annualised|yield/i.test(cell)) {
        const d = parseDate(cell);
        if (d) return d;
      }
    }
  }
  return null;
}

const isSavings = (g: Grid) => (g.rows[0] ?? []).some((c) => /revised rates? w\.?e\.?f/i.test(c));
const isRetailBelow3Cr = (g: Grid) => (g.rows[0] ?? []).some((c) => /less than rs\.?\s*3 crore/i.test(c));
const isBulk3To10Cr = (g: Grid) => (g.rows[0] ?? []).some((c) => /3\s*cr.*10\s*cr/i.test(c));
const isBulkAbove10Cr = (g: Grid) => /above ₹?10 crore/i.test(g.context);
const isCallable333 = (g: Grid) => (g.rows[0]?.[0] ?? "") === "Callable" && (g.rows[2]?.[0] ?? "").includes("333");
const isNonCallable333 = (g: Grid) => /non-callable/i.test(g.rows[0]?.[0] ?? "") && (g.rows[2]?.[0] ?? "").includes("333");
const isCallable444 = (g: Grid) => (g.rows[0]?.[0] ?? "") === "Callable" && (g.rows[2]?.[0] ?? "").includes("444");
const isNonCallable444 = (g: Grid) => /non-callable/i.test(g.rows[0]?.[0] ?? "") && (g.rows[2]?.[0] ?? "").includes("444");
const isCallable555 = (g: Grid) => (g.rows[0]?.[0] ?? "") === "Callable" && (g.rows[2]?.[0] ?? "").includes("555");
const isNonCallable555 = (g: Grid) => /non-callable/i.test(g.rows[0]?.[0] ?? "") && (g.rows[2]?.[0] ?? "").includes("555");
const isCentGreen = (g: Grid) => (g.rows[0] ?? []).some((c) => /cent green deposit/i.test(c));
const isCentFloating = (g: Grid) => (g.rows[0] ?? []).some((c) => /cent floating deposit/i.test(c));

/**
 * The special-tenure tables (333/444/555 days, CENT Green Deposit) declare their unit once in
 * the column header ("Period (days)") and then print bare numbers ("333", "1111", ...) in the
 * data cells. `parseTenure` reads only the cell itself and has no way to see that header, so a
 * bare integer fails to parse. Appending the implied "days" locally (only to cells that are
 * nothing but digits — every other table's labels already say their own unit) fixes this
 * without touching the shared tenure parser.
 */
function withDaysUnit(g: Grid): Grid {
  return {
    ...g,
    rows: g.rows.map((row) => {
      const label = cleanText(row[0] ?? "");
      return /^\d+$/.test(label) ? [`${label} days`, ...row.slice(1)] : row;
    }),
  };
}

function generalSeniorRows(g: Grid, amountMin: number, amountMax: number | null, callable: boolean): RateRow[] {
  return parseTermTable(withDaysUnit(g), { columns: GENERAL_SENIOR_COLUMNS, amountMin, amountMax, callable });
}

export const centralBankOfIndiaFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, isRetailBelow3Cr, "retail <3cr table");
  const effectiveFrom = rateColumnDate(retail);
  if (!effectiveFrom) throw new AdapterError("central-bank-of-india: retail effective date not found");

  const rows = [...generalSeniorRows(retail, 0, 3 * CRORE, true)];
  const notes: string[] = [];

  const specials: Array<{ find: (g: Grid) => boolean; days: number; name: string; callable: boolean; what: string }> = [
    { find: isCallable333, days: 333, name: "Central 333 Days Special Deposit", callable: true, what: "333-day callable" },
    { find: isNonCallable333, days: 333, name: "Central 333 Days Special Deposit", callable: false, what: "333-day non-callable" },
    { find: isCallable444, days: 444, name: "Central 444 Days Special Deposit", callable: true, what: "444-day callable" },
    { find: isNonCallable444, days: 444, name: "Central 444 Days Special Deposit", callable: false, what: "444-day non-callable" },
    { find: isCallable555, days: 555, name: "Central 555 Days Special Deposit", callable: true, what: "555-day callable" },
    { find: isNonCallable555, days: 555, name: "Central 555 Days Special Deposit", callable: false, what: "555-day non-callable" },
  ];
  for (const s of specials) {
    const g = requireGrid(grids, s.find, `${s.what} special-tenure table`);
    const amountMin = s.callable ? 0 : CRORE + 1;
    const specialRows = generalSeniorRows(g, amountMin, 3 * CRORE, s.callable).map((r) => ({ ...r, special: true, schemeName: s.name }));
    const specialDate = rateColumnDate(g);
    if (specialDate && specialDate !== effectiveFrom) notes.push(`${s.name} (${s.callable ? "callable" : "non-callable"}) revised w.e.f. ${specialDate}, printed separately from the main retail table's date.`);
    rows.push(...specialRows);
  }

  const green = requireGrid(grids, isCentGreen, "CENT Green Deposit table");
  // Row 2 is ["Period (days)", "Revised Rates w.e.f. <general date>", "Annualised yield",
  // "Revised Rates w.e.f. <senior date>", "Annualised yield"] — the bank prints two different
  // dates for the two customer columns on this one table (confirmed on the raw page).
  const greenGeneralDate = parseDate(green.rows[2]?.[1] ?? "");
  const greenSeniorDate = parseDate(green.rows[2]?.[3] ?? "");
  const greenRows = generalSeniorRows(green, 0, 3 * CRORE, true).map((r) => ({ ...r, special: true, schemeName: "CENT Green Deposit" }));
  rows.push(...greenRows);
  if (greenGeneralDate && greenSeniorDate && greenGeneralDate !== greenSeniorDate) {
    notes.push(`CENT Green Deposit: as printed, the General Public rate is dated w.e.f. ${greenGeneralDate} and the Senior Citizen rate w.e.f. ${greenSeniorDate} on the same table.`);
  }

  const floating = requireGrid(grids, isCentFloating, "CENT Floating Deposit table");
  const floatingRows = parseTermTable(floating, { columns: GENERAL_SENIOR_COLUMNS, amountMin: 0, amountMax: 3 * CRORE, callable: true }).map((r) => ({ ...r, schemeName: "CENT Floating Deposit" }));
  rows.push(...floatingRows);

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes: notes.length > 0 ? notes : undefined });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% typical (varies slightly by tenure — compare the General Public and Senior Citizen columns for the exact slab)",
        superSeniorPremium: "+0.75% over general public on non-callable deposits (age 80+); staff +1%, senior-ex-staff +1.50%, super-senior-ex-staff +1.75% (non-callable scheme only, not modelled as separate rows here — see the bank's page)",
        prematurePenalty: "1% flat on premature withdrawal (no penalty if renewed for a longer period); non-callable deposits generally disallow premature withdrawal",
      },
    ],
  };
};

export const centralBankOfIndiaBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const midBand = requireGrid(grids, isBulk3To10Cr, "₹3-10cr bulk table");
  const highBand = requireGrid(grids, isBulkAbove10Cr, "above-₹10cr bulk table");

  // Both tables' own date fields are printed blank on the bank's page — see file header note.
  const effectiveFrom = rateColumnDate(midBand);

  const rows = [...generalSeniorRows(midBand, 3 * CRORE, 10 * CRORE, true)];
  const bandHeaders = highBand.rows[2]?.slice(1) ?? [];
  const bands = bandHeaders.map((h) => parseAmountBand(h));
  for (const row of highBand.rows.slice(3)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`central-bank-of-india: cannot read bulk tenure "${label}"`);
    row.slice(1).forEach((cell, i) => {
      const rate = parseRate(cell);
      if (rate === null) return;
      const band = bands[i];
      if (!band) throw new AdapterError(`central-bank-of-india: cannot read amount-band header "${bandHeaders[i]}"`);
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: true,
        payout: null,
        rate,
      });
    });
  }

  const bulk = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: effectiveFrom ? undefined : ["The bank's page leaves the effective date blank for both the ₹3-10cr and >₹10cr bulk tables (confirmed on the raw page, not a parsing gap)."],
  });
  return { cards: [bulk], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE }] };
};

export const centralBankOfIndiaSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, isSavings, "savings slab table");
  const effectiveFrom = parseDate(g.rows[0]?.[3] ?? "");
  if (!effectiveFrom) throw new AdapterError("central-bank-of-india: savings effective date not found");

  const slabs: SavingsSlab[] = g.rows.slice(1).map((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = parseRate(r[3] ?? "");
    if (rate === null) throw new AdapterError(`central-bank-of-india: cannot read savings rate for slab "${label}"`);
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`central-bank-of-india: cannot read savings balance slab "${label}"`);
    return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
  });
  if (slabs.length === 0) throw new AdapterError("central-bank-of-india: no savings slabs found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown" })] };
};

/** The retail rates page this card's number is read from (see file header) — not the source
 * `ctx` fetches, since the tax-saver page's own rate-parity statement is what this adapter's
 * own source registration re-checks each run. */
const RATES_PAGE_URL = "https://centralbank.bank.in/en/interest-rates-on-deposit";
const TAX_SAVER_STATEMENT = /cent tax saving?s? deposit scheme will be in accordance with the interest rate on domestic term deposits/i;
const TAX_SAVER_FIVE_YEAR_TERM = /five[\s-]year term/i;
const TAX_SAVER_DAYS = 5 * 365; // 1825 days — Section 80C 5-year lock-in.

/** tax_saver: derived from the retail FD table's "5 years & above upto 10 years" row (see file
 * header) — reduced to the single 5-year point tenure the scheme actually uses, not read from a
 * separately-published tax-saver table (the bank does not have one). */
export const centralBankOfIndiaTaxSaver: Adapter = async (ctx) => {
  const text = pageText(ctx.doc.text);
  if (!TAX_SAVER_STATEMENT.test(text) || !TAX_SAVER_FIVE_YEAR_TERM.test(text)) {
    throw new AdapterError("central-bank-of-india: the Cent Tax Saving Deposit page no longer states that its rate follows the domestic term deposit rate for the five-year term");
  }

  const mainDoc = await ctx.fetch(RATES_PAGE_URL, "html");
  const grids = extractTables(mainDoc.text);
  const retail = requireGrid(grids, isRetailBelow3Cr, "retail <3cr table");
  const effectiveFrom = rateColumnDate(retail);
  if (!effectiveFrom) throw new AdapterError("central-bank-of-india: retail effective date not found (for tax-saver derivation)");

  const rows: RateRow[] = generalSeniorRows(retail, 0, 3 * CRORE, true)
    .filter((r) => r.tenureMinDays === TAX_SAVER_DAYS)
    .map((r) => ({ ...r, tenureMinDays: TAX_SAVER_DAYS, tenureMaxDays: TAX_SAVER_DAYS, tenureLabel: "5 years (Cent Tax Saving Deposit)", amountMin: 0, amountMax: null }));
  if (rows.length === 0) {
    throw new AdapterError('central-bank-of-india: no retail row starting at exactly 5 years ("5 years & above upto 10 years") found on the rates page to derive the tax-saver rate from');
  }

  return {
    cards: [
      makeCard(ctx, "tax_saver", rows, {
        effectiveFrom,
        notes: [
          `Bank's own "Cent Tax Saving Deposit" page: "The rate of interest to be applied to Cent tax Savings Deposit Scheme will be in accordance with the interest rate on domestic term deposits (upto Rs. 15 lacs) applicable to the five-year term." Derived from the retail FD table's "5 years & above upto 10 years" row — the band that starts at exactly 5 years, the tenure this scheme's Section 80C lock-in actually uses — read from ${RATES_PAGE_URL}, not from a separately-published tax-saver table.`,
          "The retail table publishes only one <₹3 crore band with no ₹15 lakh sub-split, so the page's own \"(upto Rs. 15 lacs)\" qualifier does not change which number applies.",
          "Maximum investment ₹1,50,000 per PAN per financial year (Section 80C); premature withdrawal and loan/overdraft against this deposit are not allowed, per the scheme's own page.",
        ],
      }),
    ],
  };
};
