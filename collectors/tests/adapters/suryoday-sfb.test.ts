import { describe, expect, it } from "vitest";
import { suryodaySfbSavings } from "../../src/adapters/suryoday-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const url = "https://suryoday.bank.in/rate-of-interest/";

describe("Suryoday SFB adapter", () => {
  it("reads the savings slabs (incremental, gap-free bands; the unpublished >25cr tier is omitted)", async () => {
    const out = await suryodaySfbSavings(ctxFromFixture({ key: "suryoday-sfb:savings", bankSlug: "suryoday-sfb", url }, "suryoday-sfb/rate_of_interest.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-05-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident" },
      { balanceMin: 100001, balanceMax: 500001, rate: 2.5, residency: "resident" },
      { balanceMin: 500001, balanceMax: 1000001, rate: 5.5, residency: "resident" },
      { balanceMin: 1000001, balanceMax: 2500001, rate: 6.5, residency: "resident" },
      { balanceMin: 2500001, balanceMax: 50000001, rate: 7.5, residency: "resident" },
      { balanceMin: 50000001, balanceMax: 250000001, rate: 7.6, residency: "resident" },
    ]);
    // "Above Rs. 25 Crore" prints only "Contact Branch" — no 7th slab is invented for it.
    expect(card.savingsSlabs).toHaveLength(6);
  });
});
