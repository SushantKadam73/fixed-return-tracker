/**
 * Jana Small Finance Bank — www.jana.bank.in
 * Single page covered: the "Interest Rates" hub (Savings, Sweep Deposits, Retail FD,
 * FD Plus, Recurring Deposit and Bulk Deposits are all accordion sections of ONE page).
 * The page renders the same content twice (an "Individual" tab and an identical
 * "Enterprise" tab), so every table appears twice in the HTML — we always take the first
 * match, which is fine since both copies are byte-identical.
 *
 * Quirks:
 *  - "Fixed Deposit Plus" and "Bulk Deposits" are two different headings on the page that
 *    print the exact same tenure x crore-band grid (Jana's non-callable ≥₹3cr product goes
 *    by both names). We read it once, from the "Fixed Deposit Plus" section, as `fd_bulk`.
 *  - The "3 Crores" column header means exactly ₹3,00,00,000 (the single boundary point);
 *    ">3 Crores - 5 Crores" means strictly above ₹3cr up to and including ₹5cr, and so on.
 *    That is the only reading consistent with the six columns tiling without gap/overlap.
 *  - Senior-citizen premium on Retail FD is NOT a flat add-on: the page's own T&Cs say
 *    "Senior Citizens shall not get an extra ... interest for Retail TDs for tenures between
 *    7 days to 180 days" and "shall get an extra upto 0.50% ... for tenures 181 Days and
 *    above" — the printed table rows already reflect this (e.g. 8.00%/8.30% is +0.30, not
 *    +0.50), so `terms.seniorPremium` quotes the page's own wording rather than a single
 *    number.
 *  - Tax Saver FD is mentioned only in footnotes (max amount, lock-in, no senior premium) —
 *    no numeric rate is printed for it anywhere on this page, so it is not covered here.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const contextHas = (g: Grid, re: RegExp) => re.test(g.context);

export const janaFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => contextHas(g, /Domestic\s*\/\s*NRO\s*\/\s*NRE Customers/i), "retail FD table");
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the retail FD table");
  const rows = parseTermTable(grid, {
    columns: [
      { header: /regular/i, customer: "general" },
      { header: /sr\.?\s*citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  const notes = [
    "Senior-citizen premium is not a flat add-on: the page states no extra interest for 7-180 day tenures, and 'upto 0.50%' extra for 181 days and above — the exact amount varies by tenure as printed here.",
    "Retail FD rates also apply to Liquid Plus Fixed Deposits (₹10 lakh to <₹3 crore) and to Sweep Deposits, per the bank's own footnote.",
  ];
  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes })],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "No premium for 7-180 days; up to +0.50% for 181 days and above (see table)", prematurePenalty: "1%", other: ["No interest if withdrawn within 7 days of deposit."] }],
  };
};

/** "3 Crores" / ">3 Crores - 5 Crores" / ">50 Crores" -> a half-open rupee band. amountsIn() already applies the crore multiplier. */
function croreBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  if (nums.length === 0) throw new AdapterError(`cannot read amount band "${label}"`);
  if (/^>/.test(t) || /more than/i.test(t)) {
    return nums.length >= 2 ? { min: nums[0] + 1, max: nums[1] + 1 } : { min: nums[0] + 1, max: null };
  }
  return { min: nums[0], max: nums[0] + 1 };
}

export const janaBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => contextHas(g, /Fixed Deposit Plus/i), "FD Plus / Bulk tenure x amount-band grid");
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the FD Plus table");

  // Header rows: [0] a repeated title (colspan 7), [1] "Tenure" + a repeated sub-title
  // (colspan 6), [2] "Tenure" (carried down) + the 6 crore-band labels.
  const bandHeaderRow = grid.rows[2];
  if (!bandHeaderRow) throw new AdapterError("FD Plus table has fewer header rows than expected");
  const bands = bandHeaderRow.slice(1).map((h) => croreBand(h));

  const rows: RateRow[] = [];
  for (const row of grid.rows.slice(3)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read tenure "${label}"`);
    bands.forEach((band, i) => {
      const rate = parseRate(row[i + 1] ?? "");
      if (rate === null) return; // "Contact Branch" for the top band
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: band.min,
        amountMax: band.max,
        customer: "general",
        residency: "resident",
        callable: false,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("no rows parsed from the FD Plus / Bulk grid");
  return {
    cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes: ["Same grid is published twice on this page under 'Fixed Deposit Plus' and 'Bulk Deposits' — no senior-citizen premium is offered on this non-callable product."] })],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "Not permitted except on death of the account holder or statutory/regulatory direction." }],
  };
};

export const janaRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => contextHas(g, /Recurring Fixed Deposit Rates/i), "RD table");
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the RD table");
  const rows = parseTermTable(grid, {
    columns: [
      { header: /regular rd/i, customer: "general" },
      { header: /senior citizen rd/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: null,
    callable: true,
  });
  return {
    cards: [makeCard(ctx, "rd", rows, { effectiveFrom, notes: ["RD is Jana's own recurring-deposit card (different tenure buckets from the FD card), not derived from it."] })],
    terms: [{ product: "rd", prematurePenalty: "1% of the applicable rate, plus a 1.5% late-instalment penalty (5-day grace period)" }],
  };
};

/** "Up to Rs. 1 Lakh" / "More than Rs. 1 Lakh and Up to Rs. 5 Lakhs" / "More than Rs. 20 Crores". */
function savingsBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  if (/^up to/i.test(t) && nums.length === 1) return { min: 0, max: nums[0] + 1 };
  if (/^more than/i.test(t) && nums.length === 2) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (/^more than/i.test(t) && nums.length === 1) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`cannot read savings slab "${label}"`);
}

export const janaSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => contextHas(g, /Interest Rate on all Savings Accounts/i), "savings slab table");
  const effectiveFrom = parseDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found next to the savings table");
  const slabs: SavingsSlab[] = [];
  for (const row of grid.rows.slice(1)) {
    const label = cleanText(row[1] ?? "");
    if (!label) continue;
    const rate = parseRate(row[2] ?? "");
    if (rate === null) continue; // ">20cr: Contact Branch"
    const band = savingsBand(label);
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident", note: label });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  return {
    cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "incremental", notes: ["Above ₹20 crore: 'Contact Branch' — no published rate."] })],
  };
};
