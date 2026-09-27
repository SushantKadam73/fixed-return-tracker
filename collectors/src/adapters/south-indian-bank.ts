/**
 * South Indian Bank — southindianbank.bank.in
 *
 * Page covered: "Interest Rates - Deposits"
 * (https://www.southindianbank.bank.in/quick-links/interest-rates/deposits) — one large page
 * with a separate HTML table per product: domestic retail term deposits (<₹3 crore), savings,
 * NRE term deposits, retail non-callable term deposits (₹1–3 crore), FCNR(B), RFC, the
 * Kalpakanidhi quarterly-compounding scheme, and — further down — bulk (≥₹3 crore) resident and
 * NRE term deposits, both callable and non-callable. No recurring-deposit table or "RD = FD"
 * statement appears anywhere on this page, so no RD card is produced (see notes below).
 *
 * Quirks handled locally (no shared file touched):
 *  - The whole rates section on this page is wrapped in one <form> tag (a client-side filter
 *    control around content that isn't otherwise form-related). The shared trim-fixture.ts
 *    script deletes `form` elements wholesale, which would delete every table with it — so the
 *    checked-in fixture was built by unwrapping the <form> first, then running trim-fixture.ts
 *    on the result (see the fixture's own generation note). The live adapter itself does not
 *    need this workaround because extractTables() does not strip `<form>`.
 *  - A few tenure labels have typos or phrasing the shared parseTenure cannot read:
 *      "100 daysto 180 days"  → missing space ("daysto"), read as if it had no unit at all.
 *      "Above 390 Days to up to and including 2 Years" → the repeated "to ... to" text splits
 *      into three pieces instead of two, so parseTenure silently mis-multiplies the two ends
 *      together instead of throwing (390 + 2 years turned into 1121+ days). We rewrite both
 *      patterns to a form parseTenure already understands (normaliseTenureLabel) before
 *      handing the grid to parseTermTable, and use the rewritten text as tenureLabel too —
 *      the same kind of local rewrite the collectors/README.md explicitly sanctions ("1 Yr -
 *      <2 Yrs" → "1 year to less than 2 years").
 *  - "Tax Gain ( 5 Years )" keeps its duration inside parentheses, which parseTenure discards
 *    (parentheses are treated as scheme-name annotations), leaving no digits to parse. We skip
 *    that one row in the generic pass (skipRow) and read it by hand, knowing 5 years = 1825 days.
 *  - The bulk tables (≥₹3 crore) put each amount tier in its own COLUMN rather than each row
 *    covering all tiers, and every tier is priced the same "general" customer (no senior-citizen
 *    column at all above ₹3 crore, confirmed by the page's own "No additional interest will be
 *    paid to Senior citizen for deposits of Rs.3.00 Crore and above"). We call the shared
 *    parseTermTable once per amount tier (its `columns` abstraction normally varies by customer
 *    type, but nothing stops it varying by amount band the same way) and merge the results.
 */
import type { CustomerType, RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** Fix the tenure-column typos/phrasing this page uses that the shared parseTenure cannot read. */
function normaliseTenureLabel(label: string): string {
  return label
    .replace(/daysto/gi, "days to") // "100 daysto 180 days"
    .replace(/\bto\s+up\s*to\s+and\s+including\b/gi, "upto") // "... to up to and including 2 Years"
    .replace(/\bto\s+up\s*to\s+and\s+less\s+than\b/gi, "upto less than"); // "... to up to and less than 3 Years"
}

function normaliseGridTenures(g: Grid): Grid {
  return { ...g, rows: g.rows.map((r) => [normaliseTenureLabel(r[0] ?? ""), ...r.slice(1)]) };
}

/** The "Tax Gain ( 5 Years )" row: duration is inside parens, so read it by hand. */
function taxGainRow(grid: Grid): RateRow[] {
  const row = grid.rows.find((r) => /tax gain/i.test(r[0] ?? ""));
  if (!row) return [];
  const days = 1825; // 5 years
  const cols: Array<[number, CustomerType]> = [
    [1, "general"],
    [2, "senior"],
  ];
  const out: RateRow[] = [];
  for (const [idx, customer] of cols) {
    const rate = parseRate(row[idx] ?? "");
    if (rate === null) continue;
    out.push({
      tenureMinDays: days,
      tenureMaxDays: days,
      tenureLabel: cleanText(row[0]),
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer,
      residency: "resident",
      callable: true,
      payout: null,
      rate,
      note: "5-year tax-saving fixed deposit (Section 80C).",
    });
  }
  return out;
}

export const sibFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, (g) => /domestic term deposit/i.test(g.context) && !/non callable/i.test(g.context), "domestic retail term deposit card");
  const nonCallable = requireGrid(grids, (g) => /non callable domestic/i.test(g.context), "retail non-callable term deposit card (₹1-3 crore)");

  const retailG = normaliseGridTenures(retail);
  const retailRows = parseTermTable(retailG, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    skipRow: /tax gain/i,
  });
  const nonCallableRows = parseTermTable(nonCallable, {
    columns: [
      { header: /general/i, customer: "general" },
      { header: /senior/i, customer: "senior" },
    ],
    amountMin: 1 * CRORE,
    amountMax: 3 * CRORE,
    callable: false,
  });

  const rows = [...retailRows, ...nonCallableRows, ...taxGainRow(retailG)];
  const effectiveFrom = findEffectiveDate(retail.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the domestic term deposit table's lead-in text");

  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: [
      "No recurring-deposit rate table or 'RD rates equal FD rates' statement appears on this page, so no RD card is produced for South Indian Bank.",
      "'66 months (Green deposit)' is a named scheme at a whole-year-multiple tenor, not a single-day special tenure.",
    ],
  });

  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. (all tenures, resident individuals only)",
        seniorPremiumCap: "Below ₹3 crore — bank states: \"No additional interest will be paid to Senior citizen for deposits of Rs.3.00 Crore and above\"",
        prematurePenalty: "1% for all tenors and all deposit amounts on premature withdrawal/reinvestment of retail rupee term deposits (incl. NRE & RD), effective 26 March 2026 (supersedes the earlier 0.50%/<₹5 lakh, 1%/≥₹5 lakh rule)",
        other: ["No additional interest is paid to senior citizens on NRE term deposits.", "No interest is paid if a deposit is closed within one year."],
      },
    ],
  };
};

