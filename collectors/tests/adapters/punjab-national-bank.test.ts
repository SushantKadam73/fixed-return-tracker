import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pnbBulk, pnbFd } from "../../src/adapters/punjab-national-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const depositUrl = "https://pnb.bank.in/Interest-Rates-Deposit.html";
const bulkLandingUrl = "https://pnb.bank.in/interest-rates-bulk-deposit.html";

function fixture(p: string): string {
  return readFileSync(path.join(__dirname, "..", "..", "fixtures", p), "utf8");
}

/** pnbBulk chases two other pages via ctx.fetch; ctxFromFixture's fetch always throws, so this
 * test builds its own context that resolves both URLs to the saved fixtures. */
function bulkCtx(): AdapterContext {
  const source: SourceDef = { key: "punjab-national-bank:fd_bulk", bankSlug: "punjab-national-bank", products: ["fd_bulk"], url: bulkLandingUrl, format: "html", runner: "github", adapter: "punjab-national-bank.bulk", cadence: "bulk_daily", active: true };
  const landingText = fixture("punjab-national-bank/bulk_landing.html");
  const doc: FetchedDoc = { url: bulkLandingUrl, finalUrl: bulkLandingUrl, status: 200, contentType: "text/html", text: landingText, fetchedAt: Date.parse("2026-09-27T06:00:00Z") };
  return {
    source,
    today: "2026-09-27",
    doc,
    fetch: async (url: string, format) => {
      if (url.includes("downloadprocess.aspx")) {
        return { url, finalUrl: url, status: 200, contentType: "application/pdf", text: fixture("punjab-national-bank/bulk.txt"), fetchedAt: Date.now() };
      }
      if (url === depositUrl) {
        return { url, finalUrl: url, status: 200, contentType: "text/html", text: fixture("punjab-national-bank/fd_retail.html"), fetchedAt: Date.now() };
      }
      throw new Error(`unexpected fetch in test: ${url} (${format})`);
    },
  };
}

describe("Punjab National Bank adapter", () => {
  it("reads the retail FD card (below ₹3cr) and the PNB Uttam non-callable ₹1-3cr rows", async () => {
    const out = await pnbFd(ctxFromFixture({ key: "punjab-national-bank:fd", bankSlug: "punjab-national-bank", url: depositUrl }, "punjab-national-bank/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-01");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const find = (minDays: number, customer: string, callable: boolean) => fd.rows.find((r) => r.tenureMinDays === minDays && r.customer === customer && r.callable === callable);
    expect(find(365, "general", true)?.rate).toBe(6.25);
    expect(find(365, "senior", true)?.rate).toBe(6.75);
    expect(find(365, "super_senior", true)?.rate).toBe(7.05);
    expect(find(444, "general", true)?.rate).toBe(6.6); // special tenure, auto-flagged (444 % 365 != 0)
    expect(fd.rows.find((r) => r.tenureMinDays === 444 && r.callable === true)?.special).toBe(true);
    // PNB Palaash named scheme at 1204 days, on both the callable and non-callable tables
    expect(find(1204, "general", true)?.schemeName).toBe("PNB Palaash");
    expect(find(1204, "general", false)?.schemeName).toBe("PNB Palaash");

    // PNB Uttam non-callable, ₹1 crore+ to <₹3 crore
    const uttam1y = fd.rows.find((r) => r.tenureMinDays === 365 && r.customer === "general" && r.callable === false);
    expect(uttam1y).toMatchObject({ rate: 6.35, amountMin: CRORE + 1, amountMax: 3 * CRORE });
    expect(find(444, "senior", false)?.rate).toBe(7.2);
    expect(find(444, "super_senior", false)?.rate).toBe(7.5);
  });

  it("reads the savings card from the compound '> X <= Y' slab labels", async () => {
    const out = await pnbFd(ctxFromFixture({ key: "punjab-national-bank:fd", bankSlug: "punjab-national-bank", url: depositUrl }, "punjab-national-bank/fd_retail.html"));
    const savings = out.cards.find((c) => c.product === "savings")!;
    expect(savings.effectiveFrom).toBe("2025-10-01");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100 * CRORE + 1, rate: 2.5, residency: "resident" },
      { balanceMin: 100 * CRORE + 1, balanceMax: 500 * CRORE + 1, rate: 2.7, residency: "resident" },
      { balanceMin: 500 * CRORE + 1, balanceMax: 1000 * CRORE + 1, rate: 3.6, residency: "resident" },
      { balanceMin: 1000 * CRORE + 1, balanceMax: 2000 * CRORE + 1, rate: 3.75, residency: "resident" },
      { balanceMin: 2000 * CRORE + 1, balanceMax: null, rate: 4.25, residency: "resident" },
    ]);
  });

  it("reads the bulk card by merging the 3-10cr HTML table with the >10cr PDF (re-deriving the tokenised link)", async () => {
    const out = await pnbBulk(bulkCtx());
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-03-14"); // from the 3-10cr table's own header, not the PDF's date
    expect(hasErrors(validateCard(bulk))).toBe(false);

    // 3-10cr band: callable general 1yr, and the PNB Uttam non-callable variant
    const callable1y = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 3 * CRORE && r.amountMax === 10 * CRORE && r.callable === true);
    expect(callable1y?.rate).toBe(6.25);
    const nonCallable1y = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 3 * CRORE && r.amountMax === 10 * CRORE && r.callable === false);
    expect(nonCallable1y?.rate).toBe(6.3);
    // First 3 slabs (7-14, 15-45, 46-90 days) are "NA" for the non-callable column and must be skipped, not invented.
    expect(bulk.rows.some((r) => r.tenureMinDays === 7 && r.callable === false && r.amountMax === 10 * CRORE)).toBe(false);

    // >10cr callable band from the PDF, e.g. the "1 year" row (6.40 across all 4 printed bands)
    const above10cr1y = bulk.rows.filter((r) => r.tenureMinDays === 365 && r.tenureMaxDays === 365 && r.amountMin === 10 * CRORE + 1);
    expect(above10cr1y).toHaveLength(1);
    expect(above10cr1y[0].rate).toBe(6.4);
    expect(above10cr1y[0].amountMax).toBe(25 * CRORE + 1);
    const above500cr1y = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 500 * CRORE + 1);
    expect(above500cr1y?.rate).toBe(6.4);
    expect(above500cr1y?.amountMax).toBe(1000 * CRORE + 1);

    // Non-callable >10cr and the PDF's 5th (NRE) column must NOT be read (order can't be trusted — see file header).
    expect(bulk.notes?.some((n) => /non-callable.*not read|not read because/i.test(n))).toBe(true);
  });
});
