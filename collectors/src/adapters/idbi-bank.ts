/**
 * IDBI Bank — idbi.bank.in (also served at idbibank.in and idbi.com; same site)
 *
 * Page covered: "Domestic Interest Rates" (https://www.idbi.bank.in/interest-rates.aspx) — one
 * large tabbed page that also carries MCLR/loan/MSME/Agri lending rates (out of scope here). The
 * deposit-relevant tables read by this file: Savings Bank Rate, the retail "Interest Rate on Term
 * Deposits" table (which itself embeds the Tax Saving FD, Vasundhara Green Deposit and Aarogya
 * Fixed Deposit named schemes as extra rows), the promotional "UtsavFD" and "IDBI Chiranjeevi —
 * Super Senior Citizen FD" special-bucket tables, "Systematic Savings Plan (SSP/SSP Plus)" (the
 * bank's own recurring-deposit product, explicitly called out elsewhere on the site — see
 * idbiRd below — as "Rebranding of Recurring Deposit"), and the Non-Callable/Callable "Bulk Term
 * Deposits (BTD)" tables (≥₹3 crore, 7 amount tiers as columns). A separate "RBI Repo link" and
 * "MIBOR link" Bulk Term Deposit table also exists on the same page for amounts above the top
 * BTD tier; both are floating-rate (a spread over Repo/MIBOR, no fixed % printed) and are not
 * included, matching how the floating-rate savings slabs above ₹500 crore are excluded too.
 *
 * Live reachability (2026-09-27): every direct-fetch attempt to www.idbibank.in and
 * www.idbi.bank.in from this sandbox returned HTTP 502 (confirmed across two domain aliases and
 * two retries a few minutes apart), and the platform's own browser tool was unable to hold a
 * stable session for this page in this run either. Built and tested instead from a genuine copy
 * of the same official page: the Internet Archive Wayback Machine capture at
 * https://web.archive.org/web/20260730071451id_/https://www.idbi.bank.in/interest-rates.aspx
 * (captured 2026-07-30, the most recent HTTP-200 capture found via the CDX API on 2026-09-27 —
 * see collectors/fixtures/idbi-bank/interest_rates.html for the trimmed copy and its own header
 * comment). Registered with runner "github" / active: true per the project's rule for pages
 * blocked from this sandbox: GitHub Actions runs from a different network and may well reach the
 * live page directly.
 *
 * Quirks handled locally (no shared file touched):
 *  - The retail term deposit table has an ">10 years to 20 years" row restricted by the bank's
 *    own footnote to specific court/tribunal-ordered beneficiaries only (not a product ordinary
 *    retail depositors can open), and its upper bound (20 years = 7300 days) exceeds this
 *    project's shared 10-year (3650-day) tenure ceiling (parse/tenure.ts's MAX_DAYS) that every
 *    adapter in this codebase relies on. It is skipped (skipRow) rather than clamped or guessed;
 *    see the note on the fd card.
 *  - The Tax Saving FD row ("5 Years") and the Aarogya Fixed Deposit row ("370 Days") are handled
 *    by hand (pickRow) rather than through the generic pass:
 *      - "5 Years" (capital Y, the Tax Saving FD row) would otherwise collide with the ordinary
 *        "5 years" (lowercase, a completely normal retail bucket at the same tenure) — the two
 *        rows are distinguished purely by the bank's own capitalisation, so skipRow only matches
 *        the capital-Y form.
 *      - Aarogya Fixed Deposit's single published rate (370 days, 6.10%) is laid out in the
 *        bank's own HTML as one cell with a colspan of 2 (spanning both the General and Senior
 *        Citizen columns); extractTables() expands a colspan by repeating the cell's text in
 *        every column it spans, which would otherwise manufacture a fake "senior: 6.10" row that
 *        the bank never actually published as a distinct senior figure. Read as general-only.
 *  - Vasundhara Green Deposit ("1111 Days") needs no special handling: it has two genuinely
 *    distinct General/Senior values and flows through the generic pass via `schemeNames`.
 *  - The promotional "UtsavFD" (555/700-day) and "IDBI Chiranjeevi — Super Senior Citizen FD"
 *    tables are read best-effort (not through requireGrid): the bank's own page states these
 *    buckets are "extended up to Sept 30, 2026" (three days after this adapter's live-check date
 *    of 2026-09-27), so a missing/renamed table here most likely means the promotion lapsed
 *    rather than a genuine layout change, and should not fail the whole card.
 *  - The two Bulk Term Deposit tables (Non-Callable, Callable) put each of 7 amount tiers in its
 *    own column, the same shape as South Indian Bank's and TMB's bulk tables in this group — one
 *    parseTermTable call per tier, merged.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const GENERAL = /general/i;
const SENIOR = /sr\.?\s*citizen|senior/i;

/** Exact-text row lookup (case sensitive — see file header re: "5 Years" vs "5 years"). */
function pickRow(grid: Grid, exactLabel: string): string[] | null {
  return grid.rows.find((r) => r[0] === exactLabel) ?? null;
}

