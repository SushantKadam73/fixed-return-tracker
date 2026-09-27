/**
 * Dhanlaxmi Bank — dhan.bank.in (post-2025 address; legacy dhanbank.com still resolves).
 * Single page covered: "Interest Rates" (interest-rates) — a plain server-rendered page (no
 * JS needed) holding, as separate HTML tables in this order: loan/MCLR rates (skipped, not a
 * deposit product), a one-row "Retail Non-callable Deposits" table (>₹1cr-<₹3cr), the main
 * "Term Deposits-Domestic & NRO Deposits" retail table (general rate only — see below for how
 * the senior-citizen rate is derived), a footnote block (senior premium + premature-penalty
 * text, itself parsed as a one-cell "table"), an NRE-only table (skipped: NRE-only tables are
 * out of scope for this tracker, matching this group's other adapters), a Savings Account
 * table, two Bulk Deposit tables ("...Domestic Term Deposits Only" = callable/"Regular", and
 * "...Non Callable only") with tenure as columns and amount band as rows, and FCNR/RFC tables
 * (skipped — foreign-currency, out of scope for this pass).
 *
 * Senior-citizen rate: the retail table has no senior column at all. Instead, a footnote states
 * "Senior citizens are eligible for an additional interest rate of 0.50% p.a. for all domestic
 * term deposits of 1 year and above" — this adapter reads that premium and its floor tenure
 * from the footnote's own text each run (never hardcoded) and adds it to every general-rate row
 * at or above the floor, quoting the exact statement in each derived row's note. Below the
 * floor tenure, the bank does not say senior citizens get anything different, so no senior row
 * is emitted there (nothing published for that combination, not "same as general" by guess).
 * The same derivation is applied to the one non-callable-retail row (its tenure "12-13 months"
 * is above the floor); bulk deposits explicitly state no senior benefit is offered at all.
 *
 * Quirks handled here:
 *  - Amount-band labels ("above ₹1 Crore upto Rs 3 Crore", "Above Rs.1 Lakh and upto Rs.5 Lakh")
 *    have enough surrounding prose that the shared `parseAmountBand`'s start-anchored "above"
 *    check, and its \bto\b-based upper-inclusive check (defeated by "upto" as one word), never
 *    fire; read here with a local `parseBand` (keyword search anywhere in the label) instead —
 *    the same helper used by DCB Bank for the same reason.
 *  - Adjacent bands word their shared boundary inconsistently — the savings ladder's "upto ₹5
 *    Lakh" is followed by "above ₹5 Lakh" (₹5,00,000 belongs to the first band), while the bulk
 *    ladder's "upto ₹10 Crore" is followed by a bare "₹10 Crore" with no "above" (₹10,00,00,000
 *    belongs to the second). `chainBands()` sidesteps the ambiguity by deriving every band's max
 *    from the next band's own (unambiguous) min, rather than trusting either band's stated max.
 *  - The savings table restates the whole ladder as one row per newly-unlocked column (row "a"
 *    has only the first column filled, row "h" has all eight) rather than one row per slab;
 *    this adapter reads only the last ("h", fullest) domestic row, matching CSB's technique for
 *    a similarly-shaped table.
 *  - Both bulk tables have amount bands as ROWS and tenures as COLUMNS (the opposite of every
 *    other table on this page), so they are parsed by a small local loop (`parseTransposedBulk`)
 *    instead of `parseTermTable`, which assumes tenure-as-rows.
 *
 * Not covered: RD. The page has no Recurring Deposit table, and the dedicated "Laxmi Recurring
 * Deposits" product page is pure marketing copy with no rate table and no statement that RD
 * rates equal FD/TD rates — so, per policy, RD is left out rather than derived.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard } from "./helpers";

/**
 * Amount-band labels here ("above ₹1 Crore upto Rs 3 Crore", "Rs.5 Crore and upto Rs.10 Crore")
 * have enough surrounding prose that the shared `parseAmountBand` mis-reads them (see file
 * header); this looks for the same keywords anywhere in the label instead. Only the `min` this
 * returns is trusted directly — `max` is a fallback for whichever band turns out to be last in
 * its ladder; every other band's max comes from `chainBands()` below.
 */
function parseBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  const hasAndAbove = /(?:\band\b|&)\s*above\b|\bonwards\b/i.test(t);
  const hasAbove = /\babove\b|>/i.test(t);
  const hasUpTo = /\bup\s*to\b/i.test(t);
  const hasLessThan = /\bless than\b/i.test(t);
  if (nums.length >= 2) {
    const [a, b] = nums;
    return { min: hasAbove ? a + 1 : a, max: b };
  }
  if (nums.length === 1) {
    const [x] = nums;
    if (hasAndAbove) return { min: x, max: null };
    if (hasAbove) return { min: x + 1, max: null };
    if (hasUpTo) return { min: 0, max: x + 1 };
    if (hasLessThan) return { min: 0, max: x };
  }
  throw new AdapterError(`Dhanlaxmi: cannot read amount band "${label}"`);
}

/**
 * The bank writes an ordered ladder of amount bands (savings slabs, bulk-deposit bands) with
 * inconsistent inclusive/exclusive wording at each shared boundary — e.g. the savings ladder
 * pairs "upto ₹5 Lakh" with the next band's "above ₹5 Lakh" (so ₹5,00,000 itself belongs to the
 * *first*), while the bulk ladder pairs "upto ₹10 Crore" with a bare "₹10 Crore" on the next
 * band with no "above" (so ₹10,00,00,000 belongs to the *second*). Rather than guess which
 * convention a given "upto" means, each band's own MIN is unambiguous (a plain number, or
 * "above X" = x+1, or "and above"/"onwards" = x) — so this takes every band's min at face value
 * and sets its max to the *next* band's min, leaving no gap and no overlap regardless of how
 * "upto" was worded. Only the last band's own max (typically null, open-ended) is kept.
 */
function chainBands(labels: string[]): Array<{ min: number; max: number | null }> {
  const bands = labels.map(parseBand);
  for (let i = 0; i < bands.length - 1; i++) bands[i].max = bands[i + 1].min;
  return bands;
}

interface SeniorPremium {
  pp: number;
  floorDays: number;
  statement: string;
}

/** Reads the senior-citizen premium and its floor tenure from the footnote's own text each run
 * (never hardcoded) — see file header. */
function readSeniorPremium(grids: Grid[]): SeniorPremium {
  const footnote = grids.find((g) => /senior citizens are eligible/i.test(headerText(g, 1)));
  if (!footnote) throw new AdapterError('Dhanlaxmi: senior-citizen premium footnote ("Senior citizens are eligible...") not found');
  const text = headerText(footnote, footnote.rows.length);
  const m = /additional interest rate of\s*([\d.]+)\s*%\s*p\.?\s*a\.?\s*for all domestic term deposits of\s*(\d+)\s*years?\s*and above/i.exec(text);
  if (!m) throw new AdapterError(`Dhanlaxmi: could not parse the senior-citizen premium statement: "${text.slice(0, 200)}"`);
  return { pp: Number(m[1]), floorDays: Number(m[2]) * 365, statement: cleanText(m[0]) };
}

/** Adds the stated senior-citizen premium to every general row at or above the floor tenure;
 * nothing is emitted below the floor because the bank does not say what applies there. */
function withSeniorRows(rows: RateRow[], premium: SeniorPremium): RateRow[] {
  const senior = rows
    .filter((r) => r.customer === "general" && r.tenureMinDays >= premium.floorDays)
    .map((r) => ({
      ...r,
      customer: "senior" as CustomerType,
      rate: Math.round((r.rate + premium.pp) * 100) / 100,
      note: `General rate + ${premium.pp}pp senior-citizen premium (bank's own statement: "${premium.statement}").`,
    }));
  return [...rows, ...senior];
}

function findGrid(grids: Grid[], test: (g: Grid) => boolean, what: string): Grid {
  const g = grids.find(test);
  if (!g) throw new AdapterError(`Dhanlaxmi: table not found: ${what}`);
  return g;
}

