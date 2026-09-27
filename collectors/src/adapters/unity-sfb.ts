/**
 * Unity Small Finance Bank — unity.bank.in
 * The bank keeps no single stable rate-card page: instead it republishes one dated
 * "website-disclosure-effective-DD-month-YYYY.pdf" bundling Retail FD (A), Savings (B),
 * Callable Bulk (C) and Non-Callable Bulk (D) deposit rates every time any of them change.
 * The filename itself changes on every revision, so:
 *  - The live adapters discover today's link from the stable FD product page
 *    (https://unity.bank.in/personal-banking/deposits/fixed-deposit), which always links the
 *    current disclosure PDF, then fetch and parse that PDF with `ctx.fetch`.
 *  - `unityHistory(ctx)` is a separate, best-effort backfill export: it starts from the two
 *    dated disclosure PDFs confirmed reachable in research (13 Apr 2026, 02 Jul 2026), adds
 *    any further "website-disclosure-effective-*.pdf" links it can find on `ctx.doc` or the
 *    FD page, fetches each with `ctx.fetch`, and returns every version it could read as
 *    bank_archive cards. A version it cannot fetch or parse is skipped with a warning, not a
 *    thrown error, so one bad link does not lose the others.
 *
 * Quirks:
 *  - Every table prints the exact point tenure "12 Months" at a materially better rate than
 *    the surrounding ranges (a genuine promotional rate), immediately followed by a line
 *    that reads "12 Months – 1 Day" with the SAME rate as the following ">12 Months 1 Day –
 *    500 Days" row. That "– 1 Day" line does not fit between the "12 Months" point and the
 *    ">12 Months 1 Day" range that already starts the very next line, and it duplicates that
 *    next line's rate exactly — we treat it as a PDF text-extraction duplicate and drop it
 *    (no rate information is lost: the following row already covers that span at the same
 *    rate).
 *  - Callable Bulk (C) prints only a "General" rate per amount band; the bank's own footnote
 *    says "Senior citizen to receive 50 bps more for callable bulk deposits" — we add the
 *    senior row as general+0.50 and quote that footnote, the same pattern `deriveRdFromFd`
 *    uses elsewhere for a bank-stated equivalence. Non-Callable Bulk (D) explicitly says
 *    "Non-callable deposits are not offered to senior citizen", so no senior row is added
 *    there.
 */
import type { CustomerType, Product, RateCard, RateRow, SavingsSlab } from "../../../lib/domain";
import { amountsIn } from "../parse/amount";
import { cleanText, parseDate } from "../parse/common";
import { parseTenure } from "../parse/tenure";
import type { Adapter, AdapterContext, FetchedDoc } from "../types";
import { AdapterError, CRORE, makeCard } from "./helpers";

