/**
 * RBL Bank — rbl.bank.in
 *
 * Pages covered:
 *  - Interest Rates hub (https://www.rbl.bank.in/interest-rates): despite the tab UI, the whole
 *    page is server-rendered — every tab's table is plain HTML in one document. It holds four
 *    FAQ-accordion cards we read: Savings, FD "Premature Withdrawal Allowed" (callable),
 *    FD "Premature Withdrawal NOT Allowed" (non-callable, ≥₹1 crore for individuals / ≥₹50 lakh
 *    for non-individuals), and Recurring/Smart Recurring Deposits (Domestic + Senior + NRE + NRO).
 *    The Bulk FD card (≥₹3 crore) is only *linked* from this page as separate PDFs, not embedded.
 *  - Bulk FD PDFs (webassets.rbl.bank.in/document/pdfs/{callable,non-callable}-bulk-fd-rates.pdf):
 *    a daily treasury card, "Valid for <value date>", with 17 irregular amount tiers redrawn
 *    every trading day. The file name itself is stable (no date in the URL), so no per-run link
 *    discovery is needed — re-fetching the same URL gets the current day's numbers.
 *
 * Quirks handled locally (no shared file touched):
 *  - RBL glues the word "Highest" straight onto its best rate with no separator ("7.20%Highest"),
 *    which breaks the shared parseRate (it expects nothing after the trailing "%"). We strip
 *    "Highest" from every table cell before handing the grid to parseTermTable.
 *  - The "Tax Savings Fixed Deposits (60 months)" row keeps its duration inside parentheses.
 *    parseTenure deliberately discards parenthesised text (it is normally a scheme-name
 *    annotation like "(Amrit Vrishti)"), so this row has no digits left to parse and would make
 *    parseTermTable throw for the whole table. We skip it in the generic pass (skipRow) and read
 *    it by hand, knowing 60 months = 1825 days.
 *  - Effective dates live in the prose immediately before each table ("...w.e.f. September 08,
 *    2026 Interest Rate on ..."), not inside the table's own header cells, so we read
 *    grid.context with the shared findEffectiveDate() instead of headerEffectiveDate().
 *  - The bulk PDF's column headers wrap across 2-3 short lines per column with no delimiter
 *    between columns ("Above\nRs.3.50 Cr\nto Rs. 4 Cr"). We collapse all whitespace and match
 *    "(Above )Rs.X Cr( to Rs.Y Cr)" tokens left to right — reliable because the bank writes each
 *    column exactly once, in order, before the first data row.
 */
import type { CustomerType, RateRow } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable, type TermTableSpec } from "../parse/term-table";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

/** Drop the bank's "...Highest" marketing suffix glued onto a rate so parseRate can read it. */
function withoutHighestMarker(g: Grid): Grid {
  return { ...g, rows: g.rows.map((r) => r.map((c) => c.replace(/highest/gi, "").trim())) };
}

const FD_COLUMNS = [
  { header: /general citizen.*interest rate/i, customer: "general" as CustomerType },
  { header: /senior citizen.*interest rate/i, customer: "senior" as CustomerType, exclude: /super senior/i },
  { header: /super senior citizen.*interest rate/i, customer: "super_senior" as CustomerType },
];

function fdTable(grid: Grid, spec: Omit<TermTableSpec, "columns">): RateRow[] {
  return parseTermTable(withoutHighestMarker(grid), { ...spec, columns: FD_COLUMNS });
}

/** The "Tax Savings Fixed Deposits (60 months)" row: duration is inside parens, so read it by hand. */
function taxSaverRow(grid: Grid): RateRow[] {
  const row = grid.rows.find((r) => /tax saving/i.test(r[0] ?? ""));
  if (!row) return [];
  const days = 1825; // 60 months, the statutory 5-year lock-in for tax-saving deposits
  const cols: Array<[number, CustomerType]> = [
    [1, "general"],
    [3, "senior"],
    [5, "super_senior"],
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
      note: "5-year tax-saving fixed deposit (Section 80C); statutorily locked in despite being listed on the premature-withdrawal-allowed card.",
    });
  }
  return out;
}

