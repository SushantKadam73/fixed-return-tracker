/**
 * Indian Bank — indianbank.bank.in
 *
 * URL: the legacy www.indianbank.in domain 502s on every path (decommissioned, per the RBI
 * .bank.in migration, deadline 31 Oct 2025). On indianbank.bank.in itself, the page's OWN old
 * path ("/departments/deposit-rates/") no longer resolves directly (302s to
 * "/en/departments/deposit-rates/", which then 502s — a dead end); the current canonical page is
 * "https://indianbank.bank.in/en/deposit-rates" (confirmed via a real browser session landing
 * there, and via an Internet Archive `id_` snapshot of exactly that URL dated 2026-09-17, title
 * "Deposit Rates - Maximize Your Savings - Indian Bank" matching this page's own h2).
 *
 * Reachability: this exact URL is behind an F5 BIG-IP ("TSPD"/"TS" cookie) bot-defense layer.
 * Plain HTTP from this sandbox (curl and this project's own fetchDoc, with or without a
 * same-origin Referer header, and with a full realistic browser header set) always gets either a
 * flat 502 or a small obfuscated-JS "challenge" page — never the real table markup — so `format`
 * is set to "browser" here rather than "html". A real headless browser session did reach the
 * genuine page during this review (and Internet Archive's own crawler reached it too), so the
 * challenge is solvable by a real browser/JS engine, matching the Playwright path GitHub
 * Actions/VPS runs use for `format: "browser"` sources.
 *
 * The fixture (deposit_rates.html) was captured live on 2026-09-27; its retail-table date
 * (04.08.2026) and savings-table date (04.07.2026) independently match the Internet Archive
 * snapshot exactly, cross-confirming it is genuine. Its bulk-table date (25.09.2026) postdates
 * that Archive snapshot (which shows an earlier 01.04.2026 bulk revision) by 10 days — plausible
 * on its own (bulk/wholesale rates move far more often than retail) and consistent with this same
 * group's other banks also revising bulk rates around 25-26 Sept 2026 (Canara: 2026-09-25,
 * Bank of Baroda: 2026-09-26) — but, unlike those two, could not be independently re-confirmed
 * against a second live source from this sandbox; flagged in the source notes.
 *
 * One page ("Deposit Rates") carries the retail <3cr table (23 tenor rows, General Public
 * only — see below), four named special tenures with their own small breakdown tables (IND
 * Supreme 2.0/300d, IND Green/500d, IND Grow/555d, IND Prosper/777d), the ₹3-5cr bulk table
 * (callable + non-callable), the 4-slab savings table, and foreclosure/senior-citizen rules as
 * plain text.
 *
 * No RD adapter: the page's senior-citizen rule text says the same +0.50% senior addition
 * "similarly" applies to Recurring Deposit accounts for a 6-120 month band — evidence RD has its
 * own card, not evidence that its base rate equals the FD card rate — and no RD rate table or an
 * explicit "RD = FD" statement appears anywhere on the page. So, per collectors/README.md, RD
 * stays uncovered here rather than derived.
 *
 * tax_saver: the page's own "IMPORTANT" notes state "The rate of interest on domestic term
 * deposit is also applicable to IB Tax Saver Scheme and Capital Gains Scheme Type B (Term
 * Deposits) 1988 Scheme" — an explicit rate-parity statement, not a separately-published
 * tax-saver table (the bank does not have one on this page). `indianBankTaxSaver` derives a
 * card from the retail table's own dedicated "5 year" row — the exact point tenure the Section
 * 80C tax-saver scheme's 5-year lock-in uses (not the "3 years to less than 5 years" or "Above 5
 * years" ranges either side of it, which are different, ordinary FD bands). No senior-citizen
 * figure exists for that exact tenure on this page (only the four named schemes get their own
 * Senior/Super-Senior rows), so the derived card is General-Public-only, correctly reflecting
 * "not published" rather than guessing a premium. `amountMax` is left null rather than kept at
 * the retail table's own "<₹3 crore" band: a tax-saver deposit is capped at ₹1,50,000 per
 * PAN per financial year by law, so the bank's deposit-amount band doesn't describe it (same
 * reasoning bank-of-baroda.ts's own tax_saver adapter uses for its amount band). The Capital
 * Gains Scheme named in the same sentence is a different product (no `tax_saver`-shaped output
 * for it) and is not represented here.
 *
 * No senior-citizen rows on the main retail table: it only has "Existing"/"Revised" columns
 * (both General Public), with the senior-citizen premium (+0.50%, capped at ₹100 crore per
 * customer, tenor 7 days–10 years, not on bulk deposits) stated as text, not a column — so,
 * as with bank-of-maharashtra.ts, this adapter does not invent a per-row senior number and
 * only emits `customer: "general"` from that table, putting the rule in `terms.seniorPremium`.
 *
 * The four named schemes DO print Public/Senior/Super Senior numbers, but only in their own
 * separate small tables — except IND Supreme 2.0, whose own breakdown table on this page has a
 * heading and no rows at all (a genuine gap in the bank's page, not a parsing issue: confirmed
 * against the raw fixture). So IND Supreme 2.0 is General-Public-only here; the other three
 * get all three customer rows. Each named scheme's day count is ALSO printed as a plain row in
 * the main retail table (e.g. "IND Supreme 2.0(300 days)") for the General Public rate, which
 * this adapter reads instead of duplicating — cross-checked to match the small tables' own
 * "Public" row where both exist.
 *
 * Shared-parser workaround (not a shared-file edit): a plain-text day count in parentheses
 * right after a scheme name, e.g. "IND Supreme 2.0(300 days)", defeats `parseTenure` the same
 * way Bank of Baroda's named schemes did (it strips "(...)" content, which here is the only
 * place the day count appears) — this adapter reads the day count with its own regex on the
 * original label instead of calling `parseTenure` on it.
 *
 * Bulk table's effective date ("w.e.f 25.09.2026") sits in a plain paragraph just before the
 * table, wrapped in its own single-cell table purely for layout. `extractTables`'s
 * `precedingContext` walk skips any preceding sibling that itself contains a `<table>` (on the
 * assumption it's more table data, not a caption) — reasonable in general, but it means that
 * paragraph never reaches this table's `context`. This adapter reads the date from the page's
 * plain text instead (searching for the heading phrase that names this specific table, not
 * "the latest date anywhere on the page").
 */
