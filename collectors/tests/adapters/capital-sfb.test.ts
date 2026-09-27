import { describe, expect, it } from "vitest";
import { capitalSfbFd, capitalSfbSavings } from "../../src/adapters/capital-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://www.capital.bank.in/interest-rates/callable-domestic-term-deposit";
const savingsUrl = "https://www.capital.bank.in/interest-rates/savings-bank-account";

describe("Capital SFB adapter", () => {
  it("reads the callable term-deposit card (general + senior + special-category peaks)", async () => {
    const out = await capitalSfbFd(ctxFromFixture({ key: "capital-sfb:fd", bankSlug: "capital-sfb", url: fdUrl }, "capital-sfb/fd_retail.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-06-30");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 50_000, customer: "general" as const };
    const s = { amount: 50_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 45, g)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(7.1); // named "400 Days" special tenure
    expect(rateForTenure(fd.rows, 400, s)?.rate).toBe(7.6);
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(7.15); // "12 Months" special beats the 1-5yr slab's 7.00
    expect(rateForTenure(fd.rows, 3000, s)?.rate).toBe(7.5); // "5 Years and upto 10 Years"

    const special = fd.rows.filter((r) => r.special);
    expect(special.map((r) => r.tenureMinDays).sort((a, b) => a - b)).toEqual([365, 365, 400, 400, 600, 600, 900, 900]);
  });

  it("reads savings (single flat rate, no slabs, no date printed)", async () => {
    const out = await capitalSfbSavings(ctxFromFixture({ key: "capital-sfb:savings", bankSlug: "capital-sfb", url: savingsUrl }, "capital-sfb/savings.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBeNull();
    expect(card.slabMethod).toBe("whole");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs?.every((s) => s.rate === 3.1)).toBe(true);
    expect(card.savingsSlabs?.map((s) => s.residency).sort()).toEqual(["nre", "nro", "resident", "resident"]);
  });
});