export const dhanlaxmiFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const premium = readSeniorPremium(grids);

  const retailGrid = findGrid(grids, (g) => /term deposits-domestic.{0,5}(&|and).{0,5}nro deposits/i.test(headerText(g, 1)), "retail domestic/NRO term-deposit table");
  const effectiveFrom = findEffectiveDate(headerText(retailGrid, 2));
  if (!effectiveFrom) throw new AdapterError("Dhanlaxmi FD: effective date not found in the retail table's caption");
  let rows = parseTermTable(retailGrid, { columns: [{ header: /rate/i, customer: "general" }], amountMin: 0, amountMax: 3 * CRORE, callable: true });
  rows = withSeniorRows(rows, premium);

  const notes: string[] = [
    "This table's own heading covers 'Domestic & NRO Deposits' — the same rates apply to NRO term deposits, not only resident domestic ones; a separate NRO card is not produced here.",
    `Senior-citizen rows are derived (general rate + ${premium.pp}pp) only for tenures of ${premium.floorDays} days and above, per the bank's own statement; below that, the bank does not state a senior rate, so none is published here.`,
  ];

  const nonCallableGrid = grids.find((g) => /retail non-callable deposits/i.test(headerText(g, 1)));
  if (nonCallableGrid) {
    const ncEffectiveFrom = findEffectiveDate(headerText(nonCallableGrid, 2));
    const headerIdx = nonCallableGrid.rows.findIndex((r) => /^period$/i.test(cleanText(r[2] ?? "")));
    if (headerIdx < 0) throw new AdapterError('Dhanlaxmi non-callable: header row with a "Period" column not found');
    const ncRows: RateRow[] = [];
    for (const r of nonCallableGrid.rows.slice(headerIdx + 1)) {
      const amountLabel = cleanText(r[1] ?? "");
      const tenureLabel = cleanText(r[2] ?? "");
      const rate = parseRate(r[3] ?? "");
      if (!amountLabel || !tenureLabel || rate === null) continue;
      const band = parseBand(amountLabel);
      const tenure = parseTenure(tenureLabel);
      if (!tenure) throw new AdapterError(`Dhanlaxmi non-callable: cannot read tenure "${tenureLabel}"`);
      ncRows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: false,
        payout: null,
        rate,
      });
    }
    if (ncRows.length === 0) throw new AdapterError("Dhanlaxmi non-callable: no rows produced");
    rows.push(...withSeniorRows(ncRows, premium));
    if (ncEffectiveFrom && ncEffectiveFrom !== effectiveFrom) notes.push(`The non-callable retail table is dated ${ncEffectiveFrom}, separate from the main retail table's ${effectiveFrom}; both are used as printed.`);
  } else {
    notes.push("Retail non-callable table not found on this fetch.");
  }

  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes })],
    terms: [
      { product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: `+${premium.pp}pp for domestic term deposits of ${premium.floorDays} days and above (bank's own footnote, not a printed column).` },
    ],
  };
};

const BULK_ONLY = (g: Grid) => /bulk deposits/i.test(g.context) && !/non[\s-]*callable/i.test(g.context);
const BULK_NON_CALLABLE = (g: Grid) => /bulk deposits/i.test(g.context) && /non[\s-]*callable/i.test(g.context);

/** Both bulk tables have amount bands as ROWS and tenures as COLUMNS — the opposite of every
 * other table on this page — so they need this small local loop instead of `parseTermTable`. */