const FD_PAGE_URL = "https://unity.bank.in/personal-banking/deposits/fixed-deposit";
const DISCLOSURE_LINK_RE = /href="([^"]*website-disclosure-effective-[^"]+\.pdf)"/gi;
/** Confirmed reachable in research; unityHistory always tries these plus anything it can discover live. */
const KNOWN_ARCHIVE_URLS = ["https://unity.bank.in/docs/policies/website-disclosure-effective-02-july-2026.pdf", "https://unity.bank.in/docs/policies/website-disclosure-effective-13-april-2026.pdf"];

const ROW2_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;
const ROW1_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%$/;
const ROW6_RE = /^(.+?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;
/** "12 Months – 1 Day" — see the module doc comment; a duplicate of the next row, dropped. */
const DUPLICATE_ARTIFACT_RE = /^\d+\s*months\s*[–—-]\s*1\s*days?$/i;

function section(text: string, startRe: RegExp, endRe: RegExp | null): string {
  const start = text.search(startRe);
  if (start < 0) throw new AdapterError(`section not found: ${startRe}`);
  const rest = text.slice(start);
  const end = endRe ? rest.search(endRe) : -1;
  return end < 0 ? rest : rest.slice(0, end);
}

function buildRow(label: string, rate: number, customer: CustomerType, amountMin: number, amountMax: number | null, callable: boolean): RateRow | null {
  if (DUPLICATE_ARTIFACT_RE.test(cleanText(label))) return null;
  const tenure = parseTenure(label);
  if (!tenure) throw new AdapterError(`cannot read tenure "${label}"`);
  return {
    tenureMinDays: tenure.minDays,
    tenureMaxDays: tenure.maxDays,
    tenureLabel: label,
    special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
    amountMin,
    amountMax,
    customer,
    residency: "resident",
    callable,
    payout: null,
    rate,
  };
}

interface Disclosure {
  fd: { effectiveFrom: string | null; rows: RateRow[] };
  savings: { effectiveFrom: string | null; slabs: SavingsSlab[] };
  callableBulk: { effectiveFrom: string | null; rows: RateRow[] };
  nonCallableBulk: { effectiveFrom: string | null; rows: RateRow[] };
}

function effectiveFromRevised(text: string): string | null {
  const m = /revised from\s+([^\n]+?)\s+as follows/i.exec(text);
  return m ? parseDate(m[1]) : null;
}

function effectiveFromWef(text: string): string | null {
  const m = /w\.?\s*e\.?\s*f\.?\s*([^\n]+)/i.exec(text);
  return m ? parseDate(m[1]) : null;
}

/** "Upto 1 lakh" / ">1 lakh-10 lakh" / ">10 lakh" (amountsIn() already applies the lakh/crore multiplier). */
function savingsBand(label: string): { min: number; max: number | null } {
  const t = cleanText(label);
  const nums = amountsIn(t);
  if (/^upto/i.test(t) && nums.length === 1) return { min: 0, max: nums[0] + 1 };
  if (/^>/.test(t) && nums.length === 2) return { min: nums[0] + 1, max: nums[1] + 1 };
  if (/^>/.test(t) && nums.length === 1) return { min: nums[0] + 1, max: null };
  throw new AdapterError(`cannot read savings slab "${label}"`);
}

function dedupeConsecutive(nums: number[]): number[] {
  return nums.filter((n, i) => i === 0 || n !== nums[i - 1]);
}

/**
 * amountsIn() strips a leading "Rs"/"₹"/"INR" currency prefix by deleting the literal
 * substring "rs" anywhere in the text — which also eats the "rs" inside this PDF's "crs"
 * abbreviation (Unity writes "Rs 5 crs", not "5 Cr"), turning "5 crs" into "5 c" and losing
 * the crore multiplier entirely. That is a shared-parser gap in collectors/src/parse/amount.ts
 * we work around locally here rather than editing the shared file: extract the crore
 * numbers ourselves and apply the ×1e7 multiplier by hand.
 */
function croreNumbers(text: string): number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*crs?\b/gi)].map((m) => Number(m[1]) * CRORE);
}

/** The 6 crore bands ("Rs 3 crs to <Rs 5 crs" ... "Rs 100 crs and Above") from the header text above the first data row. */
function bulkBands(headerText: string): Array<{ min: number; max: number | null }> {
  const thresholds = dedupeConsecutive(croreNumbers(headerText));
  if (thresholds.length < 2) throw new AdapterError(`cannot read the bulk amount bands from "${headerText}"`);
  const bands: Array<{ min: number; max: number | null }> = thresholds.slice(0, -1).map((min, i) => ({ min, max: thresholds[i + 1] }));
  bands.push({ min: thresholds[thresholds.length - 1], max: null });
  return bands;
}

