import { describe, expect, it } from "vitest";
import { bankOfBarodaBulk, bankOfBarodaFd, bankOfBarodaSavings, bankOfBarodaTaxSaver } from "../../src/adapters/bank-of-baroda";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const fdUrl = "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/fixed-deposits-callable-and-non-callable-upto-ten-crores";

describe("Bank of Baroda adapter", () => {
  it("reads the retail card (callable <3cr + non-callable ₹1-3cr)", async () => {
    const out = await bankOfBarodaFd(ctxFromFixture({ key: "bank-of-baroda:fd", bankSlug: "bank-of-baroda", url: fdUrl }, "bank-of-baroda/fd_upto_10cr.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-06-12");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(69);

    const find = (minDays: number, customer: string, callable: boolean, amountMin = 0) =>
      fd.rows.find((r) => r.tenureMinDays === minDays && r.customer === customer && r.callable === callable && r.amountMin === amountMin);

    expect(find(365, "general", true)?.rate).toBe(6.25);
    expect(find(365, "senior", true)?.rate).toBe(6.75);
    expect(find(365, "general", false, CRORE + 1)?.rate).toBe(6.3); // non-callable ₹1-3cr
    // "271 days & above and less than 1 year": the shared tenure parser mis-splits this exact
    // phrase (see file header note in bank-of-baroda.ts), so this adapter reads it itself.
    const r271 = fd.rows.find((r) => r.tenureMinDays === 271 && r.customer === "general" && r.callable === true);
    expect(r271).toMatchObject({ tenureMinDays: 271, tenureMaxDays: 364, rate: 6, tenureLabel: "271 days & above and less than 1 year" });
  });

  it("reads bob Square Drive (444d) and bob Golden Goal (555d) named schemes, including the '$' footnote rate", async () => {
    const out = await bankOfBarodaFd(ctxFromFixture({ key: "bank-of-baroda:fd", bankSlug: "bank-of-baroda", url: fdUrl }, "bank-of-baroda/fd_upto_10cr.html"));
    const fd = out.cards[0];
    const squareDrive = fd.rows.filter((r) => r.schemeName === "bob Square Drive Deposit Scheme" && r.callable === true);
    expect(squareDrive.map((r) => [r.customer, r.rate]).sort()).toEqual([
      ["general", 6.45],
      ["senior", 6.95],
      ["super_senior", 7.05], // printed as "7.05$" — parseRate alone drops the "$" marker cell
    ]);
    expect(squareDrive.every((r) => r.special === true && r.tenureMinDays === 444 && r.tenureMaxDays === 444)).toBe(true);
    const goldenGoal = fd.rows.filter((r) => r.schemeName === "bob Golden Goal Deposit Scheme" && r.callable === false);
    expect(goldenGoal.map((r) => [r.customer, r.rate]).sort()).toEqual([
      ["general", 6.8],
      ["senior", 7.3],
      ["super_senior", 7.4],
    ]);
  });

  it("drops the open-ended 'Above 10 years (MACAD only)' row with a note instead of guessing an upper bound", async () => {
    const out = await bankOfBarodaFd(ctxFromFixture({ key: "bank-of-baroda:fd", bankSlug: "bank-of-baroda", url: fdUrl }, "bank-of-baroda/fd_upto_10cr.html"));
    const fd = out.cards[0];
    expect(fd.rows.some((r) => /macad/i.test(r.tenureLabel))).toBe(false);
    expect(fd.notes?.some((n) => /MACAD/i.test(n))).toBe(true);
  });

  it("reads the bulk card (₹3-10cr on this page); above-₹10cr fetch is unavailable in tests so it warns instead of failing", async () => {
    const out = await bankOfBarodaBulk(ctxFromFixture({ key: "bank-of-baroda:fd_bulk", bankSlug: "bank-of-baroda", url: fdUrl }, "bank-of-baroda/fd_upto_10cr.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-26");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(133);
    // amount bands must carry the crore multiplier: "Rs. 3.00 Crs" (BoB's abbreviation) must not
    // be misread as the bare number 3 — see the readAmountBand() note in bank-of-baroda.ts.
    const band = bulk.rows.filter((r) => r.tenureMinDays === 365 && r.callable === true);
    expect(band.map((r) => [r.amountMin, r.amountMax, r.rate])).toEqual([
      [3 * CRORE, 4 * CRORE + 1, 6.25],
      [4 * CRORE + 1, 5 * CRORE + 1, 6.25],
      [5 * CRORE + 1, 6 * CRORE + 1, 6.25],
      [6 * CRORE + 1, 7 * CRORE + 1, 6.25],
      [7 * CRORE + 1, 8 * CRORE + 1, 6.25],
      [8 * CRORE + 1, 9 * CRORE + 1, 6.25],
      [9 * CRORE + 1, 10 * CRORE + 1, 6.25],
    ]);
    expect(out.warnings?.some((w) => /above-₹10-crore/.test(w))).toBe(true);
  });

  it("reads savings slabs (method left 'unknown': the page never states whole vs incremental)", async () => {
    const out = await bankOfBarodaSavings(
      ctxFromFixture({ key: "bank-of-baroda:savings", bankSlug: "bank-of-baroda", url: "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/savings-bank-deposits" }, "bank-of-baroda/savings.html"),
    );
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2025-08-22");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs?.[0]).toEqual({ balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident" });
    expect(savings.savingsSlabs?.at(-1)).toEqual({ balanceMin: 2000 * CRORE, balanceMax: null, rate: 4.75, residency: "resident" });
  });

  it("reads the tax-saver card: a single statutory 5-year row for General/Senior/Super Senior, on its own page", async () => {
    const out = await bankOfBarodaTaxSaver(
      ctxFromFixture(
        { key: "bank-of-baroda:tax_saver", bankSlug: "bank-of-baroda", url: "https://bankofbaroda.bank.in/interest-rate-and-service-charges/deposits-interest-rates/fixed-deposits-tax-saving" },
        "bank-of-baroda/tax_saver.html",
      ),
    );
    const taxSaver = out.cards[0];
    expect(taxSaver.product).toBe("tax_saver");
    expect(taxSaver.effectiveFrom).toBe("2026-05-15");
    expect(hasErrors(validateCard(taxSaver))).toBe(false);
    expect(taxSaver.rows).toHaveLength(3);
    expect(taxSaver.rows.map((r) => [r.customer, r.tenureMinDays, r.tenureMaxDays, r.rate]).sort()).toEqual([
      ["general", 1825, 1825, 6.3],
      ["senior", 1825, 1825, 6.9], // printed as "6.90#"
      ["super_senior", 1825, 1825, 7], // printed as "7.00$" — BoB's own "$" footnote marker
    ]);
    expect(taxSaver.rows.every((r) => r.amountMax === null)).toBe(true); // no amount band is printed on this page
  });
});