/** "5 Years" — Tax Saving FD (Section 80C), read by hand so it can't collide with the ordinary "5 years" bucket. */
function taxSavingFdRow(grid: Grid): RateRow[] {
  const row = pickRow(grid, "5 Years");
  if (!row) return [];
  const out: RateRow[] = [];
  for (const [idx, customer] of [[1, "general"], [2, "senior"]] as const) {
    const rate = parseRate(row[idx] ?? "");
    if (rate === null) continue;
    out.push({
      tenureMinDays: 1825,
      tenureMaxDays: 1825,
      tenureLabel: "Tax Saving FD (5 Years)",
      special: true,
      schemeName: "Tax Saving FD",
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer,
      residency: "resident",
      callable: true,
      payout: null,
      rate,
      note: "5-year tax-saving fixed deposit (Section 80C); statutorily locked in.",
    });
  }
  return out;
}

/** "370 Days" — Aarogya Fixed Deposit; general-only (see file header re: the colspan-duplicated senior cell). */
function aarogyaRow(grid: Grid): RateRow[] {
  const row = pickRow(grid, "370 Days");
  if (!row) return [];
  const rate = parseRate(row[1] ?? "");
  if (rate === null) return [];
  return [
    {
      tenureMinDays: 370,
      tenureMaxDays: 370,
      tenureLabel: "Aarogya Fixed Deposit (370 Days)",
      special: true,
      schemeName: "Aarogya Fixed Deposit",
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer: "general",
      residency: "resident",
      callable: true,
      payout: null,
      rate,
      note: "General-customer rate only: the bank's own page repeats this one figure across both the General and Senior Citizen columns for this scheme (a colspan on the source cell, not a distinct senior-citizen premium), so no separate senior row is published here.",
    },
  ];
}

/** UtsavFD (555/700-day) and IDBI Chiranjeevi Super Senior Citizen FD — best-effort, see file header. */
function promotionalBucketRows(grids: Grid[], fdEffectiveFrom: string): { rows: RateRow[]; warnings: string[] } {
  const rows: RateRow[] = [];
  const warnings: string[] = [];
  const note = `Promotional bucket; the bank's own page states these tenures are "extended up to Sept 30, 2026" (as of the 2026-07-30 copy this adapter was built from) and may have lapsed or been further extended by the time this runs. Uses the main FD table's ${fdEffectiveFrom} revision date.`;

  const utsav = grids.find((g) => /utsavfd/i.test(g.context));
  if (utsav) {
    try {
      const parsed = parseTermTable(utsav, {
        headerRows: 2,
        tenureHeader: /special buckets/i, // this mini-table's tenure column is headed "Special Buckets", not "Period"/"Maturity"
        columns: [
          { header: /general/i, customer: "general" },
          { header: /senior/i, customer: "senior" },
        ],
        amountMin: 0,
        amountMax: 3 * CRORE,
        callable: true,
      });
      rows.push(...parsed.map((r) => ({ ...r, schemeName: "Utsav FD", note })));
    } catch (e) {
      warnings.push(`UtsavFD table found but could not be parsed (${e instanceof Error ? e.message : String(e)}); skipped.`);
    }
  } else {
    warnings.push("UtsavFD promotional table not found (may have lapsed past its stated Sept 30, 2026 validity); skipped.");
  }

  const chiranjeevi = grids.find((g) => /chiranjeevi/i.test(g.context));
  if (chiranjeevi) {
    try {
      const parsed = parseTermTable(chiranjeevi, {
        headerRows: 2,
        tenureHeader: /special buckets/i,
        columns: [{ header: /chiranjeevi/i, customer: "super_senior" }],
        amountMin: 0,
        amountMax: 3 * CRORE,
        callable: true,
      });
      rows.push(...parsed.map((r) => ({ ...r, schemeName: "IDBI Chiranjeevi Super Senior Citizen FD", note })));
    } catch (e) {
      warnings.push(`IDBI Chiranjeevi Super Senior Citizen FD table found but could not be parsed (${e instanceof Error ? e.message : String(e)}); skipped.`);
    }
  } else {
    warnings.push("IDBI Chiranjeevi Super Senior Citizen FD table not found (tied to the UtsavFD buckets' validity); skipped.");
  }

  return { rows, warnings };
}

