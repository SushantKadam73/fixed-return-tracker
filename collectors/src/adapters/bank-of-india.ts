/**
 * Bank of India — bankofindia.bank.in (legacy: bankofindia.co.in)
 *
 * STATUS (2026-09-27 re-check): a plain `fetch`/curl still gets bankofindia.bank.in's Cloudflare
 * "Just a moment..." interstitial (and a bare 403 from the legacy bankofindia.co.in), so `format`
 * stays "browser" — unchanged. NEW this pass: a real, JS-executing headless-browser session
 * (i.e. exactly the kind of client `format: "browser"`/Playwright already provides on GitHub
 * Actions/VPS) reached the genuine bankofindia.bank.in page with no reCAPTCHA or other manual
 * challenge — Cloudflare's own JS check resolved on its own, landing on the real page (title
 * "Rupee Term Deposit Interest Rate for Domestic/NRO - BOI", 11 real tables). This adapter,
 * unchanged, was re-tested directly against that live table's markup (captured via the browser
 * session, not reconstructed) and produced 15 valid FD rows + 15 valid bulk rows, effective
 * 2026-05-18 — matching this file's original Wayback-built expectations row-for-row. Source
 * flipped to `active: true` on that evidence (data/sources/fragments/fixups.json). Two caveats,
 * both already handled safely by the existing "throw rather than guess" design: (1) Cloudflare's
 * bot-scoring is known to vary by requesting network/IP, so a GitHub Actions runner may still be
 * challenged even though this session wasn't — if so, `requireGrid` throws (no table on a
 * challenge page) and the source is reported as failing rather than silently mis-read; (2) the
 * live page now also carries THREE tables this adapter still does not read — a Senior Citizen
 * ladder mirroring the general-public one, a "Green Deposit Scheme (Harit Jama Yojana)" special
 * tenure, and expanded bulk tiers for ₹10-25cr and ₹25cr+ (with their own "MATURITY BUCKETS"
 * tables) — none of which were present in the 2025-07-09 archived snapshot this adapter was
 * originally built from. Left uncovered as a flagged gap for a follow-up pass, not a guess.
 *
 * This adapter was written and tested against a Wayback Machine snapshot of the bank's OWN page
 * (bankofindia.co.in/interest-rate/rupee-term-deposit-rate, captured 2025-07-09) — used only to
 * build/test the parser, per the brief, never as a live source; the live-browser re-test above
 * is what the "kept inactive until a browser-capable runner can confirm it" note (from the
 * previous pass) was waiting on. If the live table's structure changes again, this adapter will
 * throw (per the "never guess" rule) rather than mis-read it.
 *
 * Covers: one table with domestic/NRO term-deposit rates by tenor, in two columns — "for
 * deposits of less than Rs.3 Cr" (retail) and "for deposits of Rs.3 Cr & above but less than
 * Rs.10 Crs" (bulk) — both general-customer only (see the Senior Citizen gap noted above).
 */
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, headerEffectiveDate, headerText, makeCard, requireGrid } from "./helpers";

export const bankOfIndiaFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /maturity/i.test(headerText(x, 1)) && /less than rs\.?\s*3\s*cr/i.test(headerText(x, 1)), "domestic/NRO term deposit table");
  const effectiveFrom = headerEffectiveDate(g, /less than rs\.?\s*3\s*cr/i);
  if (!effectiveFrom) throw new AdapterError("effective date not found on Bank of India term deposit table");

  const retail = parseTermTable(g, {
    columns: [{ header: /less than rs\.?\s*3\s*cr/i, customer: "general" }],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
    schemeNames: { 450: "Star Vaibhav" },
  });
  const bulk = parseTermTable(g, {
    columns: [{ header: /rs\.?\s*3\s*cr\s*&?\s*above/i, customer: "general" }],
    amountMin: 3 * CRORE,
    amountMax: 10 * CRORE,
    callable: true,
    schemeNames: { 450: "Star Vaibhav" },
  });

  const fd = makeCard(ctx, "fd", retail, {
    effectiveFrom,
    notes: ["Only the general-public rate is published: the archived copy this adapter was built against referenced separate SENIOR CITIZEN / ADDITIONAL RATE / PENALTY DETAILS tabs whose content was not present as static HTML."],
  });
  const bulkCard = makeCard(ctx, "fd_bulk", bulk, { effectiveFrom });
  return { cards: [fd, bulkCard] };
};
