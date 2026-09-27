import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cubBulk, cubFd, cubSavings } from "../../src/adapters/city-union-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "city-union-bank", "deposit-interest-rate.html");
const URL = "https://www.cityunionbank.bank.in/deposit-interest-rate";

function ctx(): AdapterContext {
  const source: SourceDef = { key: "city-union-bank:try", bankSlug: "city-union-bank", products: [], url: URL, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
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

describe("City Union Bank adapter", () => {
  it("reads the retail FD card: callable (general/senior/super-senior) plus the ₹1-3cr non-callable table", async () => {
    const out = await cubFd(ctx());
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-06-16");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(78); // 13 tenures x 3 customer types x (callable + non-callable)
    // "271 days to 364 days": general/senior/super-senior premium ladder.
    expect(rateForTenure(fd.rows, 300, { amount: 50000, customer: "general", callable: true })?.rate).toBe(6.25);
    expect(rateForTenure(fd.rows, 300, { amount: 50000, customer: "senior", callable: true })?.rate).toBe(6.5);
    expect(rateForTenure(fd.rows, 300, { amount: 50000, customer: "super_senior", callable: true })?.rate).toBe(6.55);
    // "444 days" special tenure (no scheme name printed).
    expect(rateForTenure(fd.rows, 444, { amount: 50000, customer: "senior", callable: true })?.rate).toBe(7.35);
    // Non-callable ₹1-3cr row for the same 444-day tenure differs from the callable rate.
    expect(rateForTenure(fd.rows, 444, { amount: 2 * CRORE, customer: "general", callable: false })?.rate).toBe(7.15);
    expect(rateForTenure(fd.rows, 444, { amount: 50000, customer: "general", callable: false })).toBeNull(); // below ₹1cr: non-callable table doesn't apply
    // "Tax Saver" row (no parseable tenure) is skipped, not thrown on.
    expect(fd.rows.some((r) => r.tenureLabel === "Tax Saver")).toBe(false);
  });

  it("reads the domestic bulk card: Callable and CUB Deposit PLUS (non-callable), 7 amount bands each", async () => {
    const out = await cubBulk(ctx());
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "general", callable: true })?.rate).toBe(4);
    expect(rateForTenure(bulk.rows, 10, { amount: 150 * CRORE, customer: "general", callable: true })?.rate).toBe(4);
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "general", callable: false })?.rate).toBe(4.05);
    // "444 days" shows "--" (not offered) for the ₹100cr+ band on both Callable and non-callable.
    expect(rateForTenure(bulk.rows, 444, { amount: 150 * CRORE, customer: "general", callable: true })).toBeNull();
    expect(rateForTenure(bulk.rows, 444, { amount: 150 * CRORE, customer: "general", callable: false })).toBeNull();
    expect(rateForTenure(bulk.rows, 444, { amount: 4 * CRORE, customer: "general", callable: true })?.rate).toBe(7.1);
    expect(rateForTenure(bulk.rows, 444, { amount: 4 * CRORE, customer: "general", callable: false })?.rate).toBe(7.15);
    expect(rateForTenure(bulk.rows, 10, { amount: 1_00_000, customer: "general" })).toBeNull(); // below the ₹3cr bulk threshold
  });

  it("reads the savings slabs", async () => {
    const out = await cubSavings(ctx());
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2025-06-25");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 10 * LAKH, rate: 2.75, residency: "resident" },
      { balanceMin: 10 * LAKH, balanceMax: CRORE, rate: 3, residency: "resident" },
      { balanceMin: CRORE, balanceMax: 10 * CRORE, rate: 3.5, residency: "resident" },
      { balanceMin: 10 * CRORE, balanceMax: 50 * CRORE, rate: 4, residency: "resident" },
      { balanceMin: 50 * CRORE, balanceMax: null, rate: 4.5, residency: "resident" },
    ]);
  });
});