export const idbiFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // A left-nav tab list ("Overview | Lending Rate (MCLR) | Interest Rate on Term Deposits | Tax
  // Saving Fixed Deposits | Systematic Savings Plan | ...") sits ahead of the Savings table too
  // and gets swept into ITS context, so a plain substring test would wrongly match that earlier
  // table. Requiring the "(" that only the real heading has (immediately before its own "w.e.f."
  // date) picks the right one -- the nav copy has no trailing "(...)".
  const grid = requireGrid(grids, (g) => /interest rate on term deposits\s*\(/i.test(g.context), "retail term deposit table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the retail term deposit table's lead-in text");

  const rows = parseTermTable(grid, {
    headerRows: 3,
    columns: [
      { header: GENERAL, customer: "general" },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    // "5 Years" (capital Y) is the Tax Saving FD row, handled by hand below; "370 Days" is
    // Aarogya, also handled by hand; the >10-20yr row exceeds this project's 10-year tenure model
    // and is restricted to specific court/tribunal beneficiaries (see the card's own notes).
    skipRow: /^5 Years$|^370 Days$|^>10 years to 20 years/,
    schemeNames: { 1111: "Vasundhara Green Deposit" },
  });

  const { rows: promoRows, warnings } = promotionalBucketRows(grids, effectiveFrom);
  const allRows = [...rows, ...taxSavingFdRow(grid), ...aarogyaRow(grid), ...promoRows];

  const fd = makeCard(ctx, "fd", allRows, {
    effectiveFrom,
    notes: [
      "Senior Citizen rate is +0.50 percentage points over General across every published tenure and named scheme on this page (retail slabs, Tax Saving FD, Vasundhara Green Deposit, Utsav FD) -- computed directly from the bank's own columns, not assumed.",
      'Bank states: "$ Maturity bucket is eligible only for deposits from following beneficiaries (with effect from January 1st, 2021). 1) Awards from Motor Accident Tribunal / Courts / Other Judicial/ Statutory Bodies, 2) Specific Cases of margin money for Bank Guarantees" for the >10 years to 20 years bucket -- not available to ordinary retail depositors, and its 20-year upper bound exceeds this project\'s shared 10-year tenure model, so it is left out entirely rather than clamped or guessed.',
      "Aarogya Fixed Deposit (370 days) is General-customer only; see the row's own note.",
    ],
  });

  return {
    cards: [fd],
    warnings,
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50pp across all published tenures and named schemes",
        prematurePenalty: "1% on the applicable rate for deposits closed prematurely (including sweep-ins and partial withdrawals)",
        other: [
          "Staff & Senior Citizen rates are not applicable to NRO & NRE Term Deposits.",
          "No interest is paid if the deposit is held for less than 7 days (the RBI-mandated minimum).",
        ],
      },
    ],
  };
};

