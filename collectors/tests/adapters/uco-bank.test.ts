import { describe, expect, it } from "vitest";
import { ucoBulk, ucoFd } from "../../src/adapters/uco-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const url = "https://www.uco.bank.in/interest-rates-on-deposit-schemes";

describe("UCO Bank adapter", () => {
  it("reads the retail FD card (general customer only) with Green Deposit scheme names", async () => {
    const out = await ucoFd(ctxFromFixture({ key: "uco-bank:fd", bankSlug: "uco-bank", url }, "uco-bank/deposit_schemes.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-05-21");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true);

    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.1);
    expect(rateForTenure(fd.rows, 333, g)?.rate).toBe(6.3); // 333-day special
    expect(rateForTenure(fd.rows, 1000, g)?.rate).toBe(6.2); // 1000-day Green Deposit
    expect(fd.rows.find((r) => r.tenureMinDays === 1000)?.schemeName).toBe("UCO Green Deposit");
    expect(fd.rows.find((r) => r.tenureMinDays === 2000)?.schemeName).toBe("UCO Green Deposit");
    expect(fd.rows.find((r) => r.tenureMinDays === 3000)?.schemeName).toBe("UCO Green Deposit");
    expect(fd.notes?.some((n) => /0\.25%/.test(n))).toBe(true);
  });

  it("derives the RD card, capped at ₹2 crore per the bank's own RD-specific wording", async () => {
    const out = await ucoFd(ctxFromFixture({ key: "uco-bank:fd", bankSlug: "uco-bank", url }, "uco-bank/deposit_schemes.html"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows.every((r) => r.amountMax === 2 * CRORE && !r.special)).toBe(true);
    expect(rd.notes?.some((n) => /derived/i.test(n))).toBe(true);
    expect(rd.notes?.some((n) => /2 crore/i.test(n))).toBe(true);
    expect(rateForTenure(rd.rows, 365, { amount: 1e5, customer: "general" })?.rate).toBe(6.1);
  });

  it("reads the savings card (2 slabs, both currently 2.50%)", async () => {
    const out = await ucoFd(ctxFromFixture({ key: "uco-bank:fd", bankSlug: "uco-bank", url }, "uco-bank/deposit_schemes.html"));
    const savings = out.cards.find((c) => c.product === "savings")!;
    expect(savings.effectiveFrom).toBe("2025-06-23");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 10_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 10_00_001, balanceMax: null, rate: 2.5, residency: "resident" },
    ]);
  });

  it("reads the bulk card, merging the ₹3-10cr table with the three >₹10cr amount bands", async () => {
    const out = await ucoBulk(ctxFromFixture({ key: "uco-bank:fd_bulk", bankSlug: "uco-bank", url }, "uco-bank/deposit_schemes.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-27"); // table's own "w.e.f. 27.09.2026" text
    expect(hasErrors(validateCard(bulk))).toBe(false);

    const g310 = { amount: 5 * CRORE, customer: "general" as const };
    expect(rateForTenure(bulk.rows, 365, { ...g310, callable: true })?.rate).toBe(5.5); // "271 Days to 1 Year"
    expect(rateForTenure(bulk.rows, 365, { ...g310, callable: false })?.rate).toBe(5.55);

    // >₹10-50cr band: bare "271D < 1 Year" (no "to", no space before "D") must read as (271,364).
    const g1050 = { amount: 20 * CRORE, customer: "general" as const, callable: true };
    const r271 = bulk.rows.find((r) => r.tenureMinDays === 271 && r.amountMin === 10 * CRORE + 1);
    expect(r271).toMatchObject({ tenureMaxDays: 364, rate: 5.5 });
    expect(rateForTenure(bulk.rows, 365, g1050)?.rate).toBe(5.9); // distinct point rate, higher than the 271-364 band

    // The >₹100cr (open-ended) non-callable band stops at ">1Y to 2Y" in the source — later tenors must not be invented.
    expect(bulk.rows.some((r) => r.amountMin === 100 * CRORE + 1 && r.callable === false && r.tenureMinDays === 1096)).toBe(false);
    expect(bulk.rows.some((r) => r.amountMin === 100 * CRORE + 1 && r.callable === true && r.tenureMinDays === 1826)).toBe(true);
  });
});
