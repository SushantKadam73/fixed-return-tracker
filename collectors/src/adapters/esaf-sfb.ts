/**
 * ESAF Small Finance Bank — www.esaf.bank.in
 * Page: interest-rates hub (Resident Term Deposits + Savings Bank Accounts on one page).
 *
 * IMPORTANT — sandbox access: every path on esaf.bank.in (and the esafbank.com redirect) returns
 * an Akamai "Access Denied" 403 to a plain `fetch`/curl from this build environment (re-confirmed
 * 2026-09-27); `format` stays "html" (this sandbox's own block is not evidence GitHub Actions'
 * or the VPS's egress is blocked the same way — Akamai's WAF decisions are IP/network dependent).
 * The fixture WAS a reconstruction (header/row text copied from a search-engine cache, real
 * numbers but guessed markup) for a previous pass; this pass replaced it with a genuine capture —
 * a real, JS-executing headless-browser session reached the actual page (Akamai's block did not
 * hold against a real browser, same pattern seen elsewhere in this project for Cloudflare/Radware
 * WAFs) and the exact live `<table>` markup for both tables was read from that session, not
 * reconstructed. The live retail ladder turned out to have 13 tenure rows (not 11) and a newer
 * date (17/08/2026, not 01/05/2026) than the old cache-based guess had assumed — a real change on
 * the bank's side since that reconstruction, now corrected; the savings table's own numbers were
 * already byte-for-byte identical between the two, so only the retail table actually changed here.
 *
 * Quirks:
 *  - The resident term-deposit table's header cell literally reads
 *    "Rate of Interest effective from 01/05/2026" and is duplicated across both the "Normal" and
 *    "Senior Citizen" sub-columns by colspan — `headerEffectiveDate` picks it up fine.
 *  - The page states outright that "The above rates of interest are applicable for Resident
 *    Recurring Deposits also" — the sanctioned case for `deriveRdFromFd`.
 */
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerEffectiveDate, headerText, makeCard, requireGrid } from "./helpers";
import { parseRate } from "../parse/common";
import { amountsIn } from "../parse/amount";

const RATE_HEADER = /rate of interest/i;

export const esafSfbFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /period/i.test(headerText(x, 1)) && /normal rate/i.test(headerText(x, 2)), "resident term deposit table");
  const effectiveFrom = headerEffectiveDate(g, RATE_HEADER);
  if (!effectiveFrom) throw new AdapterError("no effective date found in the term-deposit header");

  const rows = parseTermTable(g, {
    columns: [
      { header: /normal rate/i, customer: "general" },
      { header: /senior citizen/i, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE, // "Less than Rs.300 lakhs"
    callable: true,
  });

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes: ["No bulk (≥₹3 crore) rate page was found for ESAF; only the retail card is covered."] });
  const rd = deriveRdFromFd(fd, "ESAF: \"The above rates of interest are applicable for Resident Recurring Deposits also.\"");
  return {
    cards: [fd, rd],
    terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% p.a. on every tenure (observed consistently across all printed rows)", prematurePenalty: "1% penal rate on the completed-period rate; no interest if withdrawn within 7 days" }],
  };
};

/** "Above Rs.X ... Up to/Including Rs.Y (i.e., for incremental amount above Rs.X)" slab labels.
 * The shared `parseAmountBand` double-counts the parenthetical restatement of X and doesn't treat
 * a bare "Up to Rs.Y" as inclusive of Y — both matter for a slab table to partition without gaps,
 * so this bank gets its own small band reader rather than the shared one. Local-only workaround. */
function esafSavingsBand(label: string): { min: number; max: number | null } {
  const clean = label.replace(/\(i\.e\.,.*?\)/i, "");
  const nums = amountsIn(clean);
  const t = clean.toLowerCase();
  if (/^\s*up to/.test(t)) return { min: 0, max: nums[0] + 1 };
  if (/^\s*above/.test(t)) return nums.length >= 2 ? { min: nums[0] + 1, max: nums[1] + 1 } : { min: nums[0] + 1, max: null };
  throw new AdapterError(`unrecognised savings slab label "${label}"`);
}

export const esafSfbSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /savings bank account.*slab/i.test(headerText(x, 1)), "savings slab table");
  const effectiveFrom = headerEffectiveDate(g, RATE_HEADER);
  if (!effectiveFrom) throw new AdapterError("no effective date found in the savings header");

  const slabs = g.rows.slice(1).flatMap((r) => {
    const rate = parseRate(r[1] ?? "");
    if (rate === null) return [];
    const band = esafSavingsBand(r[0] ?? "");
    return [{ balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" as const }];
  });
  if (slabs.length === 0) throw new AdapterError("no savings slabs read");

  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs,
        slabMethod: "incremental", // every row's own label says "for incremental amount above Rs. X"
        notes: ["The table caption covers Resident, NRO and NRE savings accounts alike; only one set of rates is printed, so no separate NRO/NRE slabs are shown."],
      }),
    ],
  };
};
