/**
 * ICICI Bank — icici.bank.in
 *
 * ICICI's FD and RD rate pages render their tables from a small JSON API embedded as a
 * `data-api="/content/dam/.../json/....json"` attribute on the calculator widget, rather than
 * baking the numbers into the page's raw HTML table markup (an open-source community FD-rate
 * tracker reads ICICI exactly this way — see the task brief). We discover that JSON path from
 * the page each run (never hardcode it) and fetch it with `ctx.fetch`, so a future redesign
 * that moves the file is a loud failure (`AdapterError`) rather than a silent wrong answer.
 *
 * Pages covered:
 *  - personal-banking/deposits/fixed-deposit/fd-interest-rates — retail FD, general + senior.
 *    `interestData[0]` in the JSON is the table this page's own FAQ text describes as "less
 *    than ₹3 crore deposits" (confirmed by matching numbers: the FAQ's worked example for
 *    5yr1day-10yr, "6.50% general / 7.00% senior", is exactly `interestData[0]`'s row for that
 *    tenure). `interestData[1..8]` also exist but are undocumented on the page (no amount/tab
 *    label found for them, and their numbers look like a run of past rate revisions rather
 *    than distinct products) — not used, to avoid guessing what they mean.
 *  - personal-banking/deposits/recurring-deposits/rd-interest-rates — RD, general + senior,
 *    from its OWN dedicated JSON (not derived from FD: ICICI's RD ladder has more, narrower
 *    tenure bands than its FD ladder).
 *  - personal-banking/accounts/savings-account/interest-rates — flat 2.50% "Across all
 *    account balances" (no slabs), read directly from the HTML table.
 *
 * No bulk-deposit adapter: no dedicated ≥₹2–3 crore domestic FD rate page or JSON endpoint was
 * found on icici.bank.in (a guessed /fixed-deposit/bulk-deposits URL 404s; press coverage
 * describes ICICI revising a "bulk FD" band by press release, but never names an official page
 * URL). Recorded as a gap rather than guessed — see notes in data/sources/fragments/b2.json.
 */
import * as cheerio from "cheerio";
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, pageText } from "../parse/html-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter, AdapterContext, FetchedDoc } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** Find the calculator widget's `data-api` JSON endpoint on the page and fetch it. Handles
 * both single- and double-quoted attributes (ICICI uses both across its own pages). */
async function fetchJsonApi(ctx: AdapterContext, match: RegExp): Promise<unknown> {
  const $ = cheerio.load(ctx.doc.text);
  let path: string | undefined;
  $("[data-api]").each((_, el) => {
    const v = $(el).attr("data-api");
    if (!path && v && match.test(v)) path = v;
  });
  if (!path) throw new AdapterError(`no data-api JSON endpoint matching ${match} found on ${ctx.doc.finalUrl}`);
  const url = new URL(path, ctx.doc.finalUrl).toString();
  const doc: FetchedDoc = await ctx.fetch(url, "json");
  try {
    return JSON.parse(doc.text);
  } catch {
    throw new AdapterError(`${url} did not return valid JSON`);
  }
}

/** "185 to < 1 Year" — a bare leading number with no unit word, joined to an upper bound in a
 * DIFFERENT unit (years). The shared `parseTenure` infers a bare number's unit from the upper
 * bound when none is given, so it would read "185" as 185 *years*; clamped away as invalid, but
 * we can just say what ICICI means (185 days, matching every neighbouring row's convention)
 * instead of losing the row. Harmless to apply to already-unambiguous labels too. */
function normaliseTenure(label: string): string {
  const m = /^(\d+)\s+to\s+(.*)$/i.exec(label.trim());
  return m ? `${m[1]} days to ${m[2]}` : label;
}

interface IciciFdRow {
  tenure: string;
  c1: number;
  c2: number;
}

