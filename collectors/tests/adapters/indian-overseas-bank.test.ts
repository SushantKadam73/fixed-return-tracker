import { describe, expect, it } from "vitest";
import { iobBulk, iobFd, iobSavings } from "../../src/adapters/indian-overseas-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const retailUrl = "https://www.iob.bank.in/en/domestic-nro-nre-retail-term-deposit-rates";

describe("Indian Overseas Bank adapter", () => {
  it("reads the retail FD card (general public only — senior premium is text, not a column)", async () => {
    const out = await iobFd(ctxFromFixture({ key: "indian-overseas-bank:fd", bankSlug: "indian-overseas-bank", url: retailUrl }, "indian-overseas-bank/fd_retail_bulk.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-05-15");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true);

    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.5); // "1 Year"
    expect(rateForTenure(fd.rows, 444, g)?.rate).toBe(6.6); // named 444-day special tenure
    expect(fd.rows.find((r) => r.tenureMinDays === 444)?.special).toBe(true);
    // "270 Days to < 1 Year" must read as a 270-364 day range, not a throw or a mis-sum.
    expect(rateForTenure(fd.rows, 300, g)?.rate).toBe(5.5);
    expect(rateForTenure(fd.rows, 364, g)?.rate).toBe(5.5);
    // "> 1 Year to < 2 Years (Except 444 Days)"
    expect(rateForTenure(fd.rows, 500, g)?.rate).toBe(6.4);
    // "3 Years and above" — open-ended
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(6.1);
    expect(fd.notes?.some((n) => /0\.50%.*0\.75%|additional interest rate/i.test(n))).toBe(true);
  });

  it("reads the bulk card (₹3cr and above) with the bare-'<' tenure labels fixed locally", async () => {
    const out = await iobBulk(ctxFromFixture({ key: "indian-overseas-bank:fd_bulk", bankSlug: "indian-overseas-bank", url: retailUrl }, "indian-overseas-bank/fd_retail_bulk.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-27"); // table prints "Interest Rate as on 27.09.2026"
    expect(hasErrors(validateCard(bulk))).toBe(false);

    const g = { amount: 5 * CRORE, customer: "general" as const };
    // "270 Days < 1 Year" (bare "<", no "to") must read as [270,364], not a mis-parsed sum.
    const r270 = bulk.rows.find((r) => r.tenureMinDays === 270 && r.callable === true);
    expect(r270).toMatchObject({ tenureMaxDays: 364, rate: 5.0 });
    expect(rateForTenure(bulk.rows, 300, { ...g, callable: true })?.rate).toBe(5.0);
    // "Above 1 Year <2 Year" (no space before the number) must read as (366,729).
    const rAbove1y = bulk.rows.find((r) => r.tenureMinDays === 366 && r.callable === true);
    expect(rAbove1y).toMatchObject({ tenureMaxDays: 729, rate: 6.3 });
    // Non-callable column, and "NA" cells (7-45 days) must be skipped, not invented.
    expect(rateForTenure(bulk.rows, 365, { ...g, callable: false })?.rate).toBe(6.7);
    expect(bulk.rows.some((r) => r.tenureMinDays === 7 && r.callable === false)).toBe(false);
    expect(rateForTenure(bulk.rows, 1000, { amount: 1e5, customer: "general" })).toBeNull(); // below bulk threshold
  });

  it("reads the repo-linked savings card", async () => {
    const out = await iobSavings(ctxFromFixture({ key: "indian-overseas-bank:savings", bankSlug: "indian-overseas-bank", url: "https://www.iob.bank.in/en/savings-interest-rates" }, "indian-overseas-bank/savings.html"));
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-09-15");
    expect(hasErrors(validateCard(savings))).toBe(false);
    // The middle slab's own label is "Above Rs. 1 lakh and upto Rs. 2000 Crore" -- "upto" written
    // as one word is an inclusive upper bound (shared parseAmountBand convention, same as spaced
    // "up to"), so its balanceMax sits one rupee past 2000 Crore, exactly abutting the next
    // slab's own "Above Rs. 2000 Crore" (exclusive) lower bound with no gap and no overlap.
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 1_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 1_00_001, balanceMax: 2000 * CRORE + 1, rate: 2.2, residency: "resident", note: expect.stringContaining("Repo Rate") },
      { balanceMin: 2000 * CRORE + 1, balanceMax: null, rate: 6.6, residency: "resident", note: expect.stringContaining("Repo Rate") },
    ]);
  });
});