export const idbiRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  // Same left-nav bleed as idbiFd above (the nav list also names this tab) -- require the "("
  // that only the real "Systematic Savings Plan (SSP /SSP Plus)..." heading has.
  const grid = requireGrid(grids, (g) => /systematic savings plan\s*\(/i.test(g.context), "Systematic Savings Plan (SSP) table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the Systematic Savings Plan table's lead-in text");

  const rows = parseTermTable(grid, {
    headerRows: 2,
    columns: [
      { header: GENERAL, customer: "general" },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  const card = makeCard(ctx, "rd", rows, {
    effectiveFrom,
    notes: [
      "Read directly from the bank's own Systematic Savings Plan (SSP/SSP Plus) table, not derived from the FD card. IDBI's sibling NRI interest-rate page names this exact product \"Systematic Savings Plan- (Rebranding of Recurring Deposit)\" -- confirming SSP is IDBI's own recurring-deposit product under a new name, even though this domestic page's own SSP heading does not repeat that parenthetical.",
      "amountMax reflects the bank's stated SSP monthly-instalment ceiling (\"any fixed amount from 500 to less than 3 crore every month\" per the SSP product page), not a total-deposit amount tier -- recurring deposits have no amount-tiered rate the way term deposits do.",
      "Bank states a 1% premature-withdrawal penalty applies (including sweep-ins and partial withdrawals), i.e. premature closure is permitted, hence callable: true.",
    ],
  });
  return { cards: [card] };
};

/** "Up-to Rs.X" / "Above Rs.X-Rs.Y" / "Above Rs.X to Rs.Y" savings-slab labels on this page. */
function parseIdbiSavingsBand(label: string): { min: number; max: number | null } {
  const t = label.toLowerCase();
  const nums = amountsIn(t);
  if (nums.length === 0) throw new AdapterError(`unrecognised savings slab label "${label}"`);
  const trimmed = t.trim();
  if (/^up-?to/.test(trimmed)) return { min: 0, max: nums[0] + 1 };
  if (/^above/.test(trimmed) && nums.length >= 2) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (/^above/.test(trimmed)) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised savings slab label "${label}"`);
}

export const idbiSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /savings bank rate/i.test(g.context), "savings bank rate table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings table's lead-in text");

  const slabs: SavingsSlab[] = [];
  for (const r of grid.rows.slice(1)) {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) continue; // MIBOR-linked slabs above ₹500cr have no fixed %, excluded rather than guessed
    const band = parseIdbiSavingsBand(cleanText(r[0]));
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs with a fixed published rate found");

  const card = makeCard(ctx, "savings", [], {
    effectiveFrom,
    savingsSlabs: slabs,
    slabMethod: "unknown",
    notes: [
      "The page states the floating (MIBOR-linked) slabs above ₹500 crore apply \"on entire balance\", but says nothing about whole-vs-incremental for the fixed-rate slabs below ₹500 crore that are published here, so slabMethod is left unknown rather than guessed.",
      "Slabs above ₹500 crore are MIBOR-linked (e.g. \"MIBOR Less 75 bps p.a.\", \"MIBOR + 101 bps p.a.\") with no fixed percentage printed, and are not included.",
    ],
  });
  return { cards: [card] };
};

/** Bulk Term Deposits: 7 amount tiers as columns, same shape as South Indian Bank's and TMB's bulk tables. */
const BULK_TIERS: Array<{ header: RegExp; exclude?: RegExp; min: number; max: number | null }> = [
  { header: /3\s*cr\.?\s*to\s*rs\.?\s*7\.5\s*cr/i, min: 3 * CRORE, max: 7.5 * CRORE },
  { header: />\s*7\.5\s*cr\s*to\s*rs\.?\s*10\s*cr/i, min: 7.5 * CRORE + 1, max: 10 * CRORE },
  { header: /rs\.?\s*10\s*cr\s*to\s*rs\.?\s*50\s*cr/i, min: 10 * CRORE + 1, max: 50 * CRORE },
  { header: /rs\.?\s*50\s*cr\s*to\s*rs\.?\s*100\s*cr/i, min: 50 * CRORE + 1, max: 100 * CRORE },
  { header: /rs\.?\s*100\s*cr\s*to\s*rs\.?\s*200\s*cr/i, min: 100 * CRORE + 1, max: 200 * CRORE },
  { header: /rs\.?\s*200\s*cr\s*to\s*rs\.?\s*500\s*cr/i, min: 200 * CRORE + 1, max: 500 * CRORE },
  { header: /rs\.?\s*500\s*cr/i, exclude: /200\s*cr\s*to/i, min: 500 * CRORE + 1, max: null },
];

function bulkRows(grid: Grid, callable: boolean): RateRow[] {
  return BULK_TIERS.flatMap((tier) =>
    parseTermTable(grid, {
      headerRows: 2,
      columns: [{ header: tier.header, exclude: tier.exclude, customer: "general" }],
      amountMin: tier.min,
      amountMax: tier.max,
      residency: "resident",
      callable,
    }),
  );
}

function bulkEffectiveDate(grid: Grid): string | null {
  const m = /w\.?\s?e\.?\s?f\.?\s*([\d./-]{6,10})/i.exec(grid.rows[0]?.[0] ?? "");
  return m ? parseDate(m[1]) : null;
}

export const idbiBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const nonCallableGrid = requireGrid(grids, (g) => /non-callable bulk term deposits/i.test(g.rows[0]?.[0] ?? ""), "Non-Callable Bulk Term Deposits table");
  const callableGrid = requireGrid(grids, (g) => /callable bulk term deposits/i.test(g.rows[0]?.[0] ?? "") && !/non-callable/i.test(g.rows[0]?.[0] ?? ""), "Callable Bulk Term Deposits table");

  const effectiveFrom = bulkEffectiveDate(nonCallableGrid) ?? bulkEffectiveDate(callableGrid);
  if (!effectiveFrom) throw new AdapterError("effective date ('w.e.f. ...') not found in either Bulk Term Deposits table's own header row");

  const rows = [...bulkRows(nonCallableGrid, false), ...bulkRows(callableGrid, true)];
  const card = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: [
      "No senior-citizen column on either bulk table -- one 'general' rate applies to every customer per tenure/amount tier.",
      "A separate 'RBI Repo link' and 'MIBOR link' Bulk Term Deposit table also exists on this page for amounts above the top BTD tier; both are floating-rate (a spread over Repo/MIBOR with no fixed percentage printed) and are not included here.",
      "Non-Callable BTD has no published tenor below 91 days; Callable BTD starts from 7 days.",
    ],
  });
  return { cards: [card] };
};
