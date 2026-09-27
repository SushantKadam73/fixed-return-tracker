import { describe, expect, it } from "vitest";
import { sbiBulk, sbiRetail, sbiSavings } from "../../src/adapters/sbi";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const retailUrl = "https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits";

describe("SBI adapter", () => {
  it("reads the retail FD card (revised columns only)", async () => {
    const out = await sbiRetail(ctxFromFixture({ key: "sbi:fd", bankSlug: "sbi", url: retailUrl }, "sbi/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2025-12-15");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.25);
    expect(rateForTenure(fd.rows, 730, g)?.rate).toBe(6.4); // revised, not the existing 6.45
    expect(rateForTenure(fd.rows, 800, s)?.rate).toBe(6.9);
    expect(rateForTenure(fd.rows, 1825, s)?.rate).toBe(7.05);
    expect(rateForTenure(fd.rows, 444, g)?.rate).toBe(6.45); // Amrit Vrishti
    expect(rateForTenure(fd.rows, 30, g)?.rate).toBe(3.05);
  });
  it("captures non-callable rows for ₹1–3 crore", async () => {
    const out = await sbiRetail(ctxFromFixture({ key: "sbi:fd", bankSlug: "sbi", url: retailUrl }, "sbi/fd_retail.html"));
    const nc = out.cards[0].rows.filter((r) => r.callable === false);
    expect(nc.map((r) => [r.tenureMinDays, r.customer, r.rate])).toEqual([
      [365, "general", 6.55],
      [365, "senior", 7.05],
      [730, "general", 6.8],
      [730, "senior", 7.3],
    ]);
  });
  it("derives RD from FD only because SBI states they are equal", async () => {
    const out = await sbiRetail(ctxFromFixture({ key: "sbi:fd", bankSlug: "sbi", url: retailUrl }, "sbi/fd_retail.html"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(rd.rows.every((r) => r.tenureMinDays >= 365 && !r.special && r.callable !== false)).toBe(true);
    expect(rd.notes?.some((n) => /derived/i.test(n))).toBe(true);
  });
  it("reads the bulk card", async () => {
    const out = await sbiBulk(ctxFromFixture({ key: "sbi:fd_bulk", bankSlug: "sbi", url: "https://sbi.bank.in/web/interest-rates/deposit-rates/domestic-bulk-term-deposits" }, "sbi/fd_bulk.html"));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-08-15");
    expect(rateForTenure(c.rows, 10, { amount: 5e7, customer: "general" })?.rate).toBe(4.25);
    expect(rateForTenure(c.rows, 10, { amount: 1e5, customer: "general" })).toBeNull(); // below bulk threshold
  });
  it("reads savings", async () => {
    const out = await sbiSavings(ctxFromFixture({ key: "sbi:savings", bankSlug: "sbi", url: "https://sbi.bank.in/web/interest-rates/savings-bank-deposits" }, "sbi/savings.html"));
    expect(out.cards[0].savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 2.5, residency: "resident" }]);
    expect(out.cards[0].effectiveFrom).toBe("2025-06-15");
  });
});
