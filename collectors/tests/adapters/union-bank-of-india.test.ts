import { describe, expect, it } from "vitest";
import { unionBankBulk, unionBankFd } from "../../src/adapters/union-bank-of-india";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const fdUrl = "https://www.unionbankofindia.bank.in/en/details/rate-of-interest";
const bulkUrl = "https://www.unionbankofindia.bank.in/pdf/interest-rates-for-bulk-deposit.pdf";

describe("Union Bank of India adapter", () => {
  it("reads the FD card (callable <3cr + non-callable ₹1-3cr), general customer only", async () => {
    const out = await unionBankFd(ctxFromFixture({ key: "union-bank-of-india:fd", bankSlug: "union-bank-of-india", url: fdUrl }, "union-bank-of-india/rate_of_interest.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-08-04");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true);

    const g = { amount: 1_00_000, customer: "general" as const, callable: true as const };
    expect(rateForTenure(fd.rows, 60, g)?.rate).toBe(4); // "46 -90 Days"
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.25); // named special tenure
    expect(fd.rows.find((r) => r.tenureMinDays === 400 && r.callable === true)?.special).toBe(true);
    expect(rateForTenure(fd.rows, 997, g)?.rate).toBe(6.1);

    // Non-callable ₹1-3cr variant, printed only for the 400/444/555-day special tenures.
    const nc400 = fd.rows.find((r) => r.tenureMinDays === 400 && r.callable === false);
    expect(nc400).toMatchObject({ rate: 6.75, amountMin: CRORE + 1, amountMax: 3 * CRORE });
    expect(fd.rows.some((r) => r.tenureMinDays === 365 && r.callable === false)).toBe(false); // "NO Slab" must not become a row

    expect(fd.notes?.some((n) => /\+0\.50%/.test(n))).toBe(true);
  });

  it("reads the savings card (9 slabs), fixing the shared parser's 'Crs' amount bug locally", async () => {
    const out = await unionBankFd(ctxFromFixture({ key: "union-bank-of-india:savings", bankSlug: "union-bank-of-india", url: fdUrl }, "union-bank-of-india/rate_of_interest.html"));
    const savings = out.cards.find((c) => c.product === "savings")!;
    expect(savings.effectiveFrom).toBe("2026-08-10");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(9);
    expect(savings.savingsSlabs?.[0]).toMatchObject({ balanceMin: 0, rate: 2.5 });
    // ">Rs 50 lakhs to Rs 50 Crs" must read as crore-scale, not as bare rupees (the "Crs" bug).
    expect(savings.savingsSlabs?.[1]).toMatchObject({ balanceMax: 50 * CRORE, rate: 2.55 });
    expect(savings.savingsSlabs?.at(-1)).toMatchObject({ balanceMin: 3000 * CRORE + 1, balanceMax: null, rate: 6.25 });
  });

  it("reads the bulk PDF (Callable + Non-Callable sections, 6 amount bands), skipping Notice Period and NRE", async () => {
    const out = await unionBankBulk(ctxFromFixture({ key: "union-bank-of-india:fd_bulk", bankSlug: "union-bank-of-india", url: bulkUrl }, "union-bank-of-india/bulk.txt"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-23"); // "Interest rates for Bulk Deposit ... for 23.09.2026"
    expect(hasErrors(validateCard(bulk))).toBe(false);

    const inBand = (amount: number, callable: boolean) => ({ amount, customer: "general" as const, callable });
    expect(rateForTenure(bulk.rows, 365, inBand(5 * CRORE, true))?.rate).toBe(6.0); // 3-10cr band
    // The >₹500cr, "1 Year" outlier (6.83) printed in the source must be kept as printed.
    expect(rateForTenure(bulk.rows, 365, inBand(600 * CRORE, true))?.rate).toBe(6.83);
    expect(rateForTenure(bulk.rows, 365, inBand(600 * CRORE, false))?.rate).toBe(6.85);
    expect(bulk.rows.some((r) => r.tenureMinDays === 997)).toBe(true);

    // Non-callable section starts at "61-90 Days" in the source — no 7-14/15-30/31-45-day
    // non-callable rows exist, and none must be invented.
    expect(bulk.rows.some((r) => r.tenureMinDays === 7 && r.callable === false)).toBe(false);
    expect(bulk.notes?.some((n) => /Notice Period|NRE/i.test(n))).toBe(true);
  });
});