import type { RateRow, SavingsSlab } from "../../../lib/domain";
import { cleanText, findEffectiveDate, parseDate, parseRate } from "../parse/common";
import { extractTables, pageText, type Grid } from "../parse/html-table";
import { parseAmountBand } from "../parse/amount";
import { parseTenure } from "../parse/tenure";
import type { Adapter } from "../types";
import { AdapterError, CRORE, makeCard, requireGrid } from "./helpers";

const NAMED_SCHEMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ind supreme/i, "IND Supreme 2.0"],
  [/ind\s*green/i, "IND Green"],
  [/ind\s*grow/i, "IND Grow"],
  // The bank spells this "Prosper" in the main table's row label but "Proposer" in its own
  // small breakdown table's heading — both are read as the same scheme.
  [/ind\s*(prosper|proposer)/i, "IND Prosper"],
];

function namedSchemeName(label: string): string | undefined {
  return NAMED_SCHEMES.find(([re]) => re.test(label))?.[1];
}

/** "IND Supreme 2.0(300 days)" — `parseTenure` would strip the "(...)" and lose the only digits. */
function namedSchemeDays(label: string): number | null {
  const m = /\((\d+)\s*days?\)/i.exec(label);
  return m ? Number(m[1]) : null;
}

const isRetail = (g: Grid) => (g.rows[0] ?? []).some((c) => /domestic retail term deposits/i.test(c));
const isBulk = (g: Grid) => /bulk term deposits/i.test(g.context);
const isSavings = (g: Grid) => /balance \(rs\.\)/i.test(g.rows[0]?.[0] ?? "");
const namedSchemeTable = (re: RegExp) => (g: Grid) => re.test(g.rows[0]?.[0] ?? "") && (g.rows[1] ?? [])[0] === "Category";

function retailRows(g: Grid): RateRow[] {
  const revisedIdx = (g.rows[2] ?? []).findIndex((h) => /revised/i.test(h));
  if (revisedIdx < 0) throw new AdapterError(`indian-bank: no "Revised Rate" column in retail headers "${(g.rows[2] ?? []).join(" | ")}"`);
  const rows: RateRow[] = [];
  for (const row of g.rows.slice(4)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const rate = parseRate(row[revisedIdx] ?? "");
    if (rate === null) continue;
    const schemeName = namedSchemeName(label);
    const days = namedSchemeDays(label);
    const tenure = days !== null ? { minDays: days, maxDays: days, point: true } : parseTenure(label);
    if (!tenure) throw new AdapterError(`indian-bank: cannot read retail tenure "${label}"`);
    rows.push({
      tenureMinDays: tenure.minDays,
      tenureMaxDays: tenure.maxDays,
      tenureLabel: label,
      special: schemeName ? true : tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
      schemeName,
      amountMin: 0,
      amountMax: 3 * CRORE,
      customer: "general",
      residency: "resident",
      callable: true,
      payout: null,
      rate,
    });
  }
  if (rows.length === 0) throw new AdapterError("indian-bank: retail table produced no rows");
  return rows;
}

