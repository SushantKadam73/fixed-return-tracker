/**
 * Bandhan Bank — bandhan.bank.in
 * Everything lives on one page, "Rates and Charges" (rates-charges): retail domestic/NRE term
 * deposits, domestic/NRO bulk deposits (Callable and Non-Callable, ₹3 crore and above) and the
 * savings account balance ladder. The dedicated FD/RD marketing pages carry no numbers of their
 * own and link back here.
 *
 * No RD adapter: this page has no Recurring Deposit table (searched for "recurring"/"RD" —
 * nothing), and nowhere does the bank say RD rates equal FD rates, so per the "never derive
 * without an explicit statement" rule there is nothing to build from.
 *
 * Quirks handled here (not in the shared parsers, so they live in this file):
 *  - The bulk tables write short tenures as "16 days < 1 month" (a bare "<", no "to"/"less
 *    than"), which the shared parseTenure misreads (see normaliseTenureLabel — same fix as the
 *    Axis adapter, independently verified here against a contiguous 7-3650 day ladder).
 *  - The savings ladder is a 12-column HTML table (six repeated mini-tables, one per top-tier
 *    EOD-balance band) that is far harder to read reliably than the page's own plain-English
 *    footnote listing every slab in order ("Interest of 2.70% p.a. will be applied for amount up
 *    to ₹1 lakh, 2.70% ... over and above ₹1 lakh up to ₹5 lakh, ..."), so this adapter parses
 *    that sentence instead of the grid. The bank confirms the base ladder is incremental; above
 *    ₹250 crore EOD balance a single flat rate applies to the *entire* balance over ₹1 lakh
 *    (not incremental with the lower bands) — see the note attached to the savings card.
 */
import type { CustomerType, RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn, parseAmountBand } from "../parse/amount";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, pageText, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

/** Bandhan writes "16 days < 1 month"; parseTenure only understands "<" after a keyword like
 * "less than", so give it one. Checked against every bulk-table row (see the fixture) and the
 * result is a contiguous 7-3650 day ladder with no gaps or overlaps. */
function normaliseTenureLabel(label: string): string {
  return label.replace(/\s*<\s*/g, " to less than ");
}

export const bandhanFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /maturity bucket/i.test(headerText(g, 1)), "retail term-deposit table");
  const effectiveFrom = findEffectiveDate(grid.context);
  const rows = parseTermTable(grid, {
    columns: [
      { header: /non-senior/i, customer: "general" },
      { header: /senior/i, customer: "senior", exclude: /non-senior/i },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });
  return { cards: [makeCard(ctx, "fd", rows, { effectiveFrom })] };
};

/** Both bulk sub-tables ("Callable" and "Non-Callable") share the same 9 amount-band columns;
 * only the callable flag and the rates differ. */
function parseBulkAmountTable(grid: Grid, callable: boolean): RateRow[] {
  const headerIdx = grid.rows.findIndex((r) => /^tenure$/i.test(cleanText(r[0] ?? "")));
  if (headerIdx < 0) throw new AdapterError('Bandhan bulk table: no header row starting with "Tenure"');
  const header = grid.rows[headerIdx];
  const bands = header.slice(1).map((h) => ({ label: cleanText(h), band: parseAmountBand(h) }));
  const bad = bands.find((b) => !b.band);
  if (bad) throw new AdapterError(`Bandhan bulk table: cannot read amount-band header "${bad.label}"`);
  const rows: RateRow[] = [];
  for (const r of grid.rows.slice(headerIdx + 1)) {
    const label = cleanText(r[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(normaliseTenureLabel(label));
    if (!tenure) throw new AdapterError(`Bandhan bulk table: cannot read tenure "${label}"`);
    bands.forEach((b, i) => {
      const rate = parseRate(r[i + 1] ?? "");
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: b.band!.min,
        amountMax: b.band!.max,
        customer: "general" as CustomerType,
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("Bandhan bulk table produced no rows");
  return rows;
}

export const bandhanBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const domestic = grids.filter((g) => /domestic\/nro bulk deposit/i.test(g.context));
  const callableGrid = domestic.find((g) => /callable/i.test(g.rows[0]?.[0] ?? "") && !/non-callable/i.test(g.rows[0]?.[0] ?? ""));
  const nonCallableGrid = domestic.find((g) => /non-callable/i.test(g.rows[0]?.[0] ?? ""));
  if (!callableGrid || !nonCallableGrid) throw new AdapterError("Bandhan bulk: Callable/Non-Callable domestic tables not both found");
  const effectiveFrom = findEffectiveDate(callableGrid.context);
  const rows = [...parseBulkAmountTable(callableGrid, true), ...parseBulkAmountTable(nonCallableGrid, false)];
  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: ["No senior-citizen column is published for bulk deposits (₹3 crore and above); the senior premium found on retail tables does not appear to extend to bulk."],
      }),
    ],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "1 percentage point below the card rate for the period actually held, on premature closure of a Callable bulk deposit." }],
  };
};

