import { describe, expect, it } from "vitest";
import { centralBankOfIndiaBulk, centralBankOfIndiaFd, centralBankOfIndiaSavings } from "../../src/adapters/central-bank-of-india";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const url = "https://centralbank.bank.in/en/interest-rates-on-deposit";

describe("Central Bank of India adapter", () => {
  it("reads the retail card: General/Senior x <3cr, plus 333/444/555-day and CENT Green/Floating named schemes", async () => {
    const out = await centralBankOfIndiaFd(ctxFromFixture({ key: "central-bank-of-india:fd", bankSlug: "central-bank-of-india", url }, "central-bank-of-india/interest_rates.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-08-10");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(46);

    const oneYear = fd.rows.find((r) => r.tenureMinDays === 365 && r.customer === "general" && r.callable === true && !r.schemeName);
    expect(oneYear).toMatchObject({ rate: 6.1, tenureLabel: "1 yr to less than 2 yrs" });

    // "333" (no unit) relies on the column header's "(days)" — parseTenure can't see that on
    // its own; the adapter appends the unit itself before parsing (see withDaysUnit()).
    const d333general = fd.rows.find((r) => r.tenureMinDays === 333 && r.customer === "general" && r.callable === true);
    expect(d333general).toMatchObject({ rate: 6.5, schemeName: "Central 333 Days Special Deposit", special: true, tenureLabel: "333 days" });
    const d333seniorNonCallable = fd.rows.find((r) => r.tenureMinDays === 333 && r.customer === "senior" && r.callable === false);
    expect(d333seniorNonCallable).toMatchObject({ rate: 7.1, amountMin: CRORE + 1 });

    const green1111 = fd.rows.find((r) => r.tenureMinDays === 1111 && r.schemeName === "CENT Green Deposit");
    expect(green1111?.rate).toBe(6.25);
    const floating = fd.rows.find((r) => r.schemeName === "CENT Floating Deposit" && r.tenureMinDays === 365 && r.customer === "general");
    expect(floating?.rate).toBe(5.55);
  });

  it("notes the 333/555-day and CENT Green Deposit rows' own printed dates where they differ from the main table's", async () => {
    const out = await centralBankOfIndiaFd(ctxFromFixture({ key: "central-bank-of-india:fd", bankSlug: "central-bank-of-india", url }, "central-bank-of-india/interest_rates.html"));
    const fd = out.cards[0];
    expect(fd.notes?.some((n) => /333 Days.*2026-06-10/.test(n))).toBe(true);
    expect(fd.notes?.some((n) => /555 Days.*2025-12-10/.test(n))).toBe(true);
    expect(fd.notes?.some((n) => /CENT Green Deposit.*2025-12-10.*2025-09-10/.test(n))).toBe(true);
    // 444-day's own date (10.08.2026) matches the main table's, so it gets no note.
    expect(fd.notes?.some((n) => /444/.test(n))).toBe(false);
  });

  it("reads the bulk card (₹3-10cr + >₹10cr) with a null effective date because the bank's page leaves both dates blank", async () => {
    const out = await centralBankOfIndiaBulk(ctxFromFixture({ key: "central-bank-of-india:fd_bulk", bankSlug: "central-bank-of-india", url }, "central-bank-of-india/interest_rates.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBeNull();
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(42);
    expect(bulk.notes?.some((n) => /leaves the effective date blank/i.test(n))).toBe(true);

    const midBand = bulk.rows.find((r) => r.tenureMinDays === 365 && r.amountMin === 3 * CRORE);
    expect(midBand?.rate).toBe(6.1);
    const topBand = bulk.rows.find((r) => r.tenureMinDays === 7 && r.amountMax === null);
    expect(topBand?.rate).toBe(4.25);
  });

  it("reads savings slabs (Revised column only)", async () => {
    const out = await centralBankOfIndiaSavings(ctxFromFixture({ key: "central-bank-of-india:savings", bankSlug: "central-bank-of-india", url }, "central-bank-of-india/interest_rates.html"));
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-05-10");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(7);
    expect(savings.savingsSlabs?.[0].rate).toBe(2.5);
    expect(savings.savingsSlabs?.at(-1)?.rate).toBe(4.75);
  });
});
