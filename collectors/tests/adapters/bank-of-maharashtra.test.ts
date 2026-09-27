import { describe, expect, it } from "vitest";
import { bankOfMaharashtraBulk, bankOfMaharashtraFd, bankOfMaharashtraSavings } from "../../src/adapters/bank-of-maharashtra";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const fdUrl = "https://bankofmaharashtra.bank.in/domestic-term-deposits";

describe("Bank of Maharashtra adapter", () => {
  it("reads the retail (<3cr) card, including the two named special tenures", async () => {
    const out = await bankOfMaharashtraFd(ctxFromFixture({ key: "bank-of-maharashtra:fd", bankSlug: "bank-of-maharashtra", url: fdUrl }, "bank-of-maharashtra/domestic_term_deposits.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-09-14");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(14);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true); // no per-row senior number is printed

    const oneYear = fd.rows.find((r) => r.tenureMinDays === 365);
    expect(oneYear).toMatchObject({ rate: 6.4, tenureLabel: "365 days/ One Year", callable: true });
    const special400 = fd.rows.find((r) => r.tenureMinDays === 400);
    expect(special400).toMatchObject({ rate: 6.65, special: true, schemeName: undefined });
    const green = fd.rows.find((r) => r.schemeName === "Green Deposit");
    expect(green).toMatchObject({ tenureMinDays: 1777, tenureMaxDays: 1777, rate: 6.05, special: true });

    const terms = out.terms?.find((t) => t.product === "fd");
    expect(terms?.seniorPremium).toMatch(/0\.50%/);
  });

  it("derives RD from the retail card because the bank states RD = TD card rate", async () => {
    const out = await bankOfMaharashtraFd(ctxFromFixture({ key: "bank-of-maharashtra:fd", bankSlug: "bank-of-maharashtra", url: fdUrl }, "bank-of-maharashtra/domestic_term_deposits.html"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(rd.rows.length).toBeGreaterThan(0);
    expect(rd.notes?.some((n) => /Recurring Term Deposits will be same as/i.test(n))).toBe(true);
  });

  it("reads the bulk card (₹3-10cr + >10cr amount bands, both callable and non-callable)", async () => {
    const out = await bankOfMaharashtraBulk(ctxFromFixture({ key: "bank-of-maharashtra:fd_bulk", bankSlug: "bank-of-maharashtra", url: fdUrl }, "bank-of-maharashtra/domestic_term_deposits.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-14");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(73);

    // "One Year" (no digit) in the >10cr table needs the adapter's local fix for parseTenure.
    const oneYearCallable = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 10 * CRORE + 1 && r.callable === true);
    const oneYearNonCallable = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 10 * CRORE + 1 && r.callable === false);
    expect(oneYearCallable?.rate).toBe(6.65);
    expect(oneYearNonCallable?.rate).toBe(6.85);
    // The Green Deposit scheme is only offered callable in the ₹3-10cr band on this page.
    const greenBulk = bulk.rows.filter((r) => r.schemeName === "Green Deposit");
    expect(greenBulk).toEqual([expect.objectContaining({ amountMin: 3 * CRORE, callable: true, rate: 5.45 })]);
  });

  it("reads savings slabs from the 'Revised' column only, ignoring the older 'Existing' column", async () => {
    const out = await bankOfMaharashtraSavings(
      ctxFromFixture({ key: "bank-of-maharashtra:savings", bankSlug: "bank-of-maharashtra", url: "https://bankofmaharashtra.bank.in/interest-rates" }, "bank-of-maharashtra/savings.html"),
    );
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2025-09-01");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: CRORE + 1, rate: 2.5, residency: "resident" },
      { balanceMin: CRORE + 1, balanceMax: 100 * CRORE, rate: 2.6, residency: "resident" },
      { balanceMin: 100 * CRORE + 1, balanceMax: null, rate: 2.75, residency: "resident" },
    ]);
  });
});
