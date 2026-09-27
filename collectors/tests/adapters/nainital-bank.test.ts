import { describe, expect, it } from "vitest";
import { nainitalBankFd, nainitalBankSavings } from "../../src/adapters/nainital-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const src = { key: "nainital-bank:fd", bankSlug: "nainital-bank", url: "https://www.nainitalbank.bank.in/en/pages/interest-rate" };
const fixture = "nainital-bank/interest-rate.html";

describe("Nainital Bank adapter", () => {
  it("reads the term-deposit ladder (Revised column only, no amount band)", async () => {
    const out = await nainitalBankFd(ctxFromFixture(src, fixture));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-04-10");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(13);
    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.25);
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.3); // "-1- year and above ... 18 months", revised (not the 6.40 existing rate)
    expect(rateForTenure(fd.rows, 444, g)?.rate).toBe(6.6); // Naini Samriddhi
    expect(rateForTenure(fd.rows, 444, g)?.special).toBe(true);
    const samriddhi = fd.rows.find((r) => r.schemeName === "Naini Samriddhi");
    expect(samriddhi?.tenureMinDays).toBe(444);
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(5.35); // above 5 to 10 years
    // Naini Tax Saver Scheme has no tenure stated on this table and must not appear as a row.
    expect(fd.rows.some((r) => /tax saver/i.test(r.tenureLabel))).toBe(false);
  });

  it("has no RD card and says why (RD page states no equality-to-FD, no table)", async () => {
    const out = await nainitalBankFd(ctxFromFixture(src, fixture));
    expect(out.cards.find((c) => c.product === "rd")).toBeUndefined();
    const fd = out.cards[0];
    expect(fd.notes?.some((n) => /rd rates not published/i.test(n))).toBe(true);
    expect(out.terms?.[0]?.rdRules).toMatch(/not published/i);
  });

  it("reads the flat savings rate", async () => {
    const out = await nainitalBankSavings(ctxFromFixture({ ...src, key: "nainital-bank:savings", url: "https://www.nainitalbank.bank.in/en/pages/interest-rate" }, fixture));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-01-10");
    expect(c.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 2.65, residency: "resident" }]);
    expect(hasErrors(validateCard(c))).toBe(false);
  });
});