function parseTransposedBulk(grid: Grid, callable: boolean): RateRow[] {
  const headerIdx = grid.rows.findIndex((r) => /^tenure$/i.test(cleanText(r[0] ?? "")));
  if (headerIdx < 0) throw new AdapterError('Dhanlaxmi bulk: header row starting with "Tenure" not found');
  const tenureCols = grid.rows[headerIdx].slice(1).map((label) => {
    const tenure = parseTenure(cleanText(label));
    if (!tenure) throw new AdapterError(`Dhanlaxmi bulk: cannot read tenure column "${label}"`);
    return { label: cleanText(label), tenure };
  });
  const dataRows = grid.rows.slice(headerIdx + 1).filter((r) => cleanText(r[0] ?? ""));
  const bands = chainBands(dataRows.map((r) => cleanText(r[0] ?? "")));
  const rows: RateRow[] = [];
  dataRows.forEach((r, rowIdx) => {
    const band = bands[rowIdx];
    tenureCols.forEach((col, i) => {
      const rate = parseRate(r[i + 1] ?? "");
      if (rate === null) return; // not offered for this band/tenure combination
      rows.push({
        tenureMinDays: col.tenure.minDays,
        tenureMaxDays: col.tenure.maxDays,
        tenureLabel: col.label,
        special: col.tenure.point && col.tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    });
  });
  if (rows.length === 0) throw new AdapterError("Dhanlaxmi bulk: table produced no rows");
  return rows;
}

export const dhanlaxmiBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = findGrid(grids, BULK_ONLY, '"Bulk Deposits - Domestic Term Deposits Only" table');
  const nonCallableGrid = findGrid(grids, BULK_NON_CALLABLE, '"Bulk Deposits - Domestic Term Deposits - Non Callable only" table');

  const callableDate = findEffectiveDate((callableGrid.rows[0] ?? []).join(" "));
  const nonCallableDate = findEffectiveDate((nonCallableGrid.rows[0] ?? []).join(" "));
  const effectiveFrom = [callableDate, nonCallableDate].filter((d): d is string => !!d).sort().at(-1) ?? null;
  if (!effectiveFrom) throw new AdapterError("Dhanlaxmi bulk: effective date not found in either table's caption");

  const rows = [...parseTransposedBulk(callableGrid, true), ...parseTransposedBulk(nonCallableGrid, false)];

  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: [
          "Bank's own note: \"No senior citizen benefits available for single deposit of Rs.3 crore & above\" — no senior rows are produced for this card.",
          "The last tenure column on the callable table is labelled '1 Year & Upto 2 Years (Domestic and NRE)' — the bank's own page mixes an NRE mention into a table otherwise titled 'Domestic Term Deposits Only'; read here as-is without inferring a separate NRE card.",
        ],
      }),
    ],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, other: ["Bulk-deposit acceptance is subject to the Treasury Department's view of the bank's liquidity position (bank's own note)."] }],
  };
};

export const dhanlaxmiSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = findGrid(grids, (g) => /savings bank account rates/i.test(headerText(g, 1)), "savings table");
  const effectiveFrom = findEffectiveDate(headerText(grid, 1));
  if (!effectiveFrom) throw new AdapterError("Dhanlaxmi savings: effective date not found in the table caption");

  const headerIdx = grid.rows.findIndex((r) => /upto rs\.?\s*1\s*lakh/i.test(cleanText(r[1] ?? "")));
  if (headerIdx < 0) throw new AdapterError("Dhanlaxmi savings: balance-band header row not found");
  const bandLabels = grid.rows[headerIdx].slice(1).map((c) => cleanText(c));

  // The table restates the whole ladder as one row per newly-unlocked column ("a" through "h");
  // take the last lettered domestic row (the fullest reveal), stopping at the first non-lettered
  // row (the "B. Non Resident" section marker).
  let lastDomesticRow: string[] | null = null;
  for (const r of grid.rows.slice(headerIdx + 1)) {
    if (!/^[a-z]\)/i.test(cleanText(r[0] ?? ""))) break;
    lastDomesticRow = r;
  }
  if (!lastDomesticRow) throw new AdapterError("Dhanlaxmi savings: no lettered domestic balance rows found");

  const bands = chainBands(bandLabels);
  const slabs = bandLabels.flatMap((_label, i) => {
    const rate = parseRate(lastDomesticRow![i + 1] ?? "");
    if (rate === null) return [];
    return [{ balanceMin: bands[i].min, balanceMax: bands[i].max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("Dhanlaxmi savings: no balance slabs found");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        // The page states slabs are read off the account's own balance ("Accounts with balance
        // above X and upto Y") without saying whether that rate covers the whole balance or
        // only the incremental slice; not stated either way, so left as unknown.
        slabMethod: "unknown",
        notes: ["The same table's own 'B. Non Resident' rows (NRO and NRE) publish identical rates to the domestic slabs used here; not duplicated as separate cards."],
      }),
    ],
  };
};