/** Public/Senior/Super Senior rows for a named scheme's own small table — Senior/Super Senior only, since General Public is already read off the main retail table row (see file header note). */
function namedSchemeSeniorRows(g: Grid, schemeName: string, days: number): { rows: RateRow[]; effectiveFrom: string | null } {
  const effectiveFrom = parseDate(g.rows[1]?.[1] ?? "");
  const rows: RateRow[] = [];
  for (const row of g.rows.slice(2)) {
    const category = cleanText(row[0] ?? "");
    const rate = parseRate(row[1] ?? "");
    if (rate === null) continue;
    const customer = /super senior/i.test(category) ? "super_senior" : /senior/i.test(category) ? "senior" : null;
    if (!customer) continue; // skip the "Public" row: already covered by the main retail table
    rows.push({ tenureMinDays: days, tenureMaxDays: days, tenureLabel: `${schemeName} (${days} days)`, special: true, schemeName, amountMin: 0, amountMax: 3 * CRORE, customer, residency: "resident", callable: true, payout: null, rate });
  }
  return { rows, effectiveFrom };
}

export const indianBankFd: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, isRetail, "retail <3cr table");
  const effectiveFrom = parseDate(retail.rows[2]?.[2] ?? "");
  if (!effectiveFrom) throw new AdapterError("indian-bank: retail effective date not found");

  const rows = retailRows(retail);
  const notes: string[] = [
    "General Public only: the bank prints senior-citizen and named-scheme premiums as text rules (+0.50%, capped at ₹100 crore per customer), not as numbered columns on the retail table, except where a scheme has its own Public/Senior/Super Senior table (IND Green, IND Grow, IND Prosper — added below). IND Supreme 2.0's own breakdown table on the bank's page has a heading but no rows, so it stays General-Public-only.",
  ];

  const schemeTables: Array<{ name: string; days: number; match: RegExp }> = [
    { name: "IND Green", days: 500, match: /ind\s*green/i },
    { name: "IND Grow", days: 555, match: /ind\s*grow/i },
    { name: "IND Prosper", days: 777, match: /ind\s*(prosper|proposer)/i },
  ];
  for (const s of schemeTables) {
    const g = grids.find(namedSchemeTable(s.match));
    if (!g) throw new AdapterError(`indian-bank: ${s.name} breakdown table not found`);
    const { rows: seniorRows, effectiveFrom: schemeDate } = namedSchemeSeniorRows(g, s.name, s.days);
    rows.push(...seniorRows);
    if (schemeDate && schemeDate !== effectiveFrom) notes.push(`${s.name}'s own table is dated w.e.f. ${schemeDate}, printed separately from the main retail table's date (${effectiveFrom}).`);
  }

  const fd = makeCard(ctx, "fd", rows, { effectiveFrom, notes });
  return {
    cards: [fd],
    terms: [
      {
        product: "fd",
        bulkThreshold: 3 * CRORE,
        seniorPremium: "+0.50% p.a., tenor 7 days to 10 years, capped at ₹100 crore of term-deposit balance per customer (CIF level); not applicable to bulk deposits (≥₹3cr) or Capital Gains Scheme deposits",
        superSeniorPremium: "+0.25% over senior-citizen rate ('IB Golden Ager', age 80+) across all maturities; a separate offer adds a further +0.25% specifically for the 5-10 year bucket, age 60+",
        prematurePenalty: "No penalty if held ≥181 days (card rate for the period actually run); if <181 days, card rate for the period run less 1.00% p.a.; no interest at all if closed before 7 days",
      },
    ],
  };
};

export const indianBankBulk: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, isBulk, "bulk ₹3-5cr table");
  // [\s\S]{0,80}? (not "[^.]*?") because "Rs.3 Cr" / "Rs.5 Cr" between the heading and "w.e.f"
  // contain periods of their own, which would otherwise stop the match short.
  const m = /revision of interest rates for bulk term deposits[\s\S]{0,80}?w\.?\s?e\.?\s?f\.?\s*([\d.\/-]+)/i.exec(pageText(ctx.doc.text));
  const effectiveFrom = m ? parseDate(m[1]) : null;

  const rows: RateRow[] = [];
  for (const row of g.rows.slice(2)) {
    const label = cleanText(row[0] ?? "");
    if (!label) continue;
    const tenure = parseTenure(label);
    if (!tenure) throw new AdapterError(`indian-bank: cannot read bulk tenure "${label}"`);
    ([
      ["callable", true, 1],
      ["non-callable", false, 2],
    ] as const).forEach(([, callable, idx]) => {
      const rate = parseRate(row[idx] ?? "");
      if (rate === null) return;
      rows.push({
        tenureMinDays: tenure.minDays,
        tenureMaxDays: tenure.maxDays,
        tenureLabel: label,
        special: tenure.point && tenure.minDays % 365 !== 0 ? true : undefined,
        amountMin: 3 * CRORE,
        amountMax: 5 * CRORE,
        customer: "general",
        residency: "resident",
        callable,
        payout: null,
        rate,
      });
    });
  }
  if (rows.length === 0) throw new AdapterError("indian-bank: bulk table produced no rows");

  const bulk = makeCard(ctx, "fd_bulk", rows, {
    effectiveFrom,
    notes: ["Only ₹3-5 crore is posted; above ₹5 crore needs Treasury Branch approval with no published rate (per the bank's page)."],
  });
  return { cards: [bulk], terms: [{ product: "fd_bulk", bulkThreshold: 3 * CRORE, maxAmount: 5 * CRORE }] };
};

