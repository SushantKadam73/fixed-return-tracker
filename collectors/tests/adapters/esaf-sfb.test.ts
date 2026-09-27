import { describe, expect, it } from "vitest";
import { esafSfbFd, esafSfbSavings } from "../../src/adapters/esaf-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.esaf.bank.in/interest-rates/";

describe("ESAF SFB adapter", () => {
  it("reads the resident term-deposit card (general + senior) and derives RD from it", async () => {
    const out = await esafSfbFd(ctxFromFixture({ key: "esaf-sfb:fd", bankSlug: "esaf-sfb", url }, "esaf-sfb/interest_rates.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-05-01");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(22); // 11 tenure rows × general + senior

    const g = { amount: 50_000, customer: "general" as const };
    const s = { amount: 50_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(2.75);
    expect(rateForTenure(fd.rows, 501, g)?.rate).toBe(7.5); // named point tenure, local peak
    expect(rateForTenure(fd.rows, 501, s)?.rate).toBe(8);
    expect(rateForTenure(fd.rows, 3000, s)?.rate).toBe(6.25);

    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.notes?.some((n) => /derived/i.test(n))).toBe(true);
    expect(rd.rows.every((r) => !r.special)).toBe(true);
    expect(rateForTenure(rd.rows, 365, g)?.rate).toBe(4.75);
  });

  it("reads the savings slabs (incremental, gap-free bands)", async () => {
    const out = await esafSfbSavings(ctxFromFixture({ key: "esaf-sfb:savings", bankSlug: "esaf-sfb", url }, "esaf-sfb/interest_rates.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-06-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident" },
      { balanceMin: 100001, balanceMax: 200001, rate: 3, residency: "resident" },
      { balanceMin: 200001, balanceMax: 500001, rate: 5, residency: "resident" },
      { balanceMin: 500001, balanceMax: 1500001, rate: 5.5, residency: "resident" },
      { balanceMin: 1500001, balanceMax: 10000001, rate: 6.5, residency: "resident" },
      { balanceMin: 10000001, balanceMax: 150000001, rate: 7, residency: "resident" },
      { balanceMin: 150000001, balanceMax: 1000000001, rate: 7.5, residency: "resident" },
      { balanceMin: 1000000001, balanceMax: null, rate: 8, residency: "resident" },
    ]);
  });
});
