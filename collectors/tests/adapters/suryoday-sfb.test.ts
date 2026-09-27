import { describe, expect, it } from "vitest";
import { suryodaySfbFd, suryodaySfbSavings } from "../../src/adapters/suryoday-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://suryoday.bank.in/rate-of-interest/";

describe("Suryoday SFB adapter", () => {
  it("reads the savings slabs (incremental, gap-free bands; the unpublished >25cr tier is omitted; a 'Highest' badge is stripped)", async () => {
    const out = await suryodaySfbSavings(ctxFromFixture({ key: "suryoday-sfb:savings", bankSlug: "suryoday-sfb", url }, "suryoday-sfb/rate_of_interest.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-08-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident" },
      { balanceMin: 100001, balanceMax: 500001, rate: 2.5, residency: "resident" },
      { balanceMin: 500001, balanceMax: 1000001, rate: 3.5, residency: "resident" },
      { balanceMin: 1000001, balanceMax: 3000001, rate: 5.5, residency: "resident" },
      { balanceMin: 3000001, balanceMax: 5000001, rate: 7, residency: "resident" },
      { balanceMin: 5000001, balanceMax: 20000001, rate: 7.5, residency: "resident" },
      { balanceMin: 20000001, balanceMax: 50000001, rate: 7.5, residency: "resident" },
      { balanceMin: 50000001, balanceMax: 250000001, rate: 7.6, residency: "resident" }, // "7.60%Highest" badge stripped
    ]);
    // "Above Rs. 25 Crore" prints only "Contact Branch" — no 9th slab is invented for it.
    expect(card.savingsSlabs).toHaveLength(8);
  });

  it('reads the Fixed Deposits card (general + senior, <3cr) — written and tested, but NOT wired to a live source: the tab is only reachable by a client-side click this project\'s fetchers cannot perform (see file header)', async () => {
    const out = await suryodaySfbFd(ctxFromFixture({ key: "suryoday-sfb:fd", bankSlug: "suryoday-sfb", url }, "suryoday-sfb/rate_of_interest.html"));
    const fd = out.cards[0];
    expect(fd.product).toBe("fd");
    expect(fd.effectiveFrom).toBe("2026-09-24");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(34); // 17 tenure rows x general + senior

    const g = { amount: 50_000, customer: "general" as const };
    const s = { amount: 50_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(4);
    expect(rateForTenure(fd.rows, 184, g)?.rate).toBe(6.5); // "6 Month 1 Day" point tenure
    expect(rateForTenure(fd.rows, 913, s)?.rate).toBe(8.25); // "30 Months" point tenure
    expect(rateForTenure(fd.rows, 1825, g)?.rate).toBe(8.25); // "5 Years" — "Highest" badge stripped
    expect(rateForTenure(fd.rows, 1825, s)?.rate).toBe(8.5); // "Highest" badge stripped
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(7.25); // "1 Year*" — footnote asterisk doesn't break parsing
    expect(fd.rows.every((r) => r.amountMax === 3e7)).toBe(true);
  });

  it("throws if the Fixed Deposits table no longer states its <3cr amount scope", async () => {
    const ctx = ctxFromFixture({ key: "suryoday-sfb:fd", bankSlug: "suryoday-sfb", url }, "suryoday-sfb/rate_of_interest.html");
    ctx.doc.text = ctx.doc.text.replace("Rate for amount &lt; 3 Crore. ", "");
    await expect(suryodaySfbFd(ctx)).rejects.toThrow(/cannot confirm/i);
  });
});
