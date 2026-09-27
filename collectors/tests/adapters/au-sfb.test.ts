import { describe, expect, it } from "vitest";
import { auSfbFd, auSfbRd, auSfbSavings } from "../../src/adapters/au-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://www.au.bank.in/interest-rates/fixed-deposit-interest-rates";
const rdUrl = "https://www.au.bank.in/interest-rates/recurring-deposits-interest-rates";
const savingsUrl = "https://www.au.bank.in/interest-rates/savings-account-interest-rates";

describe("AU SFB adapter", () => {
  it("reads the retail FD card (general, senior, non-callable, monthly payout)", async () => {
    const out = await auSfbFd(ctxFromFixture({ key: "au-sfb:fd", bankSlug: "au-sfb", url: fdUrl }, "au-sfb/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-09-01"); // the callable general table's own date
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 30, g)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 100, g)?.rate).toBe(5.25);
    expect(rateForTenure(fd.rows, 1000, g)?.rate).toBe(7.4); // 30M1D-36M local peak
    expect(rateForTenure(fd.rows, 1000, s)?.rate).toBe(7.9);

    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc).toHaveLength(5);
    expect(rateForTenure(nc, 400, { amount: 1_50_00_000, customer: "general" })?.rate).toBe(7.2);
    expect(rateForTenure(fd.rows, 400, { amount: 10_000, customer: "general" })?.rate).toBe(7.1); // regular slab, below the non-callable band

    const monthly = fd.rows.filter((r) => r.payout === "monthly");
    expect(monthly).toHaveLength(20); // 10 tenures × general + senior
  });

  it("reads the RD card", async () => {
    const out = await auSfbRd(ctxFromFixture({ key: "au-sfb:rd", bankSlug: "au-sfb", url: rdUrl }, "au-sfb/rd.html"));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(rd))).toBe(false);
    const g = { amount: 5000, customer: "general" as const };
    const s = { amount: 5000, customer: "senior" as const };
    expect(rateForTenure(rd.rows, 91, g)?.rate).toBe(4.75); // point tenure "3 Months"
    expect(rateForTenure(rd.rows, 1000, g)?.rate).toBe(7.4); // 31-36 months, local peak
    expect(rateForTenure(rd.rows, 1000, s)?.rate).toBe(7.9);
  });

  it("reads savings: current slabs now, and keeps the pre-announced 1 Oct 2026 change as a separate future card", async () => {
    const out = await auSfbSavings(ctxFromFixture({ key: "au-sfb:savings", bankSlug: "au-sfb", url: savingsUrl }, "au-sfb/savings.html"));
    expect(out.cards).toHaveLength(2);

    const current = out.cards[0];
    expect(current.effectiveFrom).toBe("2026-04-23");
    expect(current.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(current))).toBe(false);
    expect(current.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100000, rate: 2.5, residency: "resident" },
      { balanceMin: 100000, balanceMax: 300000, rate: 2.5, residency: "resident" },
      { balanceMin: 300000, balanceMax: 500000, rate: 2.75, residency: "resident" },
      { balanceMin: 500000, balanceMax: 1000000, rate: 3.5, residency: "resident" },
      { balanceMin: 1000000, balanceMax: 250000000, rate: 6.5, residency: "resident" },
      { balanceMin: 250000000, balanceMax: 1000000000, rate: 6.75, residency: "resident" },
      { balanceMin: 1000000000, balanceMax: 7500000000, rate: 4, residency: "resident" },
      { balanceMin: 7500000000, balanceMax: null, rate: 4, residency: "resident" },
    ]);

    const future = out.cards[1];
    expect(future.effectiveFrom).toBe("2026-10-01");
    expect(future.notes?.some((n) => /not yet in force/i.test(n))).toBe(true);
    const topSlab = future.savingsSlabs?.find((s) => s.balanceMin === 1000000000);
    expect(topSlab?.rate).toBe(7);
  });
});
