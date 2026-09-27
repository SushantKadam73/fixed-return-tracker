/**
 * State Bank of India — sbi.bank.in
 * Pages: retail term deposits (below ₹3 crore, incl. non-callable ₹1–3 crore and special tenures),
 * bulk term deposits (₹3 crore and above), savings bank deposits.
 */
import type { RateRow } from "../../../lib/domain";
import { cleanText, parseDate, parseRate } from "../parse/common";
import { extractTables, pageText } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerEffectiveDate, headerText, makeCard, requireGrid } from "./helpers";

const REVISED_PUBLIC = /revised.*public/i;
const REVISED_SENIOR = /revised.*senior/i;

export const sbiRetail: Adapter = async (ctx) => {
  const html = ctx.doc.text;
  const grids = extractTables(html);
  const text = pageText(html);

  const card = requireGrid(grids, (g) => /tenor/i.test(headerText(g, 1)) && REVISED_PUBLIC.test(headerText(g, 1)), "retail card with revised columns");
  const effectiveFrom = headerEffectiveDate(card, REVISED_PUBLIC);
  const rows: RateRow[] = parseTermTable(card, {
    columns: [
      { header: REVISED_PUBLIC, customer: "general" },
      { header: REVISED_SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  // Non-callable retail deposits (₹1 crore+ to below ₹3 crore): explicit general/senior columns.
  const nonCallable = grids.find((g) => /non-callable/i.test(g.rows[0]?.[0] ?? ""));
  if (nonCallable) {
    const body = nonCallable.rows.slice(1);
    const header = body[0] ?? [];
    const gi = header.findIndex((h) => /general/i.test(h));
    const si = header.findIndex((h) => /senior/i.test(h));
    for (const r of body.slice(1)) {
      const m = /^(\d+)\s*years?$/i.exec(cleanText(r[0] ?? ""));
      if (!m) continue;
      const days = Number(m[1]) * 365;
      for (const [idx, customer] of [[gi, "general"], [si, "senior"]] as const) {
        const rate = idx >= 0 ? parseRate(r[idx] ?? "") : null;
        if (rate === null) continue;
        rows.push({ tenureMinDays: days, tenureMaxDays: days, tenureLabel: cleanText(r[0]), amountMin: 1_00_01_000, amountMax: 3 * CRORE, customer, residency: "resident", callable: false, payout: null, rate, note: "Non-callable (no premature withdrawal)" });
      }
    }
  }

  // Named special tenure stated in text, e.g. "Amrit Vrishti"(444 days) ... revised from 6.60% to 6.45% wef 15-Dec-2025
  const special = /["“”]?amrit vrishti["“”]?\s*\((\d+)\s*days\)[^.]*?from\s*([\d.]+)%\s*to\s*([\d.]+)%\s*w\.?e\.?f\.?\s*([0-9a-z\-./ ]+)/i.exec(text);
  const notes: string[] = [];
  if (special) {
    const days = Number(special[1]);
    rows.push({ tenureMinDays: days, tenureMaxDays: days, tenureLabel: `${days} days`, special: true, schemeName: "Amrit Vrishti", amountMin: 0, amountMax: 3 * CRORE, customer: "general", residency: "resident", callable: true, payout: null, rate: Number(special[3]), note: `Revised w.e.f. ${parseDate(special[4]) ?? special[4]}; senior citizens get their usual additional rate (not published as a number)` });
    notes.push("Amrit Vrishti senior-citizen rate is not published as a number, so only the general rate is shown.");
  }
  if (/we-?care/i.test(text)) notes.push("Senior rate for 5–10 years includes the 0.50% SBI We-care premium.");
  if (/super senior citizens?\s*\(80 years and above\)/i.test(text)) notes.push("Super senior citizens (80+) get 0.10% over the senior rate (SBI Patrons), except on RD, Green deposits, tax savings, MODS, Capgain and non-callable deposits.");
  if (!effectiveFrom) throw new AdapterError("effective date not found in revised column header");

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });
  const rd = deriveRdFromFd(fd, "SBI: interest rates on Recurring Deposits are the same as Term Deposit card rates", 365);
  return {
    cards: [fd, rd],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% (We-care: +1.00% for 5–10 years incl. 0.50% premium)", superSeniorPremium: "+0.10% over senior (80+)" }],
  };
};

export const sbiBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const card = requireGrid(grids, (g) => /tenor/i.test(headerText(g, 1)) && REVISED_PUBLIC.test(headerText(g, 1)), "bulk card");
  const effectiveFrom = headerEffectiveDate(card, REVISED_PUBLIC);
  const rows = parseTermTable(card, {
    columns: [
      { header: REVISED_PUBLIC, customer: "general" },
      { header: REVISED_SENIOR, customer: "senior" },
    ],
    amountMin: 3 * CRORE,
    amountMax: null,
    callable: true,
  });
  return { cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom })] };
};

export const sbiSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings bank/i.test(headerText(x, 1)), "savings table");
  const effectiveFrom = parseDate(g.rows[0]?.[1] ?? "") ?? null;
  const slabs = g.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    if (/across all/i.test(r[0] ?? "")) return [{ balanceMin: 0, balanceMax: null, rate, residency: "resident" as const }];
    throw new AdapterError(`unexpected savings slab "${r[0]}" — SBI layout changed`);
  });
  if (slabs.length === 0) throw new AdapterError("no savings rate found");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "whole" })] };
};
