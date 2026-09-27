/**
 * Suryoday Small Finance Bank — suryoday.bank.in
 * Page: Rate Of Interest hub, "Savings Accounts" tab.
 *
 * IMPORTANT — sandbox access: both suryoday.bank.in and the legacy suryodaybank.com returned
 * HTTP 502 on every path tried from this build environment (home page, robots.txt, every rate
 * sub-page), across two rounds ~20 minutes apart. That looks like a WAF/CDN block specific to
 * this sandbox's egress rather than a real outage (a search engine's own crawler reaches the
 * site fine). The fixture used to build/test this adapter is a *reconstruction*: the savings
 * table's header/row text is copied verbatim from a search-engine cache of this exact official
 * URL (https://suryoday.bank.in/rate-of-interest/), not an aggregator's numbers. The live source
 * stays `active: true` with a note — GitHub Actions or the VPS may not be blocked; re-verify
 * table markup the first time a run actually reaches the live page.
 *
 * FD and RD are NOT covered here: every attempt (sandbox fetch, and a cache of the FD/RD product
 * pages and of this same hub's other tabs) only ever surfaced a tenure-*selector widget*'s
 * currently-selected default (one tenure's rate), never the full tenure table — nothing to build
 * a reliable parser against without guessing the other tenures' numbers. See the run report.
 *
 * Quirks:
 *  - Slab labels read "Above Rs. X up to & including Rs. Y". The shared `parseAmountBand`
 *    doesn't treat "up to & including" as inclusive of Y (it only recognises "and including" /
 *    "upto", not "& including"), which would leave a 1-rupee gap between slabs — `band()` below
 *    is a small local reader for this bank's exact phrasing. Local-only workaround, not a change
 *    to the shared parser.
 *  - The top slab ("Above Rs. 25 Crore") has no printed number, just "Contact Branch" — omitted
 *    rather than guessed.
 */
import { amountsIn } from "../parse/amount";
import { parseDate, parseRate } from "../parse/common";
import { extractTables } from "../parse/html-table";
import type { Adapter } from "../types";
import { AdapterError, headerText, makeCard, requireGrid } from "./helpers";

function band(label: string): { min: number; max: number | null } {
  const nums = amountsIn(label);
  const t = label.toLowerCase();
  if (/^\s*up to/.test(t)) return { min: 0, max: nums[0] + 1 };
  if (/^\s*above/.test(t)) return nums.length >= 2 ? { min: nums[0] + 1, max: nums[1] + 1 } : { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised savings slab label "${label}"`);
}

/** The date sits in the caption above the table ("Important: ... effective from May 01, 2026"),
 * not inside any table cell, so read it from the grid's `context` rather than `headerEffectiveDate`. */
function captionDate(context: string): string | null {
  const m = /effective from\s*([^.<]{4,30})/i.exec(context);
  return m ? parseDate(m[1]) : null;
}

export const suryodaySfbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
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
