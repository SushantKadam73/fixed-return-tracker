/**
 * DCB Bank — dcb.bank.in
 *
 * The "/rates/<tid>" pages (fixed-deposit-interest-rate, savings-account-interest-rates, ...)
 * are a client-rendered Next.js app: a plain GET of the page returns a shell with no rate data
 * at all — confirmed both in the server-rendered HTML and in its React Flight/RSC payload
 * (checked with and without the `RSC: 1` request header) — neither contains a single tenure
 * label or rate figure. The real content is fetched by the browser, after mount, as a
 * same-origin JSON POST:
 *
 *   POST https://www.dcb.bank.in/api/api-interceptor    body: {"url": "<virtual path>", "method": "GET"}
 *
 * (confirmed from the page's own JS bundle, chunk `page-693fbf33c806bc16.js`: a plain axios
 * instance posts to this one route for every rates call. A *different* axios instance in the
 * same bundle is preconfigured with baseURL `https://webappvirtual.dcbbank.com/api`, but it is
 * never used by this component — and separately, that legacy host is unreachable, 502, from
 * this sandbox — so it is not used here.) Three such calls, chained by the ids each returns:
 *   {"url":"/rates-main-nav","method":"GET"}                 -> top nav (Savings/FD/NRI/...), each with a `tid`
 *   {"url":"/rates-sub-nav?main_nav=<tid>","method":"GET"}   -> sub-tabs under one nav entry, each with a `tid`
 *   {"url":"/rates?id=<subTid>","method":"GET"}              -> {data:{data:[{rate_details:[...]}]}}
 * `main_nav`'s tid is exactly the page's own URL slug (the bundle's tab-click handler does
 * `router.push("/rates/"+tid)` with that same tid), so this adapter derives it from
 * `ctx.source.url` instead of spending an extra call on `/rates-main-nav`.
 *
 * This is the plain-HTTP source this project prefers over a headless browser: `ctx.fetch` now
 * accepts an optional POST `init` (see `../types.ts` `FetchInit`, added for this adapter — a
 * backward-compatible addition since every other adapter omits it and keeps doing a plain GET).
 *
 * Each `rate_details[]` entry is `{title, subtitle, details}`; `details` is genuine HTML (an
 * Excel-exported `<table>`) and `subtitle` carries that table's own "(with effect from ...)"
 * date. The FD page's 8 entries, in order: [0] retail <3cr (General/Senior/Senior-Plus columns,
 * each paired with an "Effective Annualized Yield" column — only the nominal rate column is
 * read), [1] non-callable retail (>1cr-<3cr, one column, no senior tiers published), [2]-[5]
 * four bulk bands (3-5cr, 5-10cr, 20-50cr, 50cr+ — ₹10-20cr is simply not published, not a
 * parsing gap), [6]/[7] premature-withdrawal penalty notes (prose, not a rate table; folded into
 * `terms.prematurePenalty`).
 *
 * Quirks:
 *  - Some rate cells carry a "Highest" marketing badge glued onto the number with no space
 *    ("7.50%Highest"), which breaks `parseRate`'s strict `^...$` match; stripped before parsing
 *    (`stripHighestBadge`) since it changes nothing about the number itself.
 *  - Amount-band captions ("...for single deposit of above ₹ 1 Crore to less than ₹ 3 Crore.")
 *    have enough leading prose that the shared `parseAmountBand`'s start-anchored "above" check
 *    never fires (and its "to"-word-boundary check never fires for "upto" written as one word),
 *    so bands are read here with `parseBand`, a small local helper that looks for the keywords
 *    anywhere in the label.
 *
 * Not covered: RD. There is no "Recurring Deposit" entry in `/rates-main-nav` at all, and the
 * dedicated "DCB Pragati Recurring Deposit" product page's only rate-related content block is a
 * link ("Click here for best rates") to this FD page — not an explicit statement that RD rates
 * equal FD rates for the same tenure. Per policy, RD is left out rather than derived from a
 * link that could just as easily mean "we don't publish a separate RD table".
 */
import type { RateRow } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, findEffectiveDate, parseRate } from "../parse/common";
import { extractTables, type Grid } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter, AdapterContext } from "../types";
import { AdapterError, CRORE, headerText, makeCard } from "./helpers";

const INTERCEPTOR_PATH = "/api/api-interceptor";

interface RateDetailItem {
  title: string;
  subtitle: string | null;
  details: string;
}

/** POST {url, method:"GET"} to the site's own same-origin proxy route (see file header) and
 * return the unwrapped `data` payload. Throws loudly on any shape the bundle doesn't produce. */
