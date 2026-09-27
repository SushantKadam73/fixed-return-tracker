/**
 * Suryoday Small Finance Bank — suryoday.bank.in
 * Page: Rate Of Interest hub — "Savings Accounts" tab (live source) and "Fixed Deposits" tab
 * (written, tested, but NOT registered live — see below).
 *
 * IMPORTANT — sandbox access: a plain `fetch`/curl to suryoday.bank.in (and the legacy
 * suryodaybank.com) still returns HTTP 502 on every path from this build environment
 * (re-confirmed 2026-09-27); `format` stays "html" for the savings source (unchanged) — a
 * WAF/CDN block specific to this sandbox's plain-HTTP egress is not evidence GitHub Actions/the
 * VPS are blocked the same way (this project's own convention elsewhere). This pass DID reach
 * the real page — through a real, JS-executing headless-browser session — and used that access to
 * replace the savings table's previous *reconstruction* (text copied verbatim from a
 * search-engine cache, real numbers but guessed markup) with a genuine capture of its actual
 * markup. Its slab boundaries and rates had also moved since that reconstruction (a real change
 * on the bank's side, not a capture error): the fixture and this adapter now reflect the current
 * 9-slab ladder (effective 2026-08-01), not the previous 7-slab one.
 *
 * Fixed Deposits — found, but not shippable as a live source with this project's current
 * fetchers: the previous finding ("every attempt only ever surfaced a tenure-selector widget's
 * currently-selected default, never the full tenure table") turns out to be because the FD
 * table's markup does not exist anywhere in the page's HTML — hidden or otherwise — until its
 * "Fixed Deposits" tab is actually *clicked* (confirmed directly: `document.documentElement.
 * outerHTML` contains none of the FD table's distinctive text before that click, on a freshly
 * loaded page). That is a genuine client-side interaction, not something either a plain fetch
 * (`format: "html"`) or this project's own `format: "browser"` fetcher can produce — `fetch.ts`'s
 * `browserFetch` only does `page.goto` + `page.content()`, with no click step, so it would land
 * on the same default (Savings) tab a plain fetch does. Reaching the FD table took this session's
 * own interactive clicking, a capability outside `collectors/src/fetch.ts` (out of scope to
 * change here). `suryodaySfbFd` below is therefore written and tested against a genuine capture
 * (a full 17-tenure ladder, General + Senior Citizen columns, explicitly captioned "Rate for
 * amount < 3 Crore" — retail only; no bulk/₹3cr+ tab or toggle was found on this hub) but is
 * deliberately NOT wired into any source in `data/sources/fragments/d1.json` — registering it
 * would just fail every single run (the tab it needs is never clicked), which is strictly worse
 * than not registering it at all. Left ready for whenever `fetch.ts` gains a click/interaction
 * step for `format: "browser"` sources. Recurring Deposits has its own tab too but wasn't
 * captured this pass (the interactive session became unstable navigating between tabs) — a
 * further follow-up, not a guess.
 *
 * Quirks:
 *  - Slab labels (savings) and one tenure label ("1 Year*") carry stray characters:
 *    "Above Rs. X up to & including Rs. Y" isn't recognised as inclusive-of-Y by the shared
 *    `parseAmountBand` (it only recognises "and including" / "upto", not "& including"), so
 *    savings slabs use a small local `band()` reader instead; the "*" on "1 Year*" (a footnote
 *    marker: "Premature withdrawal of Cumulative Payout Fixed Deposits booked for 1-year tenure
 *    will not attract any penalty charges") is already stripped by the shared `parseTenure`
 *    itself, so the FD table needs no equivalent workaround.
 *  - The top savings slab ("Above Rs. 25 Crore") has no printed number, just "Contact Branch" —
 *    omitted rather than guessed.
 *  - Two rate cells (one savings slab, the FD table's 5-year point tenure) carry a "Highest"
 *    marketing badge glued onto the number with no space ("7.60%Highest", "8.25%Highest" — same
 *    DCB-style quirk); `parseRate`'s strict match would silently drop those cells (returns null,
 *    not a throw) rather than mis-read them, so the badge is stripped from the raw HTML before
 *    `extractTables` runs, the same fix DCB's adapter uses locally for its own page.
 */
