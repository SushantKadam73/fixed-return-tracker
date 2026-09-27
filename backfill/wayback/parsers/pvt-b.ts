/**
 * Custom historical parsers for IDFC FIRST, J&K Bank, Karnataka Bank, Karur Vysya, Kotak Mahindra, Nainital, RBL, South Indian Bank, Tamilnad Mercantile, YES Bank and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/pvt-b.json.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { parseAmountBand } from "../../../collectors/src/parse/amount";
import { findEffectiveDate, parseRate } from "../../../collectors/src/parse/common";
import { extractTables, pageText, type Grid } from "../../../collectors/src/parse/html-table";
import { parseTenure } from "../../../collectors/src/parse/tenure";
import type { GenericResult, HistoricalParser } from "../types";

/**
 * South Indian Bank's "Domestic Term Deposits" page -- interest.html (static, up to ~2007) and
 * then interestRate/interestRateDetails.aspx?irtID=1 (ASP.NET, 2007 onward) -- prints one amount
 * tier per column-group: "Up to Rs 15 Lacs" / "Rs 15 Lacs upto 100 Lacs" / "Rs.100 Lacs and
 * Above" in the static era, later "Single Deposit of less than Rs.X lacs" x General/Senior
 * Citizens sub-columns once senior rates were introduced. The generic reader
 * (backfill/wayback/generic-parse.ts) only classifies a column by customer type, never by
 * amount, so two amount tiers that both read as plain "general" collide under one tenure/customer
 * key whenever their rates differ (validateCard's conflicting_rows check), and the whole
 * snapshot is rejected even though most of the table read fine.
 *
 * This parser reads each column's own header text for BOTH its amount band (via the shared
 * parseAmountBand helper) and its customer type, so tiers are recorded with the amount band the
 * page actually printed and never collide. Any column whose header cannot be resolved to a band
 * (when other columns on the same page do carry one) is skipped and reported, never guessed.
 */

function classifyCustomer(header: string): CustomerType {
  const h = header.toLowerCase();
  if (/super\s*senior|80\s*years?/.test(h)) return "super_senior";
  if (/senior|sr\.?\s*citi/.test(h)) return "senior";
  return "general";
}

// Mechanical substitution so the shared parseAmountBand helper recognises this bank's own
// phrasing -- the number and comparison are never touched, only a word it doesn't know yet
// ("(incl)") is spelled out as one it does ("and including"). Same technique as
// normalizeAmountAnnotation in backfill/sbi-fd-archive.ts.
function normalizeAmountText(raw: string): string {
  return raw.replace(/\(incl\)/gi, "and including");
}

interface ColPlan {
  index: number;
  customer: CustomerType;
  amountMin: number;
  amountMax: number | null;
}

/**
 * Decide what each non-tenure column means. If any column's own header resolves to an amount
 * band, the table is amount-tiered: every column is read from its own header, and a column that
 * still fails to resolve is skipped (never assigned someone else's band). Otherwise there is one
 * implied tier for the whole table (the target's own amountMax, if any), and columns are told
 * apart only by customer type -- more than one column landing on the same customer type with no
 * amount band to separate them is genuinely ambiguous and is skipped, matching the generic
 * reader's own refusal of unlabelled rate columns.
 */
function planColumns(headerOf: (c: number) => string, width: number, fallbackAmountMax: number | null): { cols: ColPlan[]; skipped: string[] } {
  const skipped: string[] = [];
  const candidates = Array.from({ length: Math.max(0, width - 1) }, (_, k) => k + 1)
    .map((i) => ({ i, h: headerOf(i).trim() }))
    .filter((x) => x.h !== "");
  const withBand = candidates.map((x) => ({ ...x, band: parseAmountBand(normalizeAmountText(x.h)) }));

  if (withBand.some((x) => x.band)) {
    const cols: ColPlan[] = [];
    for (const x of withBand) {
      if (!x.band) {
        skipped.push(`column ${x.i}: amount-tiered table but no readable amount band in "${x.h}"`);
        continue;
      }
      cols.push({ index: x.i, customer: classifyCustomer(x.h), amountMin: x.band.min, amountMax: x.band.max });
    }
    return { cols, skipped };
  }

  const byCustomer = new Map<CustomerType, number[]>();
  for (const x of withBand) {
    const cust = classifyCustomer(x.h);
    byCustomer.set(cust, [...(byCustomer.get(cust) ?? []), x.i]);
  }
  const cols: ColPlan[] = [];
  for (const [cust, idxs] of byCustomer) {
    if (idxs.length > 1) {
      skipped.push(`${idxs.length} columns all read as "${cust}" with no amount band to tell them apart`);
      continue;
    }
    cols.push({ index: idxs[0], customer: cust, amountMin: 0, amountMax: fallbackAmountMax });
  }
  return { cols, skipped };
}