async function postInterceptor(ctx: AdapterContext, virtualPath: string): Promise<unknown> {
  const interceptorUrl = new URL(INTERCEPTOR_PATH, ctx.source.url).toString();
  const doc = await ctx.fetch(interceptorUrl, "json", { method: "POST", body: JSON.stringify({ url: virtualPath, method: "GET" }) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(doc.text);
  } catch {
    throw new AdapterError(`DCB: api-interceptor response for "${virtualPath}" was not JSON`);
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  if (data === undefined) throw new AdapterError(`DCB: api-interceptor response for "${virtualPath}" had no "data" field`);
  return data;
}

/** The main-nav tid is exactly the page's own URL slug (see file header) — derived from the
 * registered source URL, not hardcoded or guessed. */
function mainNavTidFromUrl(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop();
  if (!slug) throw new AdapterError(`DCB: cannot derive a rates tid from source URL "${url}"`);
  return slug;
}

/** Sub-nav -> rate_details, for every sub-tab under this page's main-nav entry (there is
 * exactly one sub-tab for both Fixed Deposit and Savings today, but this does not assume that). */
async function fetchRateDetails(ctx: AdapterContext): Promise<RateDetailItem[]> {
  const mainNavTid = mainNavTidFromUrl(ctx.source.url);
  const subNav = await postInterceptor(ctx, `/rates-sub-nav?main_nav=${encodeURIComponent(mainNavTid)}`);
  const subTabs = (subNav as { tid?: string }[] | null) ?? [];
  if (!Array.isArray(subTabs) || subTabs.length === 0) throw new AdapterError(`DCB: no rates-sub-nav entries for main_nav="${mainNavTid}"`);

  const out: RateDetailItem[] = [];
  for (const tab of subTabs) {
    if (!tab.tid) throw new AdapterError(`DCB: a rates-sub-nav entry for main_nav="${mainNavTid}" has no tid`);
    const rates = await postInterceptor(ctx, `/rates?id=${encodeURIComponent(tab.tid)}`);
    const rows = (rates as { data?: unknown[] } | null)?.data;
    const first = Array.isArray(rows) ? (rows[0] as { rate_details?: unknown } | undefined) : undefined;
    const details = first?.rate_details;
    if (!Array.isArray(details)) throw new AdapterError(`DCB: /rates?id=${tab.tid} had no rate_details array`);
    out.push(...(details as RateDetailItem[]));
  }
  return out;
}

/** A "Highest" marketing badge is glued onto some rate cells with no separating space
 * ("7.50%Highest"), which breaks parseRate's strict match; strip the word, not the number. */
function stripHighestBadge(html: string): string {
  return html.replace(/highest/gi, "");
}

function firstGrid(html: string, what: string): Grid {
  const grids = extractTables(stripHighestBadge(html));
  if (grids.length === 0) throw new AdapterError(`DCB: no <table> found in "${what}"`);
  return grids[0];
}

/** The bulk tables' caption cell has `colspan="2"` (spanning the Regular/Non-Callable columns),
 * so `extractTables`' colspan fill duplicates its text into both columns — `headerText`, which
 * just concatenates whole rows, would then see the caption's amount twice and misread "₹50
 * Crore & Above" as a two-number range. Read row 0's own column 1 directly instead, once. */
function captionCell(g: Grid): string {
  return cleanText(g.rows[0]?.[1] ?? "");
}

/**
 * Amount-band captions here have enough leading prose ("...for single deposit of above ₹ 1
 * Crore to less than ₹ 3 Crore.") that the shared `parseAmountBand`'s start-anchored "above"
 * check, and its \bto\b-based upper-inclusive check (defeated by "upto" written as one word),
 * never fire. This reads the same keywords anywhere in the label instead. Also used for the
 * savings slabs below, whose labels have the same "above X to less than Y" / "from X to less
 * than Y" / "X and above" shapes.
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
  throw new AdapterError(`DCB: cannot read amount band "${label}"`);
}

const YIELD = /yield/i;

export const dcbFd: Adapter = async (ctx) => {
  const details = await fetchRateDetails(ctx);
  const retail = details.find((d) => /fixed deposit interest rates/i.test(d.title) && !/non[\s-]*callable/i.test(d.title) && !/penal/i.test(d.title));
  if (!retail) throw new AdapterError('DCB FD: no "Fixed Deposit Interest Rates" entry in rate_details');
  const effectiveFrom = findEffectiveDate(retail.subtitle ?? "");
  if (!effectiveFrom) throw new AdapterError(`DCB FD: no effective date in subtitle "${retail.subtitle}"`);

  const grid = firstGrid(retail.details, retail.title);
  const rows = parseTermTable(grid, {
    columns: [
      { header: /general/i, customer: "general", exclude: YIELD },
      { header: /senior citizens/i, customer: "senior", exclude: /plus|yield/i },
      { header: /senior citizens plus/i, customer: "super_senior", exclude: YIELD },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  const notes: string[] = ["The bank's own 'Effective Annualized Yield' columns (a compounded figure) alongside each rate column are not read here; only the nominal 'Deposit Interest Rate' columns feed this card."];
  const nonCallable = details.find((d) => /non[\s-]*callable/i.test(d.title));
  if (nonCallable) {
    const ncEffectiveFrom = findEffectiveDate(nonCallable.subtitle ?? "");
    const ncGrid = firstGrid(nonCallable.details, nonCallable.title);
    const band = parseBand(headerText(ncGrid, 2));
    rows.push(
      ...parseTermTable(ncGrid, {
        columns: [{ header: /non[\s-]*callable/i, customer: "general" }],
        amountMin: band.min,
        amountMax: band.max,
        callable: false,
      }),
    );
    const dateNote = ncEffectiveFrom && ncEffectiveFrom !== effectiveFrom ? ` (that table's own date is ${ncEffectiveFrom}, used as printed rather than ${effectiveFrom})` : "";
    notes.push(`Non-callable rows (>₹1cr-<₹3cr) have no senior-citizen column published${dateNote}.`);
  } else {
    notes.push("Non-callable retail table not found on this fetch; only callable rows are published in this card.");
  }

  const penal = details.find((d) => /penal interest.*inr/i.test(d.title));
  const penalNote = penal ? cleanText(penal.details.replace(/<[^>]+>/g, " ")) : undefined;

  return {
    cards: [makeCard(ctx, "fd", rows, { effectiveFrom, notes })],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "Printed as its own 'Senior Citizens' column (age 60-<70), separate from 'Senior Citizens Plus' (age 70+) — not a flat add-on.",
        prematurePenalty: penalNote ?? "Published on the FD page under 'Penal Interest for Premature Closure of INR Fixed Deposit', not re-fetched into this note.",
      },
    ],
  };
};

export const dcbBulk: Adapter = async (ctx) => {
  const details = await fetchRateDetails(ctx);
  const bulkItems = details.filter((d) => /bulk deposit/i.test(d.title));
  if (bulkItems.length === 0) throw new AdapterError('DCB bulk: no "Bulk Deposits" entries in rate_details');

  const rows: RateRow[] = [];
  const dates: string[] = [];
  for (const item of bulkItems) {
    const grid = firstGrid(item.details, item.title);
    const band = parseBand(captionCell(grid));
    const effectiveFrom = findEffectiveDate(item.subtitle ?? "");
    if (effectiveFrom) dates.push(effectiveFrom);
    rows.push(
      ...parseTermTable(grid, { columns: [{ header: /regular/i, customer: "general" }], amountMin: band.min, amountMax: band.max, callable: true }),
    );
    // "-" cells (no non-callable option below ~91 days) parse to null and are dropped, matching
    // the bank's own convention elsewhere on this page.
    rows.push(...parseTermTable(grid, { columns: [{ header: /non[\s-]*callable/i, customer: "general" }], amountMin: band.min, amountMax: band.max, callable: false }));
  }
  const effectiveFrom = dates.sort().at(-1) ?? null;
  if (!effectiveFrom) throw new AdapterError("DCB bulk: no effective date found in any bulk band's subtitle");

  return {
    cards: [
      makeCard(ctx, "fd_bulk", rows, {
        effectiveFrom,
        notes: [
          "Four amount bands are published (₹3-<5cr, ₹5-<10cr, ₹20-<50cr, ₹50cr & above); ₹10-<20cr is simply absent from the bank's own page, not a parsing gap. Each band carries its own effective date (used per-row implicitly via this card's overall latest date; see each band's own subtitle if reconciling).",
          "No senior-citizen column is published for any bulk band.",
        ],
      }),
    ],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, other: ["₹10 crore-<₹20 crore is not published as its own band on this page."] }],
  };
};

export const dcbSavings: Adapter = async (ctx) => {
  const details = await fetchRateDetails(ctx);
  const item = details.find((d) => /savings/i.test(d.title));
  if (!item) throw new AdapterError('DCB savings: no "Savings" entry in rate_details');
  const effectiveFrom = findEffectiveDate(item.subtitle ?? "");
  if (!effectiveFrom) throw new AdapterError(`DCB savings: no effective date in subtitle "${item.subtitle}"`);

  const grid = firstGrid(item.details, item.title);
  const headerIdx = grid.rows.findIndex((r) => /balance range/i.test(cleanText(r[0] ?? "")));
  if (headerIdx < 0) throw new AdapterError('DCB savings: header row "Balance Range" not found');
  const slabs = grid.rows.slice(headerIdx + 1).flatMap((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = parseRate(r[1] ?? "");
    if (!label || rate === null) return [];
    const band = parseBand(label);
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("DCB savings: no balance slabs found");

  const incrementalStated = /incremental balances/i.test(item.details);
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: incrementalStated ? "incremental" : "unknown",
        notes: incrementalStated
          ? ["Bank's own T&C: \"Rates mentioned are applicable for the incremental balances that are present corresponding to the amount slabs mentioned.\""]
          : undefined,
      }),
    ],
  };
};