import { amountsIn } from "../parse/amount";
import { parseDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerText, makeCard, requireGrid } from "./helpers";

function band(label: string): { min: number; max: number | null } {
  const nums = amountsIn(label);
  const t = label.toLowerCase();
  if (/^\s*up to/.test(t)) return { min: 0, max: nums[0] + 1 };
  if (/^\s*above/.test(t)) return nums.length >= 2 ? { min: nums[0] + 1, max: nums[1] + 1 } : { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised savings slab label "${label}"`);
}

/** See file header: a "Highest" marketing badge sits glued onto some rate cells. */
function stripHighestBadge(html: string): string {
  return html.replace(/highest/gi, "");
}

/** The date sits in a caption above the table ("Important: ... effective from May 01, 2026" /
 * "... Rates and T&C are effective from September 24, 2026"), not inside any table cell, so read
 * it from the grid's `context` rather than `headerEffectiveDate`. */
function captionDate(context: string): string | null {
  const m = /effective from\s*([^.<]{4,30})/i.exec(context);
  return m ? parseDate(m[1]) : null;
}

export const suryodaySfbSavings: Adapter = async (ctx) => {
  const grids = extractTables(stripHighestBadge(ctx.doc.text));
  const g = requireGrid(grids, (x) => /daily closing balance/i.test(headerText(x, 1)), "savings slab table");
  const effectiveFrom = captionDate(g.context);
  if (!effectiveFrom) throw new AdapterError("no effective date found for the savings table");

  const slabs = g.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return []; // e.g. "Contact Branch" — no published number for that tier
    const b = band(r[0] ?? "");
    return [{ balanceMin: b.min, balanceMax: b.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs read");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: "incremental", // page: "Slab rates are applicable on the incremental amount..."
        notes: ["Applies to Domestic/NRE/NRO savings accounts per the table's own column header. Above ₹25 crore the bank prints \"Contact Branch\", no number — not published, so not included as a slab."],
      }),
    ],
  };
};

/** Retail (<₹3cr) Fixed Deposits, General + Senior Citizen, read from the hub's "Fixed Deposits"
 * tab (see file header — only reachable via a real client-side tab click, not a cache/plain fetch). */
export const suryodaySfbFd: Adapter = async (ctx) => {
  const grids = extractTables(stripHighestBadge(ctx.doc.text));
  const g = requireGrid(grids, (x) => /period/i.test(headerText(x, 1)) && /interest rate/i.test(headerText(x, 1)), "Fixed Deposits table");
  const effectiveFrom = captionDate(g.context);
  if (!effectiveFrom) throw new AdapterError("no effective date found for the Fixed Deposits table");
  if (!/<\s*3\s*crore|less than.*3.*crore/i.test(g.context)) {
    throw new AdapterError('Fixed Deposits table no longer states "<3 Crore" — cannot confirm this card\'s amount scope');
  }

  const rows = parseTermTable(g, {
    columns: [
      { header: /interest rate/i, customer: "general", exclude: /senior|yield/i },
      { header: /senior citizen/i, customer: "senior", exclude: /yield/i },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  return {
    cards: [
      makeCard(ctx, "fd", rows, {
        effectiveFrom,
        notes: [
          "The bank's own \"Annualised Yield\" columns (a compounded figure) alongside each rate column are not read here; only the nominal \"Interest Rate (Per Annum)\" / \"Senior Citizen Rate (Per Annum)\" columns feed this card.",
          "No bulk (≥₹3 crore) tab or toggle was found on this hub page — only the retail card is covered.",
        ],
      }),
    ],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, prematurePenalty: "Premature withdrawal of Cumulative Payout Fixed Deposits booked for the 1-year tenure attracts no penalty (bank's own footnote); other tenures not stated on this page." }],
  };
};
