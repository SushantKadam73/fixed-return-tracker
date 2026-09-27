import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { csbBulk, csbFd, csbSavings } from "../../src/adapters/csb-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXDIR = path.join(__dirname, "..", "..", "fixtures", "csb-bank");
const read = (name: string) => readFileSync(path.join(FIXDIR, name), "utf8");
const URL = "https://www.csb.bank.in/interest-rates";

/**
 * csb.bank.in intermittently redirects to a Radware challenge (see the adapter's header
 * comment); this fixture is a genuine copy fetched successfully in this session (200, real
 * tables), trimmed with href kept on <a> so the bulk-deposit PDF link can be discovered.
 */
function ctx(pdfFixture?: string): AdapterContext {
  const source: SourceDef = { key: "csb-bank:try", bankSlug: "csb-bank", products: [], url: URL, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
  const doc: FetchedDoc = { url: URL, finalUrl: URL, status: 200, contentType: "text/html", text: read("interest-rates.html"), fetchedAt: Date.parse("2026-09-27T06:00:00Z") };
  return {
    source,
    today: "2026-09-27",
    doc,
    fetch: async (url: string): Promise<FetchedDoc> => {
      if (!pdfFixture) throw new Error(`unexpected fetch of ${url}`);
      return { url, finalUrl: url, status: 200, contentType: "application/pdf", text: read(pdfFixture), fetchedAt: Date.now() };
    },
  };
}

const CRORE = 1e7;

describe("CSB Bank adapter", () => {
  it("reads the domestic term-deposit card: general, senior (separate table) and non-callable", async () => {
    const out = await csbFd(ctx());
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-05");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(23); // 11 tenor rows x general/senior + 1 non-callable row
    // Short tenures: no senior premium.
    expect(rateForTenure(fd.rows, 91, { amount: 50000, customer: "general" })?.rate).toBe(4.75); // "3 months to less than 6 months"
    expect(rateForTenure(fd.rows, 91, { amount: 50000, customer: "senior" })?.rate).toBe(4.75);
    // 6 months+: +0.25pp senior premium (bank raised this from 0.15pp in the revision seen here).
    expect(rateForTenure(fd.rows, 183, { amount: 50000, customer: "general" })?.rate).toBe(5.25); // "6 months to less than 9 months"
    expect(rateForTenure(fd.rows, 183, { amount: 50000, customer: "senior" })?.rate).toBe(5.5);
    expect(rateForTenure(fd.rows, 395, { amount: 50000, customer: "general", callable: true })?.rate).toBe(7); // "13 months" (callable)
    // Non-callable "13 months" row co-exists at the same tenure with a different (higher) rate.
    const nonCallable = fd.rows.filter((r) => r.callable === false);
    expect(nonCallable).toHaveLength(1);
    expect(nonCallable[0]).toMatchObject({ tenureMinDays: 395, tenureMaxDays: 395, rate: 7.05, customer: "general" });
  });

  it("discovers the dated bulk-deposit PDF and reads Callable/Non-Callable amount bands", async () => {
    const out = await csbBulk(ctx("domestic-bulk-deposit.txt"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-28");
    expect(bulk.sourceUrl).toBe("https://www.csb.bank.in/pdf/Interest-Rates-on-Domestic-Resident-Bulk-Deposit-w.e.f-28-09-2026.pdf");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(116); // 10 tenors x 6 bands (callable) + 8 tenors x 7 bands (non-callable)
    // "7 days to 14 days", callable, ₹3-<5cr vs ₹100cr+.
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "general", callable: true })?.rate).toBe(4.5);
    expect(rateForTenure(bulk.rows, 10, { amount: 150 * CRORE, customer: "general", callable: true })?.rate).toBe(6);
    // Non-callable starts only from "1 month 15 days"; below that it isn't offered.
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "general", callable: false })).toBeNull();
    expect(rateForTenure(bulk.rows, 50, { amount: 4 * CRORE, customer: "general", callable: false })?.rate).toBe(5.5);
  });

  it("reads the savings slabs from the last (cumulative) row", async () => {
    const out = await csbSavings(ctx());
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-09-05");
    expect(savings.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(9);
    expect(savings.savingsSlabs?.[0]).toMatchObject({ balanceMin: 0, rate: 2.1 });
    expect(savings.savingsSlabs?.at(-1)).toEqual({ balanceMin: 300 * CRORE + 1, balanceMax: null, rate: 7.4, residency: "resident" });
  });
});