export const rblFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const callableGrid = requireGrid(grids, (g) => /flexi fixed deposit/i.test(g.context), "callable FD card (premature withdrawal allowed)");
  const nonCallableGrid = requireGrid(grids, (g) => /nre & nro fixed deposit/i.test(g.context) || /nre and nro fixed deposit/i.test(g.context), "non-callable FD card (premature withdrawal not allowed)");

  const callableRows = fdTable(callableGrid, { amountMin: 0, amountMax: 3 * CRORE, callable: true, skipRow: /tax saving/i });
  const nonCallableRows = fdTable(nonCallableGrid, { amountMin: 1 * CRORE, amountMax: 3 * CRORE, callable: false });
  const rows = [...callableRows, ...nonCallableRows, ...taxSaverRow(callableGrid)];

  const effectiveFrom = findEffectiveDate(callableGrid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the FD card's lead-in text");

  const notes = [
    "Non-callable card applies from ₹1 crore for individual customers and from ₹50 lakh for non-individual customers (both still below the ₹3 crore bulk threshold); shown here from ₹1 crore so the band never overstates eligibility.",
    "Senior Citizen (0.50% p.a.) and Super Senior Citizen (0.75% p.a.) additions do not apply to NRE/NRO deposits.",
  ];
  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });

  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a. (60 to below 80 years); not applicable to NRE/NRO deposits",
        superSeniorPremium: "+0.75% p.a. (80 years and above); exempt from the premature-withdrawal penalty; not applicable to NRE/NRO deposits",
        prematurePenalty: "1% on the rate applicable for the actual holding period; senior and super senior citizens are exempt",
        other: ["Fixed deposits booked as 'premature withdrawal not allowed' cannot be withdrawn early except by government/regulatory/legal order or on death of the depositor."],
      },
    ],
  };
};

export const rblSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = requireGrid(grids, (g) => /savings deposit/i.test(g.context), "savings interest table");
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the savings table's lead-in text");

  const slabs = grid.rows
    .filter((r) => parseRate(r[1] ?? "") !== null)
    .map((r) => {
      const label = cleanText(r[0]);
      const rate = parseRate(r[1] ?? "")!;
      const nums = [...label.matchAll(/(\d+(?:\.\d+)?)\s*(lakh|crore)/gi)].map((m) => Number(m[1]) * (/crore/i.test(m[2]) ? CRORE : 1e5));
      const upto = /^upto/i.test(label);
      const above = /^above/i.test(label);
      if (upto) return { balanceMin: 0, balanceMax: nums[0] + 1, rate, residency: "resident" as const };
      if (above && nums.length >= 2) return { balanceMin: nums[0] + 1, balanceMax: nums[1] + 1, rate, residency: "resident" as const };
      if (above) return { balanceMin: nums[0] + 1, balanceMax: null, rate, residency: "resident" as const };
      throw new AdapterError(`unrecognised savings slab label "${label}"`);
    });
  if (slabs.length === 0) throw new AdapterError("no savings slabs found");

  const card = makeCard(ctx, "savings", [], {
    effectiveFrom,
    savingsSlabs: slabs,
    slabMethod: "incremental",
    notes: [
      'Bank states: "The Savings Account interest rate is calculated using a progressive slab method" — each slice of the balance earns its own slab\'s rate.',
      "Interest is calculated daily and credited monthly (changed from quarterly on 1 May 2025); leap years use 366 days.",
    ],
  });
  return { cards: [card] };
};

export const rblRd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const grid = withoutHighestMarker(requireGrid(grids, (g) => /recurring deposit/i.test(g.context), "recurring deposit table"));
  const effectiveFrom = findEffectiveDate(grid.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found in the RD table's lead-in text");

  const base = { amountMin: 0, amountMax: 3 * CRORE, callable: true as const };
  const rows = [
    ...parseTermTable(grid, { ...base, residency: "resident", columns: [{ header: /domestic interest/i, customer: "general" }] }),
    ...parseTermTable(grid, { ...base, residency: "resident", columns: [{ header: /senior citizen interest/i, customer: "senior" }] }),
    ...parseTermTable(grid, { ...base, residency: "nre", columns: [{ header: /nre interest/i, customer: "general" }] }),
    ...parseTermTable(grid, { ...base, residency: "nro", columns: [{ header: /nro interest/i, customer: "general" }] }),
  ];

  const card = makeCard(ctx, "rd", rows, {
    effectiveFrom,
    notes: ["Read directly from the bank's own RD table (not derived from the FD card). NRE/NRO columns carry no separate senior-citizen rate — RBL states Senior Citizen rates do not apply to NRIs."],
  });
  return { cards: [card] };
};

interface BulkColumn {
  min: number;
  max: number | null;
}

const BULK_COLUMN_RE = /(above\s+)?rs\.?\s*(\d+(?:\.\d+)?)\s*cr(?:\s*to\s*rs\.?\s*(\d+(?:\.\d+)?)\s*cr)?/gi;
const BULK_ROW_RE = /^(.+?)\s+((?:\d+\.\d+\s*)+)$/;