/**
 * "Less than X" / "X - less than Y" / "X and above" savings-slab labels on this page.
 * All three already say "less than" for the exclusive end and start exactly at the lower
 * figure, which is exactly the half-open [min, max) the domain model wants — no boundary
 * nudge needed (contrast RBL's savings table, which needed a +1 for its "Above X" wording).
 */
function parseSibBand(label: string): { min: number; max: number | null } {
  const t = label.toLowerCase();
  const nums = amountsIn(t);
  if (nums.length === 0) throw new AdapterError(`unrecognised amount label "${label}"`);
  if (/^less than/.test(t.trim())) return { min: 0, max: nums[0] };
  if (nums.length >= 2) return { min: nums[0], max: nums[1] };
  if (/and above/.test(t)) return { min: nums[0], max: null };
  throw new AdapterError(`unrecognised amount label "${label}"`);
}

export const sibSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /interest rate on savings account/i.test(g.context), "savings account interest table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings table's lead-in text");

  const slabs: SavingsSlab[] = grid.rows
    .slice(1)
    .map((r) => {
      const rate = parseRate(r[1] ?? "");
      if (rate === null) throw new AdapterError(`unreadable savings rate "${r[1]}"`);
      const band = parseSibBand(cleanText(r[0]));
      return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const };
    });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");

  const card = makeCard(ctx, "savings", [], {
    effectiveFrom,
    savingsSlabs: slabs,
    slabMethod: "unknown",
    notes: ["Page states the rate 'on' each end-of-day-balance band without saying whether the whole balance or only the slice within the band earns that rate, so slabMethod is left unknown rather than guessed."],
  });
  return { cards: [card] };
};

/** ₹3 crore+ bulk tables put every amount tier in its own column, each headed "Rs. X Cr to less than Rs. Y Cr" (or "... and above" for the top tier). */
const BULK_TIERS: Array<{ startsWith: RegExp; min: number; max: number | null }> = [
  { startsWith: /^rs\.?\s*3\.00\s*cr/i, min: 3 * CRORE, max: 5 * CRORE },
  { startsWith: /^rs\.?\s*5\.00\s*cr/i, min: 5 * CRORE, max: 10 * CRORE },
  { startsWith: /^rs\.?\s*10\.00\s*cr/i, min: 10 * CRORE, max: 25 * CRORE },
  { startsWith: /^rs\.?\s*25\s*cr/i, min: 25 * CRORE, max: 50 * CRORE },
  { startsWith: /^rs\.?\s*50\.00\s*cr/i, min: 50 * CRORE, max: 100 * CRORE },
  { startsWith: /^rs\.?\s*100\s*cr/i, min: 100 * CRORE, max: 200 * CRORE },
  { startsWith: /^rs\.?\s*200\s*cr\s*and\s*above/i, min: 200 * CRORE, max: null },
];

function bulkRows(grid: Grid, callable: boolean): RateRow[] {
  const g = normaliseGridTenures(grid);
  return BULK_TIERS.flatMap((tier) =>
    parseTermTable(g, { columns: [{ header: tier.startsWith, customer: "general" }], amountMin: tier.min, amountMax: tier.max, residency: "resident", callable }),
  );
}

export const sibBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = requireGrid(grids, (g) => /resident term deposits of rs\.?\s*3 crore/i.test(g.context) && !/non-callable/i.test(g.context), "bulk resident term deposit card (callable)");
  const nonCallableGrid = requireGrid(grids, (g) => /resident term deposits \(non-callable\) of rs\.?\s*3 crore/i.test(g.context), "bulk resident term deposit card (non-callable)");

  const rows = [...bulkRows(callableGrid, true), ...bulkRows(nonCallableGrid, false)];
  const effectiveFrom = findEffectiveDate(callableGrid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the bulk term deposit table's lead-in text");

  const card = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: ["No senior-citizen column on either bulk table — one 'general' rate applies to every customer per tenure/amount tier, consistent with the bank's ₹3 crore senior-premium cutoff."],
  });
  return { cards: [card] };
};
