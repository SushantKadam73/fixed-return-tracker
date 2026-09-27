import { describe, expect, it } from "vitest";
import { sibBulk, sibFd, sibSavings } from "../../src/adapters/south-indian-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.southindianbank.bank.in/quick-links/interest-rates/deposits";

describe("South Indian Bank adapter", () => {
  it("reads the retail FD card, fixing the 'daysto' typo and the tax-gain row", async () => {
    const out = await sibFd(ctxFromFixture({ key: "south-indian-bank:fd", bankSlug: "south-indian-bank", url }, "south-indian-bank/interest_rates_deposits.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-19");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 150, g)?.rate).toBe(4.8); // "100 daysto 180 days" typo, fixed locally
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.25); // "1 year" point tenure
    expect(rateForTenure(fd.rows, 365, s)?.rate).toBe(6.75);
    expect(rateForTenure(fd.rows, 2008, g)?.rate).toBe(6.0); // "66 months (Green deposit)"
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(5.7); // "Above 66 months to upto and including 10 years"

    // Tax Gain (5 years): duration was inside parens, read by hand.
    const taxGain = fd.rows.filter((r) => /tax gain/i.test(r.tenureLabel));
    expect(taxGain.map((r) => [r.tenureMinDays, r.customer, r.rate]).sort()).toEqual(
      [
        [1825, "general", 5.7],
        [1825, "senior", 6.2],
      ].sort(),
    );

    // Non-callable card only exists from ₹1 crore and below ₹3 crore.
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc.every((r) => r.amountMin === 1_00_00_000 && r.amountMax === 3 * 1e7)).toBe(true);
    expect(rateForTenure(nc, 913, { amount: 1_50_00_000, customer: "general" })?.rate).toBe(7.0); // 30 months, non-callable

    // No RD table on this page and no "RD = FD" statement, so no rd card is produced.
    expect(out.cards.some((c) => c.product === "rd")).toBe(false);
  });

  it("reads savings slabs with slabMethod left unknown (page never says whole vs incremental)", async () => {
    const out = await sibSavings(ctxFromFixture({ key: "south-indian-bank:savings", bankSlug: "south-indian-bank", url }, "south-indian-bank/interest_rates_deposits.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-04-21");
    expect(card.slabMethod).toBe("unknown");
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 1 * 1e7, rate: 2.25, residency: "resident" },
      { balanceMin: 1 * 1e7, balanceMax: 5 * 1e7, rate: 2.5, residency: "resident" },
      { balanceMin: 5 * 1e7, balanceMax: 25 * 1e7, rate: 4.5, residency: "resident" },
      { balanceMin: 25 * 1e7, balanceMax: null, rate: 6.0, residency: "resident" },
    ]);
  });

  it("reads the bulk (≥₹3cr) callable + non-callable cards with a per-tier amount split", async () => {
    const out = await sibBulk(ctxFromFixture({ key: "south-indian-bank:bulk", bankSlug: "south-indian-bank", url }, "south-indian-bank/interest_rates_deposits.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-28");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.rows.every((r) => r.customer === "general")).toBe(true); // no senior column above ₹3cr

    // Anomalous named tier: ₹25-50cr and ₹50-100cr get a distinctly higher rate for this one row.
    expect(rateForTenure(card.rows, 500, { amount: 4 * 1e7, customer: "general", callable: true })?.rate).toBe(6.05);
    expect(rateForTenure(card.rows, 500, { amount: 30 * 1e7, customer: "general", callable: true })?.rate).toBe(7.3);
    expect(rateForTenure(card.rows, 500, { amount: 4 * 1e7, customer: "general", callable: false })?.rate).toBe(6.05);
    expect(rateForTenure(card.rows, 10, { amount: 2 * 1e7, customer: "general" })).toBeNull(); // below ₹3cr bulk threshold
  });
});
