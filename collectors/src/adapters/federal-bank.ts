/**
 * Federal Bank — federal.bank.in
 *
 * BLOCKING IS CLIENT-DEPENDENT, NOT ABSOLUTE: a plain `curl` (even with a full browser
 * User-Agent and matching Accept/Accept-Language headers) reliably gets a Radware/ShieldSquare
 * "Captcha Page" (HTTP 200, validate.perfdrive.com challenge) from every www.federal.bank.in
 * page. But this project's own `fetchDoc` (Node's `fetch`/undici, same headers) reached the
 * REAL page repeatedly while this adapter was built and tested (fixtures below are genuine
 * trims of that live response, not reconstructed) — most likely Radware is fingerprinting the
 * TLS/HTTP client itself (e.g. JA3/HTTP2 signature), which differs between curl and undici
 * even with identical headers. Bottom line for future maintainers: if you're diagnosing a
 * "Federal Bank is blocked" report, re-test with `collectors/src/fetch.ts`'s own client (e.g.
 * `try-adapter.ts`) before concluding the site is unreachable — a curl-based check can lie.
 *
 * Federal's PDF document repository (/documents/10180/...) is only PARTLY outside the bot
 * manager: an FCNR rates PDF under folder id "0" fetched cleanly, but the bulk (≥₹3cr) "HVD Web
 * Interest" PDF's real `<a href>` (present in the fetched HTML, e.g.
 * ".../documents/10180/124103/HVD-+Web+Interest+24.09.2026.pdf/<hash>?version=1.0&t=...") sits
 * under a different folder id and, when fetched with this same project's `fetchDoc`, comes back
 * as Radware's own block page rather than a PDF — confirmed while building this adapter. So the
 * link IS discoverable, just not fetchable from here right now; no bulk card is produced. A gap
 * to retry from GitHub Actions/VPS, not a guess (see notes in data/sources/fragments/b2.json).
 *
 * Federal states outright that its Resident Term Deposit table also prices Recurring Deposits
 * ("Resident Term Deposits interest rates are also applicable to ... Federal Savings Fund
 * [=RD] ... and NRO Fixed Deposits"), so RD is derived from the FD card via `deriveRdFromFd`
 * rather than read from a separate table.
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, parseDate } from "../parse/common";
import { parseAmountBand } from "../parse/amount";
import { extractTables } from "../parse/html-table";
import { parseTermTable } from "../parse/term-table";
import type { Adapter } from "../types";
import { AdapterError, CRORE, deriveRdFromFd, headerText, makeCard, requireGrid } from "./helpers";

const GENERAL = /general public/i;
const SENIOR = /senior citizen/i;

export const federalFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);

  const retail = requireGrid(grids, (g) => GENERAL.test(headerText(g, 1)) && /less than.*300 lakhs/i.test(headerText(g, 1)), "Resident Term Deposit table");
  const effectiveFrom = dateFromContext(retail.context);
  const rows: RateRow[] = parseTermTable(retail, {
    columns: [
      { header: GENERAL, customer: "general" },
      { header: SENIOR, customer: "senior" },
    ],
    amountMin: 0,
    amountMax: 3 * CRORE,
    callable: true,
  });

  // This table's header spans 3 rows ("Period" / "Rates of Interest (Deposit Less than ₹3 Cr)"
  // x2 (colspan) / "General Public", "Senior Citizen*"), so the identifying text only shows up
  // once at least 2 header rows are joined.
  const depositPlus = grids.find((g) => /deposit less than.*3 cr/i.test(headerText(g, 3)));
  if (depositPlus) {
    rows.push(
      ...parseTermTable(depositPlus, {
        columns: [
          { header: GENERAL, customer: "general" },
          { header: SENIOR, customer: "senior" },
        ],
        amountMin: 1_00_00_001,
        amountMax: 3 * CRORE,
        callable: false,
      }),
    );
  }

  if (!effectiveFrom) throw new AdapterError("effective date not found for the Resident Term Deposit table");
  const fd = makeCard(ctx, "fd", rows, {
    effectiveFrom,
    notes: depositPlus ? [] : ["'Deposit Plus' (non-callable) table not found on the page — only the callable Resident Term Deposit rows are included."],
  });
  const rd = deriveRdFromFd(fd, "Resident Term Deposits interest rates are also applicable to Resident Cash Certificate, Federal Savings Fund, Federal Tax Savings Deposits and NRO Fixed Deposits.", 365);
  return {
    cards: [fd, rd],
    terms: [{ product: "fd", seniorPremium: "+0.50pp flat on nearly every tenure (bank's own column)", prematurePenalty: "1% flat, for deposits opened/renewed on/after 21 October 2022, both below and at/above ₹3 crore" }],
  };
};

export const federalSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, (x) => /end of the day balance/i.test(headerText(x, 1)), "savings slab table");
  const effectiveFrom = dateFromContext(g.context);
  if (!effectiveFrom) throw new AdapterError("effective date not found for the savings table");

  const slabs: SavingsSlab[] = [];
  const skipped: string[] = [];
  for (const row of g.rows.slice(1)) {
    const label = cleanText(row[1] ?? "");
    const rateText = cleanText(row[2] ?? "");
    if (!label || !rateText) continue;
    const outer = parseAmountBand(label);
    if (!outer) throw new AdapterError(`cannot read savings slab band "${label}"`);
    const nested = reconcileNestedRates(outer.min, outer.max, rateText);
    if (nested) {
      slabs.push(...nested.map((n) => ({ ...n, residency: "resident" as const })));
      continue;
    }
    // Only treat this as one flat rate when the text doesn't ALSO contain "for balance ..."
    // sub-clause language — otherwise a rejected nested slab (see reconcileNestedRates) would
    // fall through and get misread as its own first sub-clause's rate applying to the whole band.
    const flat = !/for balance/i.test(rateText) && /^([\d.]+)\s*%/.exec(rateText);
    if (flat) {
      slabs.push({ balanceMin: outer.min, balanceMax: outer.max, rate: Number(flat[1]), residency: "resident" });
      continue;
    }
    skipped.push(label);
  }
  if (slabs.length === 0) throw new AdapterError("no savings slabs could be read");
  return {
    cards: [
      makeCard(ctx, "savings", [], {
        effectiveFrom,
        savingsSlabs: slabs.sort((a, b) => a.balanceMin - b.balanceMin),
        slabMethod: "unknown",
        notes:
          skipped.length > 0
            ? [`Slab(s) skipped rather than guessed because their published sub-rates don't reconcile with the slab's own balance range (the bank's own page repeats a "for balance less than ₹10Cr" sub-clause inside this slab even though the slab itself starts at ₹50Cr — looks like a copy-paste leftover on the bank's site, not a fetch/parsing issue on our side): ${skipped.join(", ")}.`]
            : undefined,
      }),
    ],
  };
};

/** Some slabs are one flat rate; others give several "X% for balance less than/of Y (to less
 * than Z)" sub-clauses nested inside one slab. Only trusted when the sub-clauses, taken in
 * order, exactly reconstruct the slab's own [outerMin, outerMax) — otherwise we don't know
 * which number is right, so nothing is guessed (see federalSavings above). */