/** Parse the one disclosure PDF's text into its four sections. */
function parseDisclosure(text: string): Disclosure {
  const a = section(text, /A\.\s*FIXED DEPOSIT RATE/i, /B\.\s*SAVING DEPOSIT RATE/i);
  const b = section(text, /B\.\s*SAVING DEPOSIT RATE/i, /C\.\s*CALLABLE BULK DEPOSIT RATES/i);
  const c = section(text, /C\.\s*CALLABLE BULK DEPOSIT RATES/i, /D\.\s*Non-Callable Bulk Deposit Rates/i);
  const d = section(text, /D\.\s*Non-Callable Bulk Deposit Rates/i, null);

  const fdRows: RateRow[] = [];
  for (const raw of a.split(/\n/)) {
    const line = cleanText(raw);
    const m = ROW2_RE.exec(line);
    if (!m) continue;
    const g = buildRow(m[1], Number(m[2]), "general", 0, 3 * CRORE, true);
    const s = buildRow(m[1], Number(m[3]), "senior", 0, 3 * CRORE, true);
    if (g) fdRows.push(g);
    if (s) fdRows.push(s);
  }

  const slabs: SavingsSlab[] = [];
  for (const raw of b.split(/\n/)) {
    const line = cleanText(raw);
    const m = ROW1_RE.exec(line);
    if (!m || /^amount/i.test(line)) continue;
    const band = savingsBand(m[1]);
    slabs.push({ balanceMin: band.min, balanceMax: band.max, rate: Number(m[2]), residency: "resident", note: m[1] });
  }

  function bulkRows(sectionText: string, callable: boolean, addSeniorPremium: number | null): RateRow[] {
    const lines = sectionText.split(/\n/).map(cleanText);
    // Collect ONLY the column-band header lines (starting at "Tenure ..."), not the whole
    // section — the section also contains the "w.e.f ..." heading and footnote numbers,
    // which would otherwise pollute the amount-band numbers we read out of the header.
    const tenureIdx = lines.findIndex((l) => /^tenure\b/i.test(l));
    if (tenureIdx < 0) throw new AdapterError('no "Tenure" column header found in a bulk-deposit section');
    const headerLines: string[] = [];
    let bodyStart = lines.length;
    for (let i = tenureIdx; i < lines.length; i++) {
      if (ROW6_RE.test(lines[i])) {
        bodyStart = i;
        break;
      }
      headerLines.push(lines[i]);
    }
    const bands = bulkBands(headerLines.join(" "));
    const rows: RateRow[] = [];
    for (const line of lines.slice(bodyStart)) {
      const m = ROW6_RE.exec(line);
      if (!m) continue;
      for (let i = 0; i < bands.length && i < 6; i++) {
        const rate = Number(m[2 + i]);
        const g = buildRow(m[1], rate, "general", bands[i].min, bands[i].max, callable);
        if (g) rows.push(g);
        if (addSeniorPremium !== null) {
          const s = buildRow(m[1], rate + addSeniorPremium, "senior", bands[i].min, bands[i].max, callable);
          if (s) rows.push(s);
        }
      }
    }
    return rows;
  }

  return {
    fd: { effectiveFrom: effectiveFromRevised(a), rows: fdRows },
    savings: { effectiveFrom: effectiveFromRevised(b), slabs },
    callableBulk: { effectiveFrom: effectiveFromWef(c.split(/\n/)[0] ?? ""), rows: bulkRows(c, true, 0.5) },
    nonCallableBulk: { effectiveFrom: effectiveFromWef(d.split(/\n/)[0] ?? ""), rows: bulkRows(d, false, null) },
  };
}

async function discoverCurrentDisclosureUrl(ctx: AdapterContext): Promise<string> {
  const m = DISCLOSURE_LINK_RE.exec(ctx.doc.text);
  DISCLOSURE_LINK_RE.lastIndex = 0;
  if (!m) throw new AdapterError(`could not find a "website-disclosure-effective-*.pdf" link on ${ctx.doc.finalUrl || ctx.source.url}`);
  return new URL(m[1], ctx.doc.finalUrl || FD_PAGE_URL).toString();
}

async function fetchDisclosure(ctx: AdapterContext): Promise<{ doc: FetchedDoc; disclosure: Disclosure }> {
  const url = await discoverCurrentDisclosureUrl(ctx);
  const doc = await ctx.fetch(url, "pdf");
  return { doc, disclosure: parseDisclosure(doc.text) };
}

export const unityFd: Adapter = async (ctx) => {
  const { doc, disclosure } = await fetchDisclosure(ctx);
  if (!disclosure.fd.effectiveFrom) throw new AdapterError("effective date not found in the FD section of the disclosure PDF");
  if (disclosure.fd.rows.length === 0) throw new AdapterError("no FD rows parsed from the disclosure PDF");
  const card = makeCard(ctx, "fd", disclosure.fd.rows, { effectiveFrom: disclosure.fd.effectiveFrom, sourceUrl: doc.finalUrl, notes: ["Link to this dated disclosure PDF was discovered from the FD product page, which the bank keeps pointed at its current disclosure."] });
  return { cards: [card], terms: [{ product: "fd", bulkThreshold: 3 * CRORE, seniorPremium: "+0.50% flat, all tenures (not applicable to NRE/NRO)", prematurePenalty: "1% of the rate for the period the deposit has remained with the bank" }] };
};

