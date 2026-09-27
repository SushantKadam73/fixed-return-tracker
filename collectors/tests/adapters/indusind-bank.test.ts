import { describe, expect, it } from "vitest";
import { indusindBulk, indusindFd, indusindSavings } from "../../src/adapters/indusind-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://www.indusind.bank.in/in/en/personal/fixed-deposit-interest-rate.html";
const savingsUrl = "https://www.indusind.bank.in/in/en/personal/accounts/savings-account-interest-rate.html";

describe("IndusInd Bank adapter", () => {
  it("reads the retail (<3 crore) FD card", async () => {
    const out = await indusindFd(ctxFromFixture({ key: "indusind-bank:fd", bankSlug: "indusind-bank", url: fdUrl }, "indusind-bank/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-07-24");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.25);
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.75); // 270 days to 364 days bucket note: 365 is next bucket
    expect(rateForTenure(fd.rows, 800, g)?.rate).toBe(7.0); // 2 years to 3 years — the +0.75pp senior tenure
    expect(rateForTenure(fd.rows, 800, s)?.rate).toBe(7.75);
    expect(rateForTenure(fd.rows, 1825, g)?.rate).toBe(6.65); // Tax Saver (5 years)
    expect(rateForTenure(fd.rows, 1825, s)?.rate).toBe(7.15);
  });
  it("captures the non-callable ₹1–3 crore rows inside the retail card", async () => {
    const out = await indusindFd(ctxFromFixture({ key: "indusind-bank:fd", bankSlug: "indusind-bank", url: fdUrl }, "indusind-bank/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc.length).toBeGreaterThan(0);
    expect(nc.every((r) => r.amountMin > 1e7 && r.amountMax === 3e7)).toBe(true);
    const row = nc.find((r) => r.tenureMinDays === 7 && r.customer === "general");
    expect(row?.rate).toBe(4.5);
  });
  it("reads the ₹3–5 crore bulk card (callable + non-callable)", async () => {
    const out = await indusindBulk(ctxFromFixture({ key: "indusind-bank:fd_bulk", bankSlug: "indusind-bank", url: fdUrl }, "indusind-bank/fd_retail.html"));
    const c = out.cards[0];
    expect(c.product).toBe("fd_bulk");
    expect(c.effectiveFrom).toBe("2025-09-25");
    expect(hasErrors(validateCard(c))).toBe(false);
    expect(rateForTenure(c.rows, 10, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(4.4);
    expect(rateForTenure(c.rows, 10, { amount: 4e7, customer: "general", callable: false })?.rate).toBe(4.5);
    expect(rateForTenure(c.rows, 10, { amount: 1e5, customer: "general" })).toBeNull(); // below the bulk threshold
  });
  it("reads the savings slabs (incremental below ₹5cr, flat above)", async () => {
    const out = await indusindSavings(ctxFromFixture({ key: "indusind-bank:savings", bankSlug: "indusind-bank", url: savingsUrl }, "indusind-bank/savings.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-03-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident", note: undefined },
      { balanceMin: 100001, balanceMax: 2500001, rate: 3.0, residency: "resident", note: undefined },
      { balanceMin: 2500001, balanceMax: 50000001, rate: 4.0, residency: "resident", note: undefined },
      { balanceMin: 50000001, balanceMax: 1000000001, rate: 5.0, residency: "resident", note: "Flat rate on the entire balance (bank's own footnote), not incremental like the slabs below ₹5 crore." },
      { balanceMin: 1000000001, balanceMax: 1500000001, rate: 7.05, residency: "resident", note: "Flat rate on the entire balance (bank's own footnote), not incremental like the slabs below ₹5 crore." },
      { balanceMin: 1500000001, balanceMax: 14000000001, rate: 7.0, residency: "resident", note: "Flat rate on the entire balance (bank's own footnote), not incremental like the slabs below ₹5 crore." },
    ]);
  });
});