function readDomesticGrid(g: Grid, fallbackAmountMax: number | null): { rows: RateRow[]; skipped: string[] } | null {
  // Header rows: leading rows whose first cell is not itself a parseable tenure (unlike the
  // generic reader, which looks for the first *rate-shaped* cell -- that heuristic misfires here
  // because some early tenure rows print "--" in every rate column, e.g. "7 days to 14 days"
  // before SIB offered a rate for it).
  let h = 0;
  while (h < Math.min(4, g.rows.length) && !parseTenure(g.rows[h]?.[0] ?? "")) h++;
  if (h === 0 || h >= g.rows.length) return null;
  const width = Math.max(...g.rows.map((r) => r.length));
  const headerOf = (c: number) => g.rows.slice(0, h).map((r) => r[c] ?? "").join(" ");
  const body = g.rows.slice(h);
  const tenureOk = body.filter((r) => parseTenure(r[0] ?? "") !== null).length;
  if (tenureOk < 3) return null;

  const { cols, skipped } = planColumns(headerOf, width, fallbackAmountMax);
  if (cols.length === 0) return null;

  const rows: RateRow[] = [];
  for (const r of body) {
    const t = parseTenure(r[0] ?? "");
    if (!t) continue; // e.g. a "Tax Gain (5 Years)" scheme row embedded in the same table -- a different product, not captured here
    for (const col of cols) {
      const rate = parseRate(r[col.index] ?? "");
      if (rate === null) continue; // "--" / blank: no rate offered for this slab at this date
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: col.amountMin,
        amountMax: col.amountMax,
        customer: col.customer,
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  return { rows, skipped };
}

/**
 * J&K Bank's "others/common/intrates.php" prints, for each deposit-type table, BOTH the outgoing
 * rate ("Current Interest Rates per Annum") and the incoming one ("Revised Interest Rates per
 * Annum w.e.f. <date>") side by side in the same row -- a transition notice, not two customer or
 * amount tiers. The generic reader has no notion of "outgoing vs incoming" and classifies both
 * columns as plain "general" (both headers contain the word "Rate"), so whenever the two differ
 * the row conflicts and the whole snapshot is rejected by validateCard's conflicting_rows check.
 * Only the "Revised" column is the rate actually in force as of the date in its own header; the
 * "Current" column is the rate that was already in force before it, which (if the archive has a
 * capture from around then) is already captured in its own right as that earlier snapshot's own
 * "Revised" column. A "Deposit Type" column ("Domestic/NRO", "Domestic/NRO/NRE" ...) is dropped
 * the same way the generic reader already drops unlabelled columns -- it is never a rate.
 */
function readCurrentRevisedGrid(g: Grid, fallbackAmountMax: number | null): { rows: RateRow[]; skipped: string[] } | null {
  let h = 0;
  while (h < Math.min(4, g.rows.length) && !parseTenure(g.rows[h]?.[0] ?? "")) h++;
  if (h === 0 || h >= g.rows.length) return null;
  const width = Math.max(...g.rows.map((r) => r.length));
  const headerOf = (c: number) => g.rows.slice(0, h).map((r) => r[c] ?? "").join(" ");
  const body = g.rows.slice(h);
  const tenureOk = body.filter((r) => parseTenure(r[0] ?? "") !== null).length;
  if (tenureOk < 3) return null;

  const skipped: string[] = [];
  const cols: Array<{ index: number; customer: CustomerType }> = [];
  for (let c = 1; c < width; c++) {
    const header = headerOf(c).trim();
    if (!header) continue;
    if (/\bcurrent\b/i.test(header)) {
      skipped.push(`column ${c}: outgoing "Current" rate column, not the one now in force -- dropped`);
      continue; // the outgoing rate, superseded by the "Revised" column below
    }
    if (!/rate|%|p\.?a\.?|revised/i.test(header)) continue; // e.g. "Deposit Type" -- not a rate column
    cols.push({ index: c, customer: classifyCustomer(header) });
  }
  if (cols.length === 0) return null;

  const rows: RateRow[] = [];
  for (const r of body) {
    const t = parseTenure(r[0] ?? "");
    if (!t) continue;
    for (const col of cols) {
      const rate = parseRate(r[col.index] ?? "");
      if (rate === null) continue;
      rows.push({
        tenureMinDays: t.minDays,
        tenureMaxDays: t.maxDays,
        tenureLabel: r[0],
        special: t.point && t.minDays % 365 !== 0 ? true : undefined,
        amountMin: 0,
        amountMax: fallbackAmountMax,
        customer: col.customer,
        residency: "resident",
        callable: null,
        payout: null,
        rate,
      });
    }
  }
  return { rows, skipped };
}

export const parsers: Record<string, HistoricalParser> = {
  "south-indian-bank/domestic-term-deposit": (html, target): GenericResult => {
    const grids = extractTables(html);
    for (const g of grids) {
      const res = readDomesticGrid(g, target.amountMax ?? null);
      if (res && res.rows.length >= 3) {
        return { rows: res.rows, effectiveFrom: findEffectiveDate(pageText(html)), tablesRead: 1, skipped: res.skipped };
      }
    }
    return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no domestic term deposit table with a readable tenure column and at least 3 dated rows found"] };
  },

  // Karur Vysya Bank publishes several rate tables as small JSON documents behind its own
  // "api/v1/..." paths rather than as HTML (found via explore.ts discover, confirmed by fetching
  // a capture directly: the response body is JSON, not markup). `html` here is that raw JSON
  // text -- there is nothing to run `extractTables` on. Column keys encode both the amount tier
  // and the premature-withdrawal terms, e.g. "rupees_2_to_5_crore_premature_withdrawal_allowed" /
  // "..._not_allowed"; the amount tier is read by the same shared `parseAmountBand` helper used
  // everywhere else (it only looks at the numbers and comparison words, so the key's underscores
  // are simply swapped for spaces -- never a guess about what the tier boundaries are).
  "karur-vysya-bank/bulk-deposit-json": (html): GenericResult => {
    let doc: { data?: { content_above_the_table?: string; interest_rates?: Array<Record<string, string>> } };
    try {
      doc = JSON.parse(html);
    } catch (e) {
      return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: [`invalid JSON: ${(e as Error).message}`] };
    }
    const entries = doc.data?.interest_rates ?? [];
    const skipped: string[] = [];
    const rows: RateRow[] = [];
    for (const entry of entries) {
      const periodRaw = entry.period;
      const t = periodRaw ? parseTenure(periodRaw) : null;
      if (!t) {
        skipped.push(`row: unreadable period "${periodRaw}"`);
        continue;
      }
      for (const [key, cell] of Object.entries(entry)) {
        if (key === "period") continue;
        const rate = parseRate(cell);
        if (rate === null) continue;
        const callable = key.includes("not_allowed") ? false : key.includes("allowed") ? true : null;
        const bandKey = key.replace(/_premature_withdrawal_(not_)?allowed$/, "").replace(/_/g, " ");
        const band = parseAmountBand(bandKey);
        if (!band) {
          skipped.push(`column "${key}": no readable amount band from "${bandKey}"`);
          continue;
        }
        rows.push({
          tenureMinDays: t.minDays,
          tenureMaxDays: t.maxDays,
          tenureLabel: periodRaw,
          special: t.point && t.minDays % 365 !== 0 ? true : undefined,
          amountMin: band.min,
          amountMax: band.max,
          customer: "general",
          residency: "resident",
          callable,
          payout: null,
          rate,
        });
      }
    }
    const effectiveFrom = findEffectiveDate((doc.data?.content_above_the_table ?? "").replace(/<[^>]+>/g, " "));
    return { rows, effectiveFrom, tablesRead: rows.length > 0 ? 1 : 0, skipped };
  },

  "jk-bank/current-revised-rate-table": (html, target): GenericResult => {
    const grids = extractTables(html);
    for (const g of grids) {
      const res = readCurrentRevisedGrid(g, target.amountMax ?? null);
      if (res && res.rows.length >= 3) {
        return { rows: res.rows, effectiveFrom: findEffectiveDate(pageText(html)), tablesRead: 1, skipped: res.skipped };
      }
    }
    return { rows: [], effectiveFrom: null, tablesRead: 0, skipped: ["no term-deposit table with a readable tenure column and at least 3 dated rows found"] };
  },
};