export const unitySavings: Adapter = async (ctx) => {
  const { doc, disclosure } = await fetchDisclosure(ctx);
  if (!disclosure.savings.effectiveFrom) throw new AdapterError("effective date not found in the Savings section of the disclosure PDF");
  if (disclosure.savings.slabs.length === 0) throw new AdapterError("no savings slabs parsed from the disclosure PDF");
  return {
    cards: [makeCard(ctx, "savings", [], { effectiveFrom: disclosure.savings.effectiveFrom, sourceUrl: doc.finalUrl, savingsSlabs: disclosure.savings.slabs, slabMethod: "unknown", notes: ["The disclosure PDF gives per-slab rates but does not say whether each slab applies to the whole balance or only the incremental portion — recorded as 'unknown', not guessed."] })],
  };
};

export const unityBulk: Adapter = async (ctx) => {
  const { doc, disclosure } = await fetchDisclosure(ctx);
  const effectiveFrom = disclosure.callableBulk.effectiveFrom ?? disclosure.nonCallableBulk.effectiveFrom;
  if (!effectiveFrom) throw new AdapterError("effective date not found in the bulk-deposit sections of the disclosure PDF");
  const rows = [...disclosure.callableBulk.rows, ...disclosure.nonCallableBulk.rows];
  if (rows.length === 0) throw new AdapterError("no bulk-deposit rows parsed from the disclosure PDF");
  const notes = [
    'Callable-bulk senior rate is not printed as a number: derived as general+0.50% because the bank states "Senior citizen to receive 50 bps more for callable bulk deposits".',
    "Non-callable bulk has no senior rate: the bank states non-callable deposits are not offered to senior citizens.",
  ];
  return {
    cards: [makeCard(ctx, "fd_bulk", rows, { effectiveFrom, sourceUrl: doc.finalUrl, notes })],
    terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, prematurePenalty: "Not permitted except bankruptcy/winding-up, court/regulator direction, or an operational error approved by Head Financial Markets & CRO (at 1% below the rate for the period held)" }],
  };
};

/** Turn one already-fetched disclosure document into its bank_archive cards. */
function archiveCards(bankSlug: string, doc: FetchedDoc, today: string): RateCard[] {
  const d = parseDisclosure(doc.text);
  const cards: RateCard[] = [];
  const push = (product: Product, effectiveFrom: string | null, rows: RateRow[], savingsSlabs?: SavingsSlab[], slabMethod?: RateCard["slabMethod"], notes?: string[]) => {
    if (!effectiveFrom || (rows.length === 0 && (!savingsSlabs || savingsSlabs.length === 0))) return;
    cards.push({ bankSlug, product, effectiveFrom, observedAt: today, sourceType: "bank_archive", sourceUrl: doc.finalUrl, confidence: "high", rows, savingsSlabs, slabMethod, notes: [...(notes ?? []), `From ${doc.finalUrl}.`] });
  };
  push("fd", d.fd.effectiveFrom, d.fd.rows);
  push("savings", d.savings.effectiveFrom, [], d.savings.slabs, "unknown");
  push("fd_bulk", d.callableBulk.effectiveFrom ?? d.nonCallableBulk.effectiveFrom, [...d.callableBulk.rows, ...d.nonCallableBulk.rows]);
  return cards;
}

export const unityHistory: Adapter = async (ctx) => {
  const links = new Set<string>(KNOWN_ARCHIVE_URLS);
  for (const text of [ctx.doc.text]) {
    let m: RegExpExecArray | null;
    const re = new RegExp(DISCLOSURE_LINK_RE);
    while ((m = re.exec(text))) links.add(new URL(m[1], ctx.doc.finalUrl || FD_PAGE_URL).toString());
  }
  // Also try the stable FD page itself, in case ctx was pointed at something else.
  try {
    const fdPage = await ctx.fetch(FD_PAGE_URL, "html");
    let m: RegExpExecArray | null;
    const re = new RegExp(DISCLOSURE_LINK_RE);
    while ((m = re.exec(fdPage.text))) links.add(new URL(m[1], fdPage.finalUrl || FD_PAGE_URL).toString());
  } catch {
    // best-effort only
  }

  const cards: RateCard[] = [];
  const warnings: string[] = [];
  for (const url of links) {
    try {
      const doc = await ctx.fetch(url, "pdf");
      const found = archiveCards(ctx.source.bankSlug, doc, ctx.today);
      if (found.length === 0) warnings.push(`no cards recovered from ${url}`);
      cards.push(...found);
    } catch (e) {
      warnings.push(`could not read ${url}: ${(e as Error).message}`);
    }
  }
  if (cards.length === 0) throw new AdapterError("no historical disclosure PDFs could be read");
  return { cards, warnings };
};