/**
 * The savings table itself is a 12-column grid (6 repeated mini-ladders for the top EOD-balance
 * tiers), which is much harder to read reliably than the bank's own plain-English footnote that
 * lists every slab boundary in order. Parse that sentence instead.
 */
interface SavingsClause {
  rate: number;
  lo: number;
  hi: number | null;
}

function parseSavingsNote(note: string): SavingsClause[] {
  // Split right before each "N% p.a. will be applied" — the lookbehind stops the split from
  // also firing part-way through a rate's own digits (e.g. inside "2.70%").
  const clauses = note
    .split(/(?<![\d.])(?=\d+(?:\.\d+)?%\s*p\.a\.\s*will be applied)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: SavingsClause[] = [];
  for (const clause of clauses) {
    const rateM = /(\d+(?:\.\d+)?)%/.exec(clause);
    if (!rateM) continue; // leading "Interest of" fragment before the first real clause
    const rate = Number(rateM[1]);
    if (/for amount up to/i.test(clause)) {
      const amts = amountsIn(clause);
      out.push({ rate, lo: 0, hi: amts.at(-1) ?? null });
      continue;
    }
    // Stop at a comma followed by whitespace (a real clause break), not a thousands-separator
    // comma inside a number like "₹1,000".
    const rangeM = /(?:over and above|exceeds)\s+(.+?)\s+up to\s+(.+?)(?=,\s|\.|$)/i.exec(clause);
    if (rangeM) {
      out.push({ rate, lo: amountsIn(rangeM[1])[0], hi: amountsIn(rangeM[2])[0] });
      continue;
    }
    const openM = /exceeds\s+(.+?)(?=,\s|\.|$)/i.exec(clause);
    if (openM) {
      out.push({ rate, lo: amountsIn(openM[1])[0], hi: null });
      continue;
    }
    throw new AdapterError(`Bandhan savings note: cannot read clause "${clause}"`);
  }
  if (out.length === 0) throw new AdapterError("Bandhan savings note: no slab clauses found");
  return out;
}

export const bandhanSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /savings bank account interest rate/i.test(g.context), "savings rate table");
  const effectiveFrom = findEffectiveDate(grid.context);

  const text = pageText(ctx.doc.text);
  const noteMatch = /Interest of[\s\S]*?(?=Interest rates are subject to periodic change)/i.exec(text);
  if (!noteMatch) throw new AdapterError("Bandhan savings: the per-slab explanatory note was not found on the page");
  const clauses = parseSavingsNote(noteMatch[0]);

  // The note states "up to Y" (Y inclusive) and "over and above X" / "exceeds X" (X exclusive);
  // convert to this codebase's half-open [min, max) convention.
  const slabs: SavingsSlab[] = clauses.map((c, i) => ({
    balanceMin: i === 0 ? c.lo : c.lo + 1,
    balanceMax: c.hi === null ? null : c.hi + 1,
    rate: c.rate,
    residency: "resident",
  }));

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: "incremental",
        notes: [
          'Incremental up to ₹250 crore EOD balance (bank\'s own wording: "incremental balance over and above ..."). At/above ₹250 crore EOD balance a single flat rate applies to the entire balance above ₹1 lakh (bank\'s wording: "the remaining balance over ₹1 lakh"), which is a whole-balance mechanism, not incremental with the lower slabs — the card-level slabMethod below reflects the dominant (lower) part of the ladder.',
        ],
      }),
    ],
  };
};
