/**
 * AU Small Finance Bank — www.au.bank.in
 * Pages: retail FD (< ₹3 crore: callable general/senior + non-callable ₹1,00,01,000–<₹3cr +
 * discounted monthly-payout variant), Recurring Deposit, Savings Account.
 *
 * Quirks:
 *  - AU writes dates as "23rd Apr'2026" / "01st Oct'26" (an apostrophe glued to the year, and
 *    sometimes only 2 digits). The shared `parseDate` doesn't expect the apostrophe, so
 *    `normaliseAuDate()` below turns it into "23 Apr 2026" first. Local-only fix — no shared
 *    file touched.
 *  - The callable general-public table and the non-callable/senior tables carry *different*
 *    effective dates on the same page (general moved to 1 Sep 2026; non-callable and senior
 *    are still dated 10 Jun 2026) — each row group below reads its own table's date, never a
 *    single "page date".
 *  - The savings page pre-announces a slab change effective 1 Oct 2026 (today, per this run,
 *    is before that date). We publish the "till 30 Sep'26" column as the current card, and
 *    additionally emit the "w.e.f. 01 Oct'26" column as a second, future-dated card so the
 *    change isn't lost — the runner/maintainer decides when a future-dated card goes live.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, pageText } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

/** AU dates: "23rd Apr'2026" / "01st Oct'26" — insert the missing space and expand a 2-digit year. */
function normaliseAuDate(text: string): string {
  return text.replace(/([A-Za-z]{3,9})'(\d{2,4})/, (_, mon, yr) => `${mon} ${yr.length === 2 ? `20${yr}` : yr}`);
}
function auDate(text: string): string | null {
  return parseDate(normaliseAuDate(text));
}

const RATE_HEADER = /interest rate/i;

export const auSfbFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  const general = requireGrid(grids, (g) => /domestic.*retail/i.test(g.context) && !/non-callable/i.test(g.context) && !/senior/i.test(g.context) && !/monthly payout/i.test(g.context), "retail callable FD table (general)");
  const generalDate = auDate(general.context);
  if (!generalDate) throw new AdapterError("no effective date found for the general retail FD table");
  const rows: RateRow[] = parseTermTable(general, { columns: [{ header: RATE_HEADER, customer: "general" }], amountMin: 0, amountMax: 3 * CRORE, callable: true });

  const senior = requireGrid(grids, (g) => /senior citizen/i.test(g.context) && !/monthly payout/i.test(g.context), "retail callable FD table (senior)");
  const seniorDate = auDate(senior.context);
  if (!seniorDate) throw new AdapterError("no effective date found for the senior retail FD table");
  const seniorRows = parseTermTable(senior, { columns: [{ header: RATE_HEADER, customer: "senior" }], amountMin: 0, amountMax: 3 * CRORE, callable: true });
  if (seniorDate !== generalDate) seniorRows.forEach((r) => (r.note = `Senior table effective ${seniorDate} (general table is ${generalDate})`));
  rows.push(...seniorRows);

  const nonCallable = requireGrid(grids, (g) => /non-callable/i.test(g.context), "non-callable retail FD table (₹1cr 1k–<₹3cr)");
  const ncDate = auDate(nonCallable.context);
  if (!ncDate) throw new AdapterError("no effective date found for the non-callable FD table");
  const ncRows = parseTermTable(nonCallable, { columns: [{ header: RATE_HEADER, customer: "general" }], amountMin: CRORE + 1000, amountMax: 3 * CRORE, callable: false });
  ncRows.forEach((r) => (r.note = `Non-callable, ₹1,00,01,000–<₹3 crore; effective ${ncDate}. AU prints only one rate column here — no separate senior-citizen rate for non-callable deposits.`));
  rows.push(...ncRows);

  const notes: string[] = [];
  const monthlyPayout = grids.find((g) => /monthly payout/i.test(g.context));
  if (monthlyPayout) {
    const mpDate = auDate(monthlyPayout.context);
    const mpRows = parseTermTable(monthlyPayout, {
      columns: [
        { header: /resident.*nro/i, customer: "general" },
        { header: /senior citizen/i, customer: "senior" },
      ],
      amountMin: 0,
      amountMax: 3 * CRORE,
      callable: true,
      payout: "monthly",
    });
    mpRows.forEach((r) => (r.note = `Discounted monthly-payout rate${mpDate ? `, effective ${mpDate}` : ""}`));
    rows.push(...mpRows);
  } else {
    notes.push("Monthly-payout FD table not found on this fetch.");
  }

  const text = pageText(ctx.doc.text);
  if (/for interbank deposit rates contact/i.test(text)) notes.push("AU publishes no public bulk (≥₹3 crore) rate card; the page says to contact a branch for interbank deposit rates.");

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom: generalDate, notes });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. on all tenures (resident Indian senior citizens with an existing AU relationship; not on non-callable deposits or ≥₹3 crore)",
        prematurePenalty: "1% on premature closure/withdrawal (incl. sweep-in and partial closures); no interest if withdrawn within 7 days of booking",
        interestCredit: "Compounding and payout frequency is on the deposit's anniversary basis",
      },
    ],
  };
};

