import { describe, expect, it } from "vitest";
import { federalFd, federalSavings } from "../../src/adapters/federal-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const depositUrl = "https://www.federal.bank.in/deposit-rate";
const savingsUrl = "https://www.federal.bank.in/savings-rate";

describe("Federal Bank adapter", () => {
  it("reads the retail FD card (incl. non-callable Deposit Plus rows) and derives RD from it", async () => {
    const out = await federalFd(ctxFromFixture({ key: "federal-bank:fd", bankSlug: "federal-bank", url: depositUrl }, "federal-bank/deposit-rate.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(fd.effectiveFrom).toBe("2026-08-17");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.0); // 7 - 29 days
    expect(rateForTenure(fd.rows, 181, g)?.rate).toBe(6.0); // the 181-day peak row
    expect(rateForTenure(fd.rows, 181, s)?.rate).toBe(6.5);
    expect(rateForTenure(fd.rows, 456, g)?.rate).toBe(6.65); // 15 Months peak row
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc.length).toBeGreaterThan(0);
    expect(nc.find((r) => r.tenureMinDays === 365 && r.customer === "general")?.rate).toBe(6.35); // Deposit Plus, 1 year

    expect(rd.notes?.some((n) => /derived/i.test(n) || /same/i.test(n))).toBe(true);
    expect(rateForTenure(rd.rows, 365, g)?.rate).toBe(6.25);
  });

  it("reads the savings slabs, skipping the one slab whose sub-rates don't reconcile", async () => {
    const out = await federalSavings(ctxFromFixture({ key: "federal-bank:savings", bankSlug: "federal-bank", url: savingsUrl }, "federal-bank/savings-rate.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-07-16");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident" },
      { balanceMin: 100001, balanceMax: 1e8, rate: 2.5, residency: "resident" },
      { balanceMin: 1e8, balanceMax: 5e8, rate: 4.0, residency: "resident" },
      { balanceMin: 2e9, balanceMax: null, rate: 2.5, residency: "resident" },
    ]);
    expect(card.notes?.[0]).toMatch(/₹50Cr to less than ₹200Cr/);
  });
});
