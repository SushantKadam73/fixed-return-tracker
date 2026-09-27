/**
 * IndusInd Bank — indusind.bank.in
 *
 * Pages covered:
 *  - fixed-deposit-interest-rate.html — one page holds FIVE rate tables: retail callable
 *    (<3 crore), callable 3 crore–<5 crore, non-callable >1 crore–<3 crore, non-callable
 *    3 crore–<5 crore, and a "Tax Saver (5 years)" row inside the retail table.
 *  - savings-account-interest-rate.html — balance slabs, explicitly incremental below
 *    ₹5 crore, then flat ("Flat Rate applicable on entire balance") from ₹5 crore up, and
 *    MIBOR-linked (no fixed %) above ₹1400 crore.
 *
 * Quirks worked around here (see comments below) rather than in the shared parsers:
 *  - The "Tax Saver (5 years)" row's tenure is written as free text with the real duration
 *    inside parentheses, e.g. "Tax Saver (5 years)". The shared `parseTenure` strips
 *    parenthetical asides (it expects them to be footnotes like "(Amrit Vrishti)" attached
 *    to an otherwise-numeric label), so for this one row the number is the ONLY thing inside
 *    the parens and stripping it leaves no digits at all. We skip that row in the generic
 *    pass (`skipRow`) and add it back by hand with a 5-year tenure.
 *  - The savings page's slab labels ("Daily balance above Rs. 1 Lakh upto Rs. 25 Lakh") do
 *    not fit the shared `parseAmountBand` helper, which anchors its "above ..." exclusivity
 *    check to the *start* of the string; here "above" is preceded by "Daily balance ", so
 *    that check always misses. We parse these slab labels with a small local regex instead
 *    of patching the shared helper.
 *  - The bank's own MIBOR-linked top slabs (>₹1400 crore) have no fixed percentage — we
 *    never invent one, so those bands are left out of `savingsSlabs` and called out in
 *    `notes` instead.
 *
 * No RD adapter: the dedicated Recurring Deposit page (deposits/recurring-deposit.html) has
 * no rate table at all (zero <table> elements; only a single marketing headline number), and
 * the bank does not state anywhere we found that RD rates equal FD rates, so `deriveRdFromFd`
 * cannot be used either. Skipped rather than guessed.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, LAKH, headerText, makeCard, requireGrid } from "./helpers";

const RATE_COL = /rate/i;
const SENIOR = /senior/i;

/** "Tax Saver (5 years)" -> the tenure is inside the parens; parseTenure can't read it, so we skip the row generically and add it back here. */
const TAX_SAVER_ROW = /tax saver/i;

export const indusindFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  // < 3 crore, callable — the only table whose header literally says "DOMESTIC (RESIDENT)".
  const retail = requireGrid(grids, (g) => /domestic\s*\(resident\)/i.test(headerText(g, 2)), "retail (<3 crore) FD table");
  const effectiveFrom = dateFromContext(retail.context);
  const rows: RateRow[] = parseTermTable(retail, {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    skipRow: TAX_SAVER_ROW,
  });
  const taxSaverRow = retail.rows.find((r) => TAX_SAVER_ROW.test(r[0] ?? ""));
  if (taxSaverRow) {
    const general = parseRate(taxSaverRow[1] ?? "");
    const senior = parseRate(taxSaverRow[2] ?? "");
    if (general === null || senior === null) throw new AdapterError("Tax Saver row found but its rates could not be read");
    const base = { tenureMinDays: 1825, tenureMaxDays: 1825, tenureLabel: cleanText(taxSaverRow[0]), schemeName: "Tax Saver (5-year, Section 80C)", amountMin: 0, amountMax: 3 * CRORE, residency: "resident" as const, callable: true, payout: null };
    rows.push({ ...base, customer: "general", rate: general }, { ...base, customer: "senior", rate: senior });
  }

  // Non-callable, above ₹1 crore to below ₹3 crore — still "retail" (below the bulk threshold).
  const nonCallableRetail = requireGrid(grids, (g) => /above 1 crore/i.test(headerText(g, 2)) && /not allowed/i.test(headerText(g, 2)), "non-callable ₹1–3 crore FD table");
  const ncRows = parseTermTable(nonCallableRetail, {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: CRORE + 1,
    amountMax: 3 * CRORE,
    callable: false,
  });
  rows.push(...ncRows);

  if (!effectiveFrom) throw new AdapterError("effective date not found for the retail FD table");
  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes: ["Senior Citizen FD rates do not apply to NRO/NRE deposits (bank's own note)."] })],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50pp on most tenures; +0.75pp specifically on the 2–3 year tenure (bank's own note)",
        prematurePenalty: "1% penal rate, waived for resident senior citizens (<₹5cr) with tenure 1 year or more",
      },
    ],
  };
};