export const auSfbRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /recurring deposit/i.test(headerText(x, 1)), "recurring deposit table");
  const effectiveFrom = auDate(g.context) ?? auDate(headerText(g, 1));
  if (!effectiveFrom) throw new AdapterError("no effective date found for the RD table");
  const rows = parseTermTable(g, {
    tenureHeader: /recurring deposit/i,
    columns: [
      { header: /^roi/i, customer: "general", exclude: /senior/i },
      { header: /senior/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: null,
    callable: true,
  });
  return { cards: [makeCard(ctx, "rd", rows, { effectiveFrom })] };
};

export const auSfbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings account incremental amount slab/i.test(headerText(x, 1)), "savings slab table");
  const effectiveFrom = auDate(g.context);
  if (!effectiveFrom) throw new AdapterError("no effective date found for the savings table");

  const header = g.rows[0] ?? [];
  const currentCol = header.findIndex((h) => /till/i.test(h));
  const futureColMatch = header.find((h) => /w\.?e\.?f\.?/i.test(h));
  const futureCol = header.findIndex((h) => /w\.?e\.?f\.?/i.test(h));
  if (currentCol < 0 || futureCol < 0) throw new AdapterError(`expected a "till <date>" and a "w.e.f. <date>" column, got: ${header.join(" | ")}`);
  const futureDate = futureColMatch ? auDate(futureColMatch) : null;
  if (!futureDate) throw new AdapterError("could not read the pre-announced slab's effective date");

  const toSlabs = (col: number): SavingsSlab[] =>
    g.rows.slice(1).flatMap((r) => {
      const rate = parseRate(r[col] ?? "");
      const band = parseAmountBand(cleanText(r[0] ?? "").replace(/[*^]/g, ""));
      if (rate === null || !band) return [];
      return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
    });

  const currentSlabs = toSlabs(currentCol);
  if (currentSlabs.length === 0) throw new AdapterError("no savings slabs read from the current column");
  const current = makeCard(ctx, "savings", [], {
    effectiveFrom,
    savingsSlabs: currentSlabs,
    slabMethod: "incremental",
    notes: [`A slab change is pre-announced for ${futureDate} (see the second card from this same fetch); until then these are the rates in force.`],
  });

  const futureSlabs = toSlabs(futureCol);
  const future = makeCard(ctx, "savings", [], {
    effectiveFrom: futureDate,
    savingsSlabs: futureSlabs,
    slabMethod: "unknown",
    notes: [
      `Pre-announced by AU on the same page; NOT YET IN FORCE as of this fetch (observed ${ctx.today}). Do not treat as current before ${futureDate}.`,
      "Below ₹100 crore the method is incremental (bank's general note). From ₹100cr to <₹750cr the bank says the revised 7.00% is a flat rate on the whole balance from ₹1 lakh upward; from ₹750cr and above the revised rate is flat on the ₹1 lakh–<₹750cr portion and slab-incremental beyond that — so slabMethod is 'unknown' for this future card rather than force-fit into whole/incremental.",
    ],
  });

  return { cards: [current, future] };
};