function reconcileNestedRates(outerMin: number, outerMax: number | null, rateText: string): Array<{ balanceMin: number; balanceMax: number | null; rate: number }> | null {
  const found: Array<{ max: number; rate: number }> = [];
  for (const m of rateText.matchAll(/([\d.]+)%\s*for balance less than\s*₹?\s*([\d.]+)\s*cr/gi)) found.push({ max: Number(m[2]) * CRORE, rate: Number(m[1]) });
  for (const m of rateText.matchAll(/([\d.]+)%\s*for balance of\s*₹?\s*[\d.]+\s*cr\s*to less than\s*₹?\s*([\d.]+)\s*cr/gi)) found.push({ max: Number(m[2]) * CRORE, rate: Number(m[1]) });
  if (found.length === 0) return null;
  found.sort((a, b) => a.max - b.max);
  const out: Array<{ balanceMin: number; balanceMax: number | null; rate: number }> = [];
  let prev = outerMin;
  for (const f of found) {
    if (f.max <= prev) return null;
    out.push({ balanceMin: prev, balanceMax: f.max, rate: f.rate });
    prev = f.max;
  }
  if (outerMax !== null && prev !== outerMax) return null;
  return out;
}

/** The effective date is a lead-in sentence just before the table ("... effective from
 * 17-08-2026"), not part of the header row itself. */
function dateFromContext(context: string): string | null {
  const m = /effective from\s*([0-9]{1,2}[.\-][0-9]{1,2}[.\-][0-9]{2,4}|[0-9]{1,2}(?:st|nd|rd|th)?\s+[a-z]+\s+[0-9]{4})/i.exec(context);
  return m ? parseDate(m[1]) : null;
}