export const indianBankSavings: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const g = requireGrid(grids, isSavings, "savings slab table");
  const effectiveFrom = findEffectiveDate(g.context);
  if (!effectiveFrom) throw new AdapterError("indian-bank: savings effective date not found");

  const slabs: SavingsSlab[] = g.rows.slice(1).map((r) => {
    const label = cleanText(r[0] ?? "");
    const rate = parseRate(r[1] ?? "");
    if (rate === null) throw new AdapterError(`indian-bank: cannot read savings rate for slab "${label}"`);
    const band = parseAmountBand(label);
    if (!band) throw new AdapterError(`indian-bank: cannot read savings balance slab "${label}"`);
    return { balanceMin: band.min, balanceMax: band.max, rate, residency: "resident" };
  });
  if (slabs.length === 0) throw new AdapterError("indian-bank: no savings slabs found");
  return {
    cards: [makeCard(ctx, "savings", [], { effectiveFrom, savingsSlabs: slabs, slabMethod: "unknown", notes: ["Credited quarterly (last day of June, September, December, March), per the bank's page."] })],
  };
};

/** The page's own statement tying the tax-saver scheme's rate to the domestic term-deposit
 * card (see file header) — checked so this card throws instead of silently guessing if the
 * bank ever removes or reword this note. */
const TAX_SAVER_STATEMENT = /rate of interest on domestic term deposit is also applicable to\s+ib tax saver scheme/i;
const TAX_SAVER_DAYS = 5 * 365; // Section 80C 5-year lock-in — matches the retail table's own "5 year" point-tenure row.

/** tax_saver: derived from the retail FD table's "5 year" row (see file header) — not read from
 * a separately-published tax-saver table, because the bank does not have one on this page. */
export const indianBankTaxSaver: Adapter = async (ctx) => {
  const grids = extractTables(ctx.doc.text);
  const retail = requireGrid(grids, isRetail, "retail <3cr table");
  const effectiveFrom = parseDate(retail.rows[2]?.[2] ?? "");
  if (!effectiveFrom) throw new AdapterError("indian-bank: retail effective date not found");

  if (!TAX_SAVER_STATEMENT.test(pageText(ctx.doc.text))) {
    throw new AdapterError('indian-bank: the page no longer states that the domestic term-deposit rate also applies to the IB Tax Saver Scheme');
  }

  const rows = retailRows(retail)
    .filter((r) => r.tenureMinDays === TAX_SAVER_DAYS && r.tenureMaxDays === TAX_SAVER_DAYS && !r.schemeName)
    // Amount band left null (not the retail table's own "<₹3 crore"): a tax-saver deposit is
    // capped at ₹1,50,000 per PAN per financial year by law, not by a bank-stated deposit band.
    .map((r) => ({ ...r, amountMin: 0, amountMax: null }));
  if (rows.length === 0) throw new AdapterError('indian-bank: no 5-year point-tenure row found on the retail table to derive the tax-saver rate from');

  return {
    cards: [
      makeCard(ctx, "tax_saver", rows, {
        effectiveFrom,
        notes: [
          'Bank\'s own page: "The rate of interest on domestic term deposit is also applicable to IB Tax Saver Scheme and Capital Gains Scheme Type B (Term Deposits) 1988 Scheme." Derived from the FD card\'s 5-year ("5 year") row — the tenure the tax-saver scheme (Section 80C, 5-year lock-in) actually uses — not from a separately-published tax-saver table.',
          "No senior-citizen figure is published for this exact tenure (only the four named schemes elsewhere on this page get their own Senior/Super-Senior rows), so this card is General-Public-only rather than a guessed premium.",
          "The Capital Gains Scheme Type B (Term Deposits) 1988 Scheme named in the same statement is a different product and is not represented in this card.",
        ],
      }),
    ],
  };
};
