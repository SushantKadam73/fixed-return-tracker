import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bandhanBulk, bandhanFd, bandhanSavings } from "../../src/adapters/bandhan-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "bandhan-bank", "rates-charges.html");
const URL = "https://bandhan.bank.in/rates-charges";

function ctx(): AdapterContext {
  const source: SourceDef = { key: "bandhan-bank:try", bankSlug: "bandhan-bank", products: [], url: URL, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
  const doc: FetchedDoc = { url: URL, finalUrl: URL, status: 200, contentType: "text/html", text: readFileSync(FIXTURE, "utf8"), fetchedAt: Date.parse("2026-09-27T06:00:00Z") };
  return {
    source,
    today: "2026-09-27",
    doc,
    fetch: async () => {
      throw new Error("network disabled in tests");
    },
  };
}

const CRORE = 1e7;
const LAKH = 1e5;

describe("Bandhan Bank adapter", () => {
  it("reads the retail domestic FD card", async () => {
    const out = await bandhanFd(ctx());
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-06-20");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(24); // 12 tenures x general/senior
    expect(rateForTenure(fd.rows, 365, { amount: 50000, customer: "general" })?.rate).toBe(7); // "1 year"
    expect(rateForTenure(fd.rows, 365, { amount: 50000, customer: "senior" })?.rate).toBe(7.5);
    expect(rateForTenure(fd.rows, 800, { amount: 50000, customer: "general" })?.rate).toBe(7.45); // "2 years to less than 3 years"
    expect(rateForTenure(fd.rows, 800, { amount: 50000, customer: "senior" })?.rate).toBe(7.95);
    expect(rateForTenure(fd.rows, 3650, { amount: 50000, customer: "senior" })?.rate).toBe(6.6); // "5 years to up to 10 years"
  });

  it("reads Callable and Non-Callable bulk cards with the ₹3cr+ amount bands", async () => {
    const out = await bandhanBulk(ctx());
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-23");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(432); // 24 tenures x 9 amount bands x callable/non-callable
    // "1 month < 2 months" (normalised from the bare "<"): callable 3.25%, non-callable 3.50%.
    expect(rateForTenure(bulk.rows, 45, { amount: 4 * CRORE, customer: "general", callable: true })?.rate).toBe(3.25);
    expect(rateForTenure(bulk.rows, 45, { amount: 4 * CRORE, customer: "general", callable: false })?.rate).toBe(3.5);
    expect(rateForTenure(bulk.rows, 45, { amount: 600 * CRORE, customer: "general", callable: false })?.rate).toBe(3.5);
    expect(out.terms?.[0]).toMatchObject({ bulkThreshold: 3 * CRORE });
  });

  it("reads the savings slabs from the plain-English footnote", async () => {
    const out = await bandhanSavings(ctx());
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-08-01");
    expect(savings.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(12);
    expect(savings.savingsSlabs?.[0]).toEqual({ balanceMin: 0, balanceMax: LAKH + 1, rate: 2.7, residency: "resident" });
    expect(savings.savingsSlabs?.[4]).toEqual({ balanceMin: 50 * LAKH + 1, balanceMax: 5 * CRORE + 1, rate: 5.55, residency: "resident" });
    expect(savings.savingsSlabs?.at(-1)).toEqual({ balanceMin: 1500 * CRORE + 1, balanceMax: null, rate: 6.15, residency: "resident" });
    expect(savings.notes?.some((n) => /whole-balance/i.test(n))).toBe(true);
  });
});