function extractValidForDate(text: string): string | null {
  const m = /valid for\s+([^\n]+?)\s+value date/i.exec(cleanText(text));
  return m ? parseDate(m[1]) : null;
}

/** Parse the daily bulk-FD treasury PDF (17 irregular amount tiers, no senior-citizen split). */
function parseBulkPdf(text: string): RateRow[] {
  const collapsed = cleanText(text);
  const columns: BulkColumn[] = [];
  for (const m of collapsed.matchAll(BULK_COLUMN_RE)) {
    const lo = Number(m[2]) * CRORE;
    const hi = m[3] ? Number(m[3]) * CRORE : null;
    columns.push({ min: m[1] ? lo + 1 : lo, max: hi });
  }
  if (columns.length === 0) throw new AdapterError("no amount-tier columns found in the bulk FD PDF header");

  const rows: RateRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const rm = BULK_ROW_RE.exec(line);
    if (!rm) continue;
    const nums = rm[2].trim().split(/\s+/).map(Number);
    if (nums.length !== columns.length) continue; // wrapped header fragment or footer line, not a tenor row
    const label = rm[1].trim();
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`cannot read bulk FD tenor "${label}"`);
    columns.forEach((c, i) => {
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        amountMin: c.min,
        amountMax: c.max,
        customer: "general",
        residency: "resident",
        callable: null, // set by the caller
        payout: null,
        rate: nums[i],
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("no data rows found in the bulk FD PDF");
  return rows;
}

const BULK_NOTES = [
  "Daily treasury card (the PDF states its own 'Valid for <date>' value date each day); no senior-citizen column — one flat rate applies to every customer per tenure/amount tier.",
  "17 amount tiers from ₹3 crore upward; two unusually narrow tiers (₹5.60–5.75cr and ₹10.60–10.75cr) carry a distinctly lower rate on the day this was captured — read directly from the PDF, not smoothed.",
];

export const rblBulkCallable: Adapter = async (ctx) => {
  const rows = parseBulkPdf(ctx.doc.text).map((r) => ({ ...r, callable: true as const }));
  const effectiveFrom = extractValidForDate(ctx.doc.text);
  const card = makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes: [...BULK_NOTES, "Premature withdrawal allowed (callable)."] });
  return { cards: [card] };
};

export const rblBulkNonCallable: Adapter = async (ctx) => {
  const rows = parseBulkPdf(ctx.doc.text).map((r) => ({ ...r, callable: false as const }));
  const effectiveFrom = extractValidForDate(ctx.doc.text);
  const card = makeCard(ctx, "fd_bulk", rows, { effectiveFrom, notes: [...BULK_NOTES, "Premature withdrawal NOT allowed (non-callable)."] });
  return { cards: [card] };
};

const NONCALLABLE_BULK_PDF = "https://webassets.rbl.bank.in/document/pdfs/non-callable-bulk-fd-rates.pdf";

/**
 * Both bulk cards as ONE fd_bulk card: the source page is the callable PDF, and the non-callable
 * PDF is fetched in the same run. (Two separate sources writing the same product would replace
 * each other on every run and create a new "version" each time.) If the two PDFs carry different
 * "Valid for" dates, the combined card is dated from the later one and both dates are noted.
 */
export const rblBulk: Adapter = async (ctx) => {
  const callable = parseBulkPdf(ctx.doc.text).map((r) => ({ ...r, callable: true as const }));
  const callableDate = extractValidForDate(ctx.doc.text);
  const ncDoc = await ctx.fetch(NONCALLABLE_BULK_PDF, "pdf");
  const nonCallable = parseBulkPdf(ncDoc.text).map((r) => ({ ...r, callable: false as const }));
  const ncDate = extractValidForDate(ncDoc.text);
  const dates = [callableDate, ncDate].filter((d): d is string => !!d).sort();
  const effectiveFrom = dates.at(-1) ?? null;
  const notes = [...BULK_NOTES, "Callable (premature withdrawal allowed) and non-callable rows come from the bank's two daily bulk PDFs."];
  if (callableDate !== ncDate) notes.push(`The callable PDF is valid for ${callableDate ?? "an unstated date"} and the non-callable PDF for ${ncDate ?? "an unstated date"}.`);
  const card = makeCard(ctx, "fd_bulk", [...callable, ...nonCallable], { effectiveFrom, notes });
  return { cards: [card] };
};