export const indusindBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  const callable = requireGrid(grids, (g) => /premature withdrawal allowed/i.test(headerText(g, 2)) && /3 crore to less than 5 crore/i.test(headerText(g, 2)), "3–5 crore callable FD table");
  const effectiveFrom = dateFromContext(callable.context);
  const rows: RateRow[] = parseTermTable(callable, {
    columns: [
      { header: RATE_COL, customer: "general", exclude: SENIOR },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 3 * CRORE,
    amountMax: 5 * CRORE,
    callable: true,
  });

  const nonCallable = requireGrid(grids, (g) => /premature withdrawal not allowed/i.test(headerText(g, 2)) && /3 crore to less than 5 crore/i.test(headerText(g, 2)), "3–5 crore non-callable FD table");
  rows.push(
    ...parseTermTable(nonCallable, {
      columns: [
        { header: RATE_COL, customer: "general", exclude: SENIOR },
        { header: SENIOR, customer: "senior" },
      ],
      amountMin: 3 * CRORE,
      amountMax: 5 * CRORE,
      callable: false,
    }),
  );

  if (!effectiveFrom) throw new AdapterError("effective date not found for the 3–5 crore FD table");
  return {
    cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes: ["Only the ₹3–5 crore band is published on this page; no rate table was found for ≥₹5 crore (the page instead says >=5 crore rates are quoted per-deposit and only valid the day they are booked)."] })],
  };
};

export const indusindSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /domestic\/non resident/i.test(headerText(x, 1)), "savings slab table");
  const effectiveFrom = parseDate(g.rows[0]?.[1] ?? "");
  const slabs: SavingsSlab[] = [];
  for (const row of g.rows.slice(1)) {
    const rate = parseRate(row[1] ?? "");
    if (rate === null) continue;
    const band = parseSlabLabel(row[0] ?? "");
    if (!band) throw new AdapterError(`unrecognised savings slab "${row[0]}"`);
    const flatBand = /^\*/.test(row[0] ?? "");
    slabs.push({ ...band, rate, residency: "resident", note: flatBand ? "Flat rate on the entire balance (bank's own footnote), not incremental like the slabs below ₹5 crore." : undefined });
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");
  if (!effectiveFrom) throw new AdapterError("effective date not found for the savings table");
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        // The base structure (below ₹5cr) is incremental; the bank calls out the ≥₹5cr bands as a
        // flat exception via SavingsSlab.note above, since the domain model has one method per card.
        slabMethod: "incremental",
        notes: [
          "Slabs from ₹5 crore upward are a flat rate on the whole balance, not incremental (see each slab's note).",
          "Bands above ₹1400 crore are MIBOR-linked (e.g. 'OVERNIGHT MIBOR + 101 bps') with no fixed percentage printed, so they are not included here.",
        ],
      }),
    ],
  };
};

/** The effective-date sentence sits in the paragraph right before the table, not in its header. */
function dateFromContext(context: string): string | null {
  const m = /w\.?\s?e\.?\s?f\.?\s*([0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{2,4}|[0-9]{1,2}\s+[a-z]+\s+[0-9]{4})/i.exec(context);
  return m ? parseDate(m[1]) : null;
}

/** "Daily balance upto Rs. X" / "Daily balance above Rs. X upto Rs. Y" / "*Daily balance above Rs. X" —
 * not handled by the shared parseAmountBand (see file header), so parsed locally instead. */
function parseSlabLabel(label: string): { balanceMin: number; balanceMax: number | null } | null {
  const clean = label.replace(/^\*+/, "").toLowerCase();
  const nums = [...clean.matchAll(/([\d.]+)\s*(lakh|cr|crore)/g)].map((m) => Number(m[1]) * (m[2][0] === "l" ? LAKH : CRORE));
  const hasAbove = /\babove\b/.test(clean);
  const hasUpto = /\bupto\b/.test(clean);
  if (!hasAbove && hasUpto && nums.length === 1) return { balanceMin: 0, balanceMax: nums[0] + 1 };
  if (hasAbove && hasUpto && nums.length === 2) return { balanceMin: nums[0] + 1, balanceMax: nums[1] + 1 };
  if (hasAbove && !hasUpto && nums.length === 1) return { balanceMin: nums[0] + 1, balanceMax: null };
  return null;
}