export const iciciFd: Adapter = async (ctx) => {
  const effectiveFrom = findEffectiveDate(pageText(ctx.doc.text));
  if (!effectiveFrom) throw new AdapterError("effective date not found on the FD interest-rates page");
  const json = (await fetchJsonApi(ctx, /fixed-deposits\/json\/fd-interest-rate\.json/i)) as { interestData?: IciciFdRow[][] };
  const retail = json.interestData?.[0];
  if (!Array.isArray(retail) || retail.length === 0) throw new AdapterError("fd-interest-rate.json: interestData[0] (retail table) missing or empty — layout may have changed");

  const rows: RateRow[] = [];
  for (const r of retail) {
    const tenure = parseTenure(normaliseTenure(r.tenure));
    if (!tenure) throw new AdapterError(`cannot read ICICI FD tenure "${r.tenure}"`);
    const schemeName = /tax saver/i.test(r.tenure) ? "Tax Saver FD (5-year, Section 80C)" : undefined;
    const base = { tenureMinDays: tenure.minDays, tenureMaxDays: tenure.maxDays, tenureLabel: r.tenure, schemeName, amountMin: 0, amountMax: 3 * CRORE, residency: "resident" as const, callable: true, payout: null };
    rows.push({ ...base, customer: "general", rate: r.c1 }, { ...base, customer: "senior", rate: r.c2 });
  }

  return {
    cards: [
      makeCard(ctx, "fd", rows, {
        effectiveFrom,
        notes: [
          "Amount band (< ₹3 crore) is stated in the page's own FAQ text ('...for senior citizens (less than ₹3 crore deposits)'), not in the rate table itself — confirmed by matching that FAQ's example rate to this table's row.",
          "Senior citizen rates on this table apply to domestic deposits only (bank's own note: 'Senior citizens Fixed Deposit (FD) interest rates only apply for domestic Fixed Deposits').",
        ],
      }),
    ],
    terms: [{ product: "fd", seniorPremium: "Tenure-dependent; largest (+0.60pp) for 3yr1day–5yr", seniorPremiumCap: "Domestic deposits only — does not apply to NRE/NRO/FCNR" }],
  };
};

interface IciciRdRow {
  tenure: string; // e.g. "7d-15d"
  amount: Record<string, { general: number; senior: number }>;
}

export const iciciRd: Adapter = async (ctx) => {
  const effectiveFrom = findEffectiveDate(pageText(ctx.doc.text));
  if (!effectiveFrom) throw new AdapterError("effective date not found on the RD interest-rates page");
  const json = (await fetchJsonApi(ctx, /recurring-deposits\/json\/rd-interest-rate\.json/i)) as { data_fd?: IciciRdRow[] };
  const data = json.data_fd;
  if (!Array.isArray(data) || data.length === 0) throw new AdapterError("rd-interest-rate.json: data_fd missing or empty — layout may have changed");

  const rows: RateRow[] = [];
  for (const r of data) {
    const tm = /^(\d+)d-(\d+)d$/.exec(r.tenure);
    if (!tm) throw new AdapterError(`cannot read ICICI RD tenure code "${r.tenure}"`);
    const [tenureMinDays, tenureMaxDays] = [Number(tm[1]), Number(tm[2])];
    for (const [amountKey, rate] of Object.entries(r.amount)) {
      const am = /^(\d+)-(\d+)$/.exec(amountKey);
      if (!am) throw new AdapterError(`cannot read ICICI RD amount band "${amountKey}"`);
      const base = { tenureMinDays, tenureMaxDays, tenureLabel: `${tenureMinDays} to ${tenureMaxDays} days`, amountMin: Number(am[1]), amountMax: Number(am[2]) + 1, residency: "resident" as const, callable: true, payout: null };
      rows.push({ ...base, customer: "general", rate: rate.general }, { ...base, customer: "senior", rate: rate.senior });
    }
  }

  return { cards: [makeCard(ctx, "rd", rows, { effectiveFrom, notes: ["Read from ICICI's own RD JSON endpoint (not derived from the FD card) — RD has narrower tenure bands than FD."] })] };
};

export const iciciSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /on balances/i.test(x.rows[0]?.[0] ?? ""), "savings table");
  const effectiveFrom = findEffectiveDate(pageText(ctx.doc.text));
  const slabs: SavingsSlab[] = [];
  for (const row of g.rows.slice(1)) {
    const rate = parseRate(row[1] ?? "");
    if (rate === null) continue;
    if (!/across all/i.test(row[0] ?? "")) throw new AdapterError(`unexpected savings slab "${row[0]}" — ICICI layout changed`);
    slabs.push({ balanceMin: 0, balanceMax: null, rate, residency: "resident" });
  }
  if (slabs.length === 0) throw new AdapterError("no savings rate found");
  if (!effectiveFrom) throw new AdapterError("effective date not found on the savings interest-rates page");
  return { cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "whole" })] };
};
