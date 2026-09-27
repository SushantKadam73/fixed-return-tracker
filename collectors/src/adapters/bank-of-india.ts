/**
 * Bank of India — bankofindia.bank.in (legacy: bankofindia.co.in)
 *
 * STATUS: both domains return HTTP 403 to every automated client tried in this pass — plain
 * `fetch` gets a bare 403 on bankofindia.co.in (including the homepage, not just the rate
 * path), and bankofindia.bank.in additionally serves a Cloudflare "Just a moment... checking
 * your browser" interstitial. This was re-confirmed live on 2026-09-27 (both domains, browser
 * User-Agent, two attempts each) and independently by fetching the same URL through Exa's own
 * web crawler, which received the identical Cloudflare challenge page rather than the real
 * site. No genuine live HTML could be obtained, so the source in `data/sources/fragments/a2.json`
 * is registered `active: false, format: "browser"` rather than guessing at a layout.
 *
 * This adapter exists ONLY to be ready for the day a browser-capable runner (GitHub Actions
 * with Playwright, or a VPS) can render the page and hand this adapter real HTML. It was
 * written and tested against a Wayback Machine snapshot of the bank's OWN page
 * (bankofindia.co.in/interest-rate/rupee-term-deposit-rate, captured 2025-07-09) — used only to
 * build/test the parser, per the brief, never as a live source. If the live table's structure
 * has since changed, this adapter will throw (per the "never guess" rule) rather than mis-read it.
 *
 * Covers: one table with domestic/NRO term-deposit rates by tenor, in two columns — "for
 * deposits of less than Rs.3 Cr" (retail) and "for deposits of Rs.3 Cr & above but less than
 * Rs.10 Crs" (bulk) — both general-customer only. The archived page also references separate
 * "SENIOR CITIZEN" / "ADDITIONAL RATE" / "PENALTY DETAILS" tabs (a Liferay tabbed fragment)
 * whose content was not present as static HTML in the archived copy, so this adapter does not
 * read senior-citizen rates; only the general-public rows are published.
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
