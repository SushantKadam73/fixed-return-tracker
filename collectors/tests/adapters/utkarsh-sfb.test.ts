import { describe, expect, it } from "vitest";
import { utkarshFd, utkarshRd, utkarshSavings } from "../../src/adapters/utkarsh-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const g = { amount: 1_00_000, customer: "general" as const };
const s = { amount: 1_00_000, customer: "senior" as const };

describe("Utkarsh SFB adapter", () => {
  it("reads the FD annexure PDF", async () => {
    const out = await utkarshFd(
      ctxFromFixture({ key: "utkarsh-sfb:fd", bankSlug: "utkarsh-sfb", url: "https://www.utkarsh.bank.in/assests/pdf/Annexure_Domestic_Fixed_Deposit_Interest_Rates.pdf", format: "pdf" }, "utkarsh-sfb/fd_retail.txt"),
    );
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-05-05");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(rateForTenure(fd.rows, 20, g)?.rate).toBe(4.0);
    expect(rateForTenure(fd.rows, 666, g)?.rate).toBe(8.1); // special tenure
    expect(rateForTenure(fd.rows, 666, s)?.rate).toBe(8.25);
    expect(rateForTenure(fd.rows, 666, g)?.special).toBe(true);
    // 667 days to 2 years (729 days) then 2 years (730 days) to 3 years (1095 days): no overlap at the boundary.
    expect(rateForTenure(fd.rows, 729, g)?.rate).toBe(7.25);
    expect(rateForTenure(fd.rows, 730, g)?.rate).toBe(7.5);
    expect(rateForTenure(fd.rows, 3650, g)?.rate).toBe(6.75);
    expect(fd.rows.every((r) => r.amountMax === 3 * 1e7)).toBe(true);
  });

  it("reads the RD annexure PDF as its own card (not derived from FD)", async () => {
    const out = await utkarshRd(
      ctxFromFixture({ key: "utkarsh-sfb:rd", bankSlug: "utkarsh-sfb", url: "https://www.utkarsh.bank.in/assests/pdf/Annexure_Recurring_Deposit_Interest_Rates.pdf", format: "pdf" }, "utkarsh-sfb/rd.txt"),
    );
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(rd.effectiveFrom).toBe("2026-05-05");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 365, g)?.rate).toBe(6.0); // 12 months
    expect(rateForTenure(rd.rows, 365, s)?.rate).toBe(6.5);
    expect(rateForTenure(rd.rows, 700, g)?.rate).toBe(7.25); // Above 21 months to 24 months
    expect(rd.notes?.some((n) => /own recurring-deposit card, not derived/i.test(n))).toBe(true);
  });

  it("reads the savings incremental slabs", async () => {
    const out = await utkarshSavings(
      ctxFromFixture({ key: "utkarsh-sfb:savings", bankSlug: "utkarsh-sfb", url: "https://www.utkarsh.bank.in/personal/savings-account/standard-savings-account" }, "utkarsh-sfb/savings.html"),
    );
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-07-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.75, residency: "resident", note: "Balance Upto ₹ 1 Lakh" },
      { balanceMin: 100001, balanceMax: 300001, rate: 3.5, residency: "resident", note: "Incremental balance above₹ 1 Lakh upto ₹3 Lakhs" },
      { balanceMin: 300001, balanceMax: 500001, rate: 4.25, residency: "resident", note: "Incremental balance above₹ 3 Lakh upto ₹5 Lakhs" },
      { balanceMin: 500001, balanceMax: 1000001, rate: 5.5, residency: "resident", note: "Incremental balance above₹ 5 Lakhs upto ₹10 Lakhs" },
      { balanceMin: 1000001, balanceMax: 5000001, rate: 7.0, residency: "resident", note: "Incremental balance above₹ 10 Lakhs upto ₹50 Lakhs" },
      { balanceMin: 5000001, balanceMax: 100000001, rate: 7.25, residency: "resident", note: "Incremental balance above₹ 50 Lakhs upto ₹10 Crore" },
      { balanceMin: 100000001, balanceMax: 1000000001, rate: 7.5, residency: "resident", note: "Incremental balance above₹ 10 Crore upto ₹100 Crore" },
      { balanceMin: 1000000001, balanceMax: 2500000001, rate: 8.0, residency: "resident", note: "Incremental balance above₹ 100 Crore upto ₹250 Crore" },
      { balanceMin: 2500000001, balanceMax: 5000000001, rate: 8.25, residency: "resident", note: "Incremental balance above₹ 250 Crore upto ₹500 Crore" },
      { balanceMin: 5000000001, balanceMax: null, rate: 8.0, residency: "resident", note: "Incremental balance above ₹ 500 Crore" },
    ]);
  });
});
