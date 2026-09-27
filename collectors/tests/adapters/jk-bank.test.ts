import { describe, expect, it } from "vitest";
import { jkBankBulk, jkBankFd, jkBankSavings } from "../../src/adapters/jk-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

// Fixture is trimmed from the Internet Archive's unmodified snapshot of this URL, captured
// 2026-04-15 (jkb.bank.in is unreachable from this sandbox/CI — see jk-bank.ts file header).
const src = { key: "jk-bank:fd", bankSlug: "jk-bank", url: "https://jkb.bank.in/interest-rates" };
const fixture = "jk-bank/interest-rates.html";

describe("J&K Bank adapter", () => {
  it("reads the retail FD card (below ₹3 crore, Revised column) plus the ₹1cr–<3cr non-callable tier", async () => {
    const out = await jkBankFd(ctxFromFixture(src, fixture));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-02-11");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(14); // 13 callable tenures + 1 non-callable ₹1cr–<3cr tier
    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.5); // 7-30 days
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.75); // "1 year to less than 18 months", revised (not existing 6.50)
    expect(rateForTenure(fd.rows, 888, g)?.rate).toBe(7.25); // special point tenure, revised (not existing 7.00)
    expect(rateForTenure(fd.rows, 888, g)?.special).toBe(true);
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(6.6); // 5-10 years

    const nc = fd.rows.find((r) => r.callable === false);
    expect(nc?.tenureMinDays).toBe(888);
    expect(nc?.amountMin).toBe(1_00_00_000);
    expect(nc?.amountMax).toBe(3_00_00_000); // ₹3 crore
    expect(nc?.rate).toBe(7.1); // revised (not existing 7.15)
    expect(nc?.note).toMatch(/2025-12-11/); // this tier's own, earlier "w.e.f" date
  });

  it("has no RD card and says why in the FD card's notes and terms", async () => {
    const out = await jkBankFd(ctxFromFixture(src, fixture));
    expect(out.cards.find((c) => c.product === "rd")).toBeUndefined();
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.notes?.some((n) => /rd rates not published/i.test(n))).toBe(true);
    expect(out.terms?.[0]?.rdRules).toMatch(/not published/i);
  });

  it("reads the bulk card (₹3cr to <₹5cr, callable and non-callable)", async () => {
    const out = await jkBankBulk(ctxFromFixture({ ...src, key: "jk-bank:fd_bulk" }, fixture));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-02-11");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(19); // 12 callable + 7 non-callable tenures
    expect(rateForTenure(bulk.rows, 10, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(4.75);
    expect(rateForTenure(bulk.rows, 888, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(7.25); // revised, not existing 7.00
    expect(rateForTenure(bulk.rows, 10, { amount: 1e5, customer: "general" })).toBeNull(); // below bulk threshold

    // Non-callable ₹3cr–<5cr tier starts at 91 days (no 7-90 day rows published for it).
    expect(rateForTenure(bulk.rows, 10, { amount: 4e7, customer: "general", callable: false })).toBeNull();
    const ncPoint = bulk.rows.find((r) => r.callable === false && r.tenureMinDays === 888);
    expect(ncPoint?.rate).toBe(7.35); // revised, not existing 7.10
    expect(ncPoint?.note).toMatch(/non-callable/i);
  });

  it("reads the flat savings rate from the table's own w.e.f. column header", async () => {
    const out = await jkBankSavings(ctxFromFixture({ ...src, key: "jk-bank:savings" }, fixture));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-02-11");
    expect(c.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 2.55, residency: "resident" }]);
    expect(hasErrors(validateCard(c))).toBe(false);
  });
});
