import { describe, expect, it } from "vitest";
import { karnatakaBankBulk, karnatakaBankFd, karnatakaBankSavings } from "../../src/adapters/karnataka-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://www.karnatakabank.bank.in/deposit-data";

describe("Karnataka Bank adapter", () => {
  it("reads the retail FD card (callable general + senior, and non-callable ₹2cr–<3cr)", async () => {
    const out = await karnatakaBankFd(ctxFromFixture({ key: "karnataka-bank:fd", bankSlug: "karnataka-bank", url: fdUrl }, "karnataka-bank/fd_deposit_data.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-08");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 30, g)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.5); // "1 year to 554 days"
    expect(rateForTenure(fd.rows, 555, g)?.rate).toBe(7.0); // 555 days only (special)
    expect(rateForTenure(fd.rows, 555, g)?.special).toBe(true);
    expect(rateForTenure(fd.rows, 365, s)?.rate).toBe(6.9); // senior, callable table
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(5.5); // above 5 years to 10 years

    // Non-callable ₹2cr–<3cr rows are part of the retail (below ₹3cr) card, like SBI's ₹1cr+ band.
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc).toHaveLength(8); // 4 tenures x (general, senior)
    expect(nc.every((r) => r.amountMin === 2_00_00_000 && r.amountMax === 3 * 1e7)).toBe(true);
    const ncSpecial = nc.find((r) => r.tenureMinDays === 555 && r.customer === "senior");
    expect(ncSpecial?.rate).toBe(7.65);
  });

  it("has no RD card: the RD page only says rates are 'similar to' FDs, not equal", async () => {
    const out = await karnatakaBankFd(ctxFromFixture({ key: "karnataka-bank:fd", bankSlug: "karnataka-bank", url: fdUrl }, "karnataka-bank/fd_deposit_data.html"));
    expect(out.cards.find((c) => c.product === "rd")).toBeUndefined();
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.notes?.some((n) => /rd rates not published/i.test(n))).toBe(true);
    expect(out.terms?.[0]?.rdRules).toMatch(/not published/i);
  });

  it("reads the bulk FD card, including the non-callable ₹3cr+ rows and the fixed 6,85 → 6.85 typo", async () => {
    const out = await karnatakaBankBulk(ctxFromFixture({ key: "karnataka-bank:fd_bulk", bankSlug: "karnataka-bank", url: fdUrl }, "karnataka-bank/fd_deposit_data.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-06-08");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(rateForTenure(bulk.rows, 365, { amount: 5e7, customer: "general", callable: true })?.rate).toBe(6.3); // callable general, 3-10cr
    expect(rateForTenure(bulk.rows, 365, { amount: 5e7, customer: "senior", callable: true })?.rate).toBe(6.7); // callable senior, 3-5cr
    expect(rateForTenure(bulk.rows, 5e6, { amount: 1e5, customer: "general" })).toBeNull(); // below bulk threshold

    const ncBulkSenior556 = bulk.rows.find((r) => r.callable === false && r.customer === "senior" && r.tenureMinDays === 556);
    expect(ncBulkSenior556?.rate).toBe(6.85); // fixed from the "6,85" typo on the source page
  });

  it("reads savings slabs (7 bands, no stated whole/incremental method)", async () => {
    const out = await karnatakaBankSavings(ctxFromFixture({ key: "karnataka-bank:savings", bankSlug: "karnataka-bank", url: "https://www.karnatakabank.bank.in/savings-account-interest-rates" }, "karnataka-bank/savings.html"));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-04-01");
    expect(c.slabMethod).toBe("unknown");
    expect(c.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 1_00_001, rate: 2.25, residency: "resident" },
      { balanceMin: 1_00_001, balanceMax: 5_00_001, rate: 2.25, residency: "resident" },
      { balanceMin: 5_00_001, balanceMax: 10_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 10_00_001, balanceMax: 25_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 25_00_001, balanceMax: 50_00_001, rate: 2.75, residency: "resident" },
      { balanceMin: 50_00_001, balanceMax: 100_00_001, rate: 3.25, residency: "resident" },
      { balanceMin: 100_00_001, balanceMax: null, rate: 3.75, residency: "resident" },
    ]);
    expect(hasErrors(validateCard(c))).toBe(false);
  });
});
