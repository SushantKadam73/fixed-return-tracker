import { describe, expect, it } from "vitest";
import { hdfcBulk, hdfcFd, hdfcRd, hdfcSavings } from "../../src/adapters/hdfc-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.hdfc.bank.in/interest-rates";
const ctx = () => ctxFromFixture({ key: "hdfc-bank:fd", bankSlug: "hdfc-bank", url }, "hdfc-bank/combined.html");

describe("HDFC Bank adapter", () => {
  it("reads the < 3 crore retail FD card, normalising '<=' tenure labels", async () => {
    const out = await hdfcFd(ctx());
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-08-19");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(2.75); // 7 - 14 days
    expect(rateForTenure(fd.rows, 100, g)?.rate).toBe(4.25); // "90 days <= 6 months" normalised
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.25);
    expect(rateForTenure(fd.rows, 365, s)?.rate).toBe(6.75);
    const specialRow = rateForTenure(fd.rows, 1065, g); // "2 Years 11 Months (35 months)"
    expect(specialRow?.rate).toBe(6.45);
    expect(specialRow?.special).toBe(true);
    expect(rateForTenure(fd.rows, 1825, g)?.rate).toBe(6.4); // "4 Year 7 Months 1 day <=5 Years" normalised
    expect(rateForTenure(fd.rows, 1826, g)?.rate).toBe(6.15); // "5 Years 1 day to 10 Years"
  });

  it("reads the bulk card: 3-5 crore (general+senior) and >=5 crore (general only, by amount sub-band)", async () => {
    const out = await hdfcBulk(ctx());
    const c = out.cards[0];
    expect(c.product).toBe("fd_bulk");
    expect(c.effectiveFrom).toBe("2026-03-07");
    expect(hasErrors(validateCard(c))).toBe(false);
    expect(rateForTenure(c.rows, 10, { amount: 4e7, customer: "general" })?.rate).toBe(3.5);
    expect(rateForTenure(c.rows, 10, { amount: 4e7, customer: "senior" })?.rate).toBe(4.0);
    // >=5 crore: general only, split into ten amount sub-bands.
    expect(rateForTenure(c.rows, 10, { amount: 5.1e7, customer: "general" })?.rate).toBe(3.5);
    expect(rateForTenure(c.rows, 10, { amount: 2e10, customer: "general" })?.rate).toBe(3.75);
    expect(rateForTenure(c.rows, 10, { amount: 5.1e7, customer: "senior" })).toBeNull(); // no senior column >=5cr
  });

  it("reads the RD card and carries a per-row note when a tenure's own date differs from the rest", async () => {
    const out = await hdfcRd(ctx());
    const rd = out.cards[0];
    expect(rd.product).toBe("rd");
    expect(rd.effectiveFrom).toBe("2026-08-19"); // the latest per-row "Effective From" date
    expect(hasErrors(validateCard(rd))).toBe(false);
    const twelveMonth = rateForTenure(rd.rows, 365, { amount: 1000, customer: "general" });
    expect(twelveMonth?.rate).toBe(6.25);
    expect(twelveMonth?.note).toMatch(/2025-06-10/);
    const thirtyNineMonth = rateForTenure(rd.rows, 1186, { amount: 1000, customer: "senior" });
    expect(thirtyNineMonth?.rate).toBe(7.1);
    expect(thirtyNineMonth?.note).toBeUndefined();
  });

  it("reads the flat savings rate", async () => {
    const out = await hdfcSavings(ctx());
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2025-06-24");
    expect(card.slabMethod).toBe("whole");
    expect(card.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 2.5, residency: "resident" }]);
  });
});
