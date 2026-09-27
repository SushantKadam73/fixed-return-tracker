import { describe, expect, it } from "vitest";
import { shivalikFd, shivalikRd, shivalikSavings } from "../../src/adapters/shivalik-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const source = { key: "shivalik-sfb:fd", bankSlug: "shivalik-sfb", url: "https://shivalik.bank.in/interest-rate" };
const fixture = "shivalik-sfb/interest-rate.html";

describe("Shivalik SFB adapter", () => {
  it("reads callable + non-callable FD rows into one card, and the tax-saver row into its own card", async () => {
    const out = await shivalikFd(ctxFromFixture(source, fixture));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const taxSaver = out.cards.find((c) => c.product === "tax_saver")!;
    expect(fd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(hasErrors(validateCard(taxSaver))).toBe(false);
    const callable = { amount: 1e5, customer: "general" as const, callable: true as const };
    const nonCallable = { amount: 1e5, customer: "general" as const, callable: false as const };
    expect(rateForTenure(fd.rows, 10, callable)?.rate).toBe(3.5); // 7-14 days, callable, general
    expect(rateForTenure(fd.rows, 10, nonCallable)?.rate).toBe(3.55); // 7-14 days, non-callable, general (higher)
    expect(rateForTenure(fd.rows, 10, { ...nonCallable, customer: "senior" })?.rate).toBe(3.8);
    // 23 months 1 day to 27 months is the local peak.
    expect(rateForTenure(fd.rows, 750, callable)?.rate).toBe(8.0);
    expect(rateForTenure(fd.rows, 750, { ...callable, customer: "senior" })?.rate).toBe(8.25);
    expect(taxSaver.rows).toEqual([
      { tenureMinDays: 1825, tenureMaxDays: 1825, tenureLabel: "Tax saver FD 5 Years (60 months)", amountMin: 0, amountMax: 3 * 1e7, customer: "general", residency: "resident", callable: true, payout: null, rate: 6.25 },
      { tenureMinDays: 1825, tenureMaxDays: 1825, tenureLabel: "Tax saver FD 5 Years (60 months)", amountMin: 0, amountMax: 3 * 1e7, customer: "senior", residency: "resident", callable: true, payout: null, rate: 6.5 },
    ]);
    expect(out.terms?.[0].seniorPremium).toBe("+0.25% over the card rate");
  });

  it("reads the RD table (own effective date)", async () => {
    const out = await shivalikRd(ctxFromFixture(source, fixture));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 400, { amount: 1e5, customer: "general" })?.rate).toBe(6.75); // 13-17 months
    expect(rateForTenure(rd.rows, 400, { amount: 1e5, customer: "senior" })?.rate).toBe(7.0);
  });

  it("reads the incremental savings slabs", async () => {
    const out = await shivalikSavings(ctxFromFixture(source, fixture));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-07-13");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident", note: "Up to 1 Lacs" },
      { balanceMin: 100001, balanceMax: 500001, rate: 3.25, residency: "resident", note: "Above 1 Lac to 5 Lacs" },
      { balanceMin: 500001, balanceMax: 1000001, rate: 3.5, residency: "resident", note: "Above 5 Lacs to 10 Lacs" },
      { balanceMin: 1000001, balanceMax: 100000001, rate: 7, residency: "resident", note: "Above 10 Lacs to 10 Crore" },
    ]);
  });
});
